import { streamText, convertToModelMessages, stepCountIs } from "ai";
import type { UIMessage } from "ai";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { agentTools } from "@/lib/agent-tools";
import { getModel } from "@/lib/get-model";
import { buildMemorySection, updateMemory } from "@/lib/memory";
import {
  extractMemories,
  recallMemory,
  renderMemoryContext,
} from "@/lib/memory-context";
import { hasMemoryAccess } from "@/lib/memory-gate";
import { compressConversation, sanitizeForTextModel } from "@/lib/context-compress";
import { resolvePetConfig } from "@/lib/ugc";
import { getUserFromRequest } from "@/lib/auth";
import { isAibiPetType, aibiTokenIdOf } from "@/lib/aibi-prompt";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { db, ensureDbSchemaOnce, pool } from "@/db/client";
import { adoptions, chatQuotas, users } from "@/db/schema";
import { compressForPremium, isPremium } from "@/lib/premium";
import { getActiveSubscription } from "@/lib/subscription-config";
import {
  getQuotaStatus,
  getRemaining,
  QUOTA_CONFIG,
  todayString,
} from "@/lib/chat-quota-config";
import { getHardLimitMessage, getSoftWarnMessage } from "@/lib/quota-messages";
import { moderateText } from "@/lib/content-moderation";
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from "@/lib/rate-limit";

export const maxDuration = 60;

/** 免费畅聊条数：达到该条数后需要赞助解锁。 */
const FREE_MESSAGE_LIMIT = 10;

/** 提取 UIMessage 纯文本（text parts 拼接；tool/image 等其他 parts 忽略）。 */
function uiMessageText(m: UIMessage): string {
  return (m.parts ?? [])
    .map((p) => (p.type === "text" ? (p as { type: "text"; text: string }).text : ""))
    .join("");
}

export async function POST(req: Request) {
  // 顶层防护：前置阶段（鉴权 / 建表 / Neon 查询 / 模型配置）任何一步抛错，
  // 都返回结构化 JSON 500 并打印服务端日志——而不是让 Next.js 返回 HTML 错误页
  // （前端 useChat 拿到非 JSON 错误会静默吞掉，用户看到的就是「AI 无任何回复」）。
  try {
    return await handlePost(req);
  } catch (err) {
    console.error("[chat] request failed:", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        ok: false,
        code: "CHAT_INTERNAL_ERROR",
        error: `聊天服务暂时不可用，请稍后再试（${detail.slice(0, 200)}）`,
      },
      { status: 500 },
    );
  }
}

