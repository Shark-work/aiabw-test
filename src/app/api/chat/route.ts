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

export const maxDuration = 60;

/** 免费畅聊条数：达到该条数后需要赞助解锁。 */
const FREE_MESSAGE_LIMIT = 10;

export async function POST(req: Request) {
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
  if (typeof adoptionId !== "string" || !adoptionId) {
    return NextResponse.json(
      { ok: false, error: apiError(locale, "noPermissionPet"), code: "OWNERSHIP_REQUIRED" },
      { status: 403 },
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
  const [adoption] = await db
    .select({
      userId: adoptions.userId,
      chatCount: adoptions.chatCount,
      isUnlocked: adoptions.isUnlocked,
      memoryContext: adoptions.memoryContext,
      petType: adoptions.petType,
    })
    .from(adoptions)
    .where(eq(adoptions.id, adoptionId))
    .limit(1);

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

  if (adoption.chatCount >= FREE_MESSAGE_LIMIT && !adoption.isUnlocked) {
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
          message: getHardLimitMessage(adoption.petType, locale),
        },
      },
      { status: 429 },
    );
  }

  memoryContext = adoption.memoryContext ?? null;

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
      ? getSoftWarnMessage(adoption.petType, locale, remaining)
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
        petId: adoptionId ?? null,
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
          petId: adoptionId ?? null,
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
  const response = result.toUIMessageStreamResponse();
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