async function handlePost(req: Request) {
  const { messages, petType, adoptionId } = (await req.json()) as {
    messages: UIMessage[];
    petType?: string;
    adoptionId?: string;
  };
  const locale = resolveLocale(req);

  // —— 商业闭环强校验：只有「已登录 + 拥有该宠物」的用户才能调用 AI 对话 ——
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: apiError(locale, "signInFirst"), code: "SIGN_IN_REQUIRED" },
      { status: 401 },
    );
  }
  // —— 会话主体判定：petType=aibi:<aibiTokenId> → Aibi 链上凭证线程（方案 a）；——
  // 否则为经典线（adoptions），沿用 adoptionId 强校验。两条线互不影响。
  const aibiTokenId = isAibiPetType(petType) ? aibiTokenIdOf(petType as string) : null;
  // VIP 长期记忆的 pet 维度键：经典线=adoptionId；Aibi 线=aibi:<tokenId>
  // （pet_memories.pet_id 为 text 列，天然兼容两种编码）。
  const memoryPetId = aibiTokenId ? (petType as string) : (adoptionId ?? null);
  if (!aibiTokenId && (typeof adoptionId !== "string" || !adoptionId)) {
    return NextResponse.json(
      { ok: false, error: apiError(locale, "noPermissionPet"), code: "OWNERSHIP_REQUIRED" },
      { status: 403 },
    );
  }

  // Phase 8 · 成本控制：聊天限流（20 次/分钟/用户；每日 quota 是主约束，本规则防秒级刷爆）
  const rl = checkRateLimit(`chat:${user.id}`, RATE_LIMITS.chat);
  if (rl.limited) return rateLimitResponse(req, rl.retryAfterSec);

  // Phase 8 · 内容审核：最后一条用户消息命中敏感词 → 400（不进入 LLM、不占每日配额）
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  const mod = moderateText(lastUserMsg ? uiMessageText(lastUserMsg) : "");
  if (!mod.ok) {
    console.warn("[chat] moderated:", user.id, mod.hits.join(","));
    return NextResponse.json(
      { ok: false, error: apiError(locale, "inappropriateContent"), code: "CONTENT_MODERATED" },
      { status: 400 },
    );
  }

  // 根据 petType 动态切换宠物人设（系统提示词），未提供时回退到狐狸。
  // UGC 宠物（petType=ugc:<id>）从数据库读取创作者设置的人设；
  // 图鉴物种（petType=species:<id>）用字典物种知识动态构建人设。
  const pet = await resolvePetConfig(petType, locale);

  // 首次访问自动建表（幂等）
  await ensureDbSchemaOnce();

  // 商业化变现：10 句免费门槛。达到后且未解锁时才拒绝调用 AI 模型。
  // 同时读取长期记忆用于注入。
  let memoryContext: string | null = null;
  let adoption:
    | {
        userId: string;
        chatCount: number;
        isUnlocked: boolean;
        memoryContext: string | null;
        petType: string;
      }
    | undefined;

  if (aibiTokenId) {
    // —— Aibi 分支（方案 a）：凭证必须存在、归属当前登录用户、且为 minted ——
    // （pending 未激活 / burned 已销毁不可聊）。经典线「10 句免费 + 赞助解锁」门槛挂在
    // adoptions.chatCount/isUnlocked 上，Aibi 无此表行 → 天然跳过；每日 quota
    // （chat_quotas，用户维度）与 VIP 规则两条线完全共用。
    const { rows: owned } = await pool.query(
      `SELECT 1 AS ok FROM aibi_tokens
        WHERE aibi_token_id = $1 AND owner_id = $2::uuid AND status = 'minted'
        LIMIT 1`,
      [aibiTokenId, user.id],
    );
    if (!owned[0]) {
      return NextResponse.json(
        { ok: false, error: apiError(locale, "noPermissionPet"), code: "OWNERSHIP_REQUIRED" },
        { status: 403 },
      );
    }
  } else {
    // 到达此处 aibiTokenId 为空 → 上方守卫已确保 adoptionId 是非空 string；
    // TS 无法跨复合守卫条件反向收窄，用局部变量显式固定类型。
    const classicAdoptionId = adoptionId as string;
    const [row] = await db
      .select({
        userId: adoptions.userId,
        chatCount: adoptions.chatCount,
        isUnlocked: adoptions.isUnlocked,
        memoryContext: adoptions.memoryContext,
        petType: adoptions.petType,
      })
      .from(adoptions)
      .where(eq(adoptions.id, classicAdoptionId))
      .limit(1);
    adoption = row;

    // 宠物必须存在且属于当前登录用户（所有权绑定）
    if (!adoption) {
      return NextResponse.json(
        { ok: false, error: apiError(locale, "adoptionNotFound"), code: "OWNERSHIP_REQUIRED" },
        { status: 404 },
      );
    }
    if (adoption.userId !== user.id) {
      return NextResponse.json(
        { ok: false, error: apiError(locale, "noPermissionPet"), code: "OWNERSHIP_REQUIRED" },
        { status: 403 },
      );
    }
  }

  // 经典线专属：10 句免费门槛（Aibi 线程无 adoptions 行，不适用）
  if (adoption && adoption.chatCount >= FREE_MESSAGE_LIMIT && !adoption.isUnlocked) {
    return NextResponse.json(
      {
        blocked: true,
        message: apiError(locale, "chatBlocked", { name: pet.name }),
      },
      // 非 2xx 状态让前端 useChat 通过 error.message 捕获这段 JSON。
      { status: 402 },
    );
  }

  // —— VIP 订阅配额（每日 10 条；VIP 无限）——
  // 与 adoptions.chatCount 累计并存：新系统用 chat_quotas 表按日期滚动，
  // 老逻辑仅在解锁前阻挡；VIP 通过后 chat_quotas 永远不增长。
  const subscription = await getActiveSubscription(user.id);
  const isVip = subscription !== null;
  const today = todayString();
  let todayCount = 0;
  if (!isVip) {
    const [qrow] = await db
      .select({ messageCount: chatQuotas.messageCount })
      .from(chatQuotas)
      .where(and(eq(chatQuotas.userId, user.id), eq(chatQuotas.date, today)))
      .limit(1);
    todayCount = qrow?.messageCount ?? 0;
  }
  const status = getQuotaStatus(todayCount, isVip);
  const remaining = getRemaining(todayCount, isVip);

  if (status === "hard_limit") {
    return NextResponse.json(
      {
        ok: false,
        code: "quota_exceeded",
        error: apiError(locale, "quotaExceeded"),
        quota: {
          messageCount: todayCount,
          dailyLimit: QUOTA_CONFIG.FREE_DAILY_LIMIT,
          status,
          remaining: 0,
          isVip: false,
          // 拟人化文案（按宠物 kind × locale）—— 前端弹窗展示
          message: getHardLimitMessage(adoption?.petType, locale),
        },
      },
      { status: 429 },
    );
  }

  memoryContext = adoption?.memoryContext ?? null;

  // —— Token 优化：上下文压缩 ——
  // 对话超过阈值时，把早期轮次归档为一条规则化语义摘要（零 Token），
  // 仅保留最近若干轮原始对话，避免完整历史原封不动发给模型。
  // 高级公民特权：解锁更长上下文记忆（普通 10 轮/保留 5；会员 20 轮/保留 12）。
  const [me] = await db
    .select({ premiumUntil: users.premiumUntil })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  const premium = isPremium(me?.premiumUntil);
  const { messages: recentMessages, summary } = compressConversation(
    messages,
    compressForPremium(premium),
  );

  // 配额软提醒文案（如有）—— 通过 stream response header 透传给前端
  const softWarnMessage =
    status === "soft_warn"
      ? getSoftWarnMessage(adoption?.petType, locale, remaining)
      : null;

  // 长期记忆注入 + 早期对话摘要 → 拼入 System Prompt（会话内仅发送一次，不随每轮重复）
  // VIP 长期记忆召回：仅 VIP 命中，从 pet_memories 表检索并注入 system prompt
  let vipMemorySection = "";
  if (isVip) {
    try {
      const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
      const query = lastUserMsg
        ? (lastUserMsg.parts ?? [])
            .filter((p) => p?.type === "text")
            .map((p) => p.text ?? "")
            .join(" ")
            .trim()
        : "";
      const recalled = await recallMemory({
        userId: user.id,
        query,
        petId: memoryPetId,
      });
      vipMemorySection = renderMemoryContext(recalled);
    } catch (err) {
      console.error("[chat] recallMemory failed:", err);
    }
  }

  // 长期记忆注入 + 早期对话摘要 → 拼入 System Prompt（会话内仅发送一次，不随每轮重复）
  const memorySection = buildMemorySection(memoryContext);
  const system = [
    pet.systemPrompt,
    memorySection || null,
    vipMemorySection || null,
    summary ? `\n\n# 早期对话摘要（已归档）\n${summary}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = streamText({
    model: getModel(),
    system,
    // 纯文本模型安全：丢弃 file/image/tool/reasoning 等非文本 part，
    // 避免 DashScope qwen-turbo 报 "Model only support text input"。
    messages: convertToModelMessages(sanitizeForTextModel(recentMessages)),
    tools: agentTools,
    // Agent loop: model may call tools, observe results, and respond
    // across up to 5 steps in a single turn.
    stopWhen: stepCountIs(5),
    // 对话流结束后：异步提取长期记忆（不阻塞回复）。
    // 记忆提取基于完整原始对话（messages），保证记忆质量不受上下文压缩影响。
    // 同样先 sanitize，防止老会话里残留的图片 part 误入长期记忆 prompt。
    onFinish: async (event) => {
      if (typeof adoptionId === "string" && adoptionId) {
        void updateMemory(adoptionId, sanitizeForTextModel(messages), event.text ?? "").catch((err) =>
          console.error("[memory] update failed:", err),
        );
      }
      // —— VIP 长期记忆提取（仅 VIP，异步不阻塞）——
      void hasMemoryAccess(user.id).then((hasAccess) => {
        if (!hasAccess) return;
        return extractMemories(user.id, sanitizeForTextModel(messages), {
          petId: memoryPetId,
        }).catch((err) =>
          console.error("[memory] extractMemories failed:", err),
        );
      }).catch((err) =>
        console.error("[memory] hasMemoryAccess check failed:", err),
      );
      // —— 聊天额度计数 +1（仅 free 用户；VIP 不计）——
      if (!isVip) {
        try {
          const quotaId = `quota-${user.id}-${today}`;
          await pool.query(
            `INSERT INTO chat_quotas (id, user_id, date, message_count, last_message_at)
             VALUES ($1, $2, $3, 1, now())
             ON CONFLICT (user_id, date)
             DO UPDATE SET message_count = chat_quotas.message_count + 1,
                           last_message_at = now()`,
            [quotaId, user.id, today],
          );
        } catch (err) {
          console.error("[chat] quota increment failed:", err);
        }
      }
    },
  });

  // 软提醒信息写入响应头（前端 useChat 完成后读取）
  const response = result.toUIMessageStreamResponse({
    // 透出真实错误到流里（默认只有 "An error occurred."），前端 error.message 可读、
    // 服务端同时打日志——否则上游模型 401/超时只会表现为「AI 无任何回复」。
    onError: (err) => {
      console.error("[chat] stream error:", err);
      const detail = err instanceof Error ? err.message : String(err);
      return `CHAT_STREAM_ERROR: ${detail.slice(0, 300)}`;
    },
  });
  if (softWarnMessage) {
    response.headers.set("x-quota-warning", encodeURIComponent(JSON.stringify({
      status,
      remaining,
      message: softWarnMessage,
    })));
  }
  response.headers.set("x-quota-status", status);
  response.headers.set("x-quota-remaining", String(remaining));
  return response;
}
