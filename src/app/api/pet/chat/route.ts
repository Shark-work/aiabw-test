import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db, ensureDbSchemaOnce, pool } from "@/db/client";
import { adoptions } from "@/db/schema";
import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { moderateText } from "@/lib/content-moderation";
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from "@/lib/rate-limit";
import { fallbackPetReply } from "@/lib/pets/characters";
import { resolvePetIntent } from "@/lib/pets/intent-resolver";
import {
  actionForMood,
  HUNGER_SETTLE_SQL,
  HUNGRY_THRESHOLD,
  PET_CHAT_DAILY_CAP,
  PET_CHAT_FREE_DAILY,
  PET_CHAT_MAX_LEN,
  PLAY_CHAT_COST,
  PLAY_CHAT_HUNGER_DECAY,
  type PetChatReply,
} from "@/lib/pet-play-config";

export const runtime = "nodejs";
export const maxDuration = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 客户端 IP（需求六.1 IP 维度限流；与 login-security 同取 x-forwarded-for 首跳）。 */
function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim() || "unknown";
  return req.headers.get("x-real-ip") ?? "unknown";
}

/**
 * POST /api/pet/chat · AI 宠物对话（统一 { text, mood, intensity } 契约，需求三.3）。
 *
 * 防抄袭红线（需求 2.1）：状态判断 / 大模型调用 / 积分扣除 100% 在本路由完成；
 * 前端只发消息、渲染契约 JSON；System Prompt 由 characters.ts 角色注册表构建
 * （雪豹不再用橘猫人设——需求一.3），密钥仅存服务端环境变量。
 *
 * 计费（需求五）：每日前 PET_CHAT_FREE_DAILY 句免费（kind='chat' 日志行计数）；
 * 超出后每句 PLAY_CHAT_COST 积分事务扣除（402 引导充值）；**AI 全 provider 失败 →
 * 已扣积分自动退款（pet_play_refund）且日志 kind='chat_refund' 不占免费次数**（需求五.2）。
 *
 * 风控（需求六）：用户 30/min + IP 60/min 双维限流；单条 500 字；每日 PET_CHAT_DAILY_CAP 封顶；
 * 调用日志（耗时/token/来源）落 pet_play_logs（需求六.3 成本核算）。
 *
 * 请求：{ adoptionId: string(uuid), message: string(1-500), mode?: string（legacy 兼容，忽略） }
 * 响应：{ ok:true, text, mood, intensity, action, points, freeRemaining, happiness, hungerLevel, hungry, source }
 * 错误：401 未登录 / 429 限流或日上限 / 400 审核或参数 / 402 积分不足 / 403 非本人宠物 / 404 宠物不存在
 */
export async function POST(req: Request) {
  const locale = resolveLocale(req);

  // 1) 身份校验（JWT Bearer）
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: apiError(locale, "sessionExpired") },
      { status: 401 },
    );
  }

  // 2) 双维限流（需求六.1：用户 + IP）
  const rl = checkRateLimit(`pet-play:${user.id}`, RATE_LIMITS.petPlay);
  if (rl.limited) return rateLimitResponse(req, rl.retryAfterSec);
  const rlIp = checkRateLimit(`pet-chat-ip:${clientIp(req)}`, RATE_LIMITS.petChatIp);
  if (rlIp.limited) return rateLimitResponse(req, rlIp.retryAfterSec);

  // 3) 参数校验（单条长度上限 PET_CHAT_MAX_LEN，需求六.2）
  let body: { adoptionId?: unknown; message?: unknown; mode?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const adoptionId = typeof body.adoptionId === "string" ? body.adoptionId : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!UUID_RE.test(adoptionId)) {
    return NextResponse.json(
      { ok: false, error: apiError(locale, "adoptionIdRequired") },
      { status: 400 },
    );
  }
  if (!message || message.length > PET_CHAT_MAX_LEN) {
    return NextResponse.json(
      { ok: false, error: apiError(locale, "petPlayMessageInvalid") },
      { status: 400 },
    );
  }

  // 4) 输入内容审核（Phase 8 统一词表，先于任何 AI 调用与扣费）
  if (!moderateText(message).ok) {
    return NextResponse.json(
      { ok: false, error: apiError(locale, "inappropriateContent") },
      { status: 400 },
    );
  }

  try {
    await ensureDbSchemaOnce();

    // 5) 宠物归属校验 + 离线饥饿结算（需求四.4：回到页面/发起互动时按离线整小时衰减）
    const [pet] = await db
      .select({
        id: adoptions.id,
        userId: adoptions.userId,
        petName: adoptions.petName,
        petType: adoptions.petType,
        happiness: adoptions.happiness,
        hungerLevel: adoptions.hungerLevel,
        lastInteractedAt: adoptions.lastInteractedAt,
      })
      .from(adoptions)
      .where(eq(adoptions.id, adoptionId))
      .limit(1);
    if (!pet) {
      return NextResponse.json(
        { ok: false, error: apiError(locale, "adoptionNotFound") },
        { status: 404 },
      );
    }
    if (pet.userId !== user.id) {
      return NextResponse.json(
        { ok: false, error: apiError(locale, "petPlayForbidden") },
        { status: 403 },
      );
    }
    // 距上次互动小时数（必须在结算刷新 last_interacted_at 前捕获；意图解析久别修正用）
    const absenceHours = pet.lastInteractedAt
      ? Math.max(0, (Date.now() - new Date(pet.lastInteractedAt).getTime()) / 3_600_000)
      : 0;
    const settled = await pool.query<{ hungerLevel: number }>(
      `UPDATE adoptions SET ${HUNGER_SETTLE_SQL}, last_interacted_at = now()
        WHERE id = $1 RETURNING hunger_level AS "hungerLevel"`,
      [adoptionId],
    );
    const settledHunger = Number(settled.rows[0]?.hungerLevel ?? pet.hungerLevel);

    // 6) 每日上限 + 免费额度（同一计数：当日 kind='chat' 日志行数；chat_refund 不占次）
    const cnt = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM pet_play_logs
        WHERE user_id = $1 AND kind = 'chat' AND created_at::date = CURRENT_DATE`,
      [user.id],
    );
    const todayChats = Number(cnt.rows[0]?.n ?? 0);
    if (todayChats >= PET_CHAT_DAILY_CAP) {
      return NextResponse.json(
        { ok: false, code: "DAILY_CAP", error: apiError(locale, "petChatDailyCap") },
        { status: 429 },
      );
    }
    const charged = todayChats >= PET_CHAT_FREE_DAILY;

    // 7) 扣费（仅超出免费额度；事务：行锁校验余额 → 扣分 → 流水；不足整体回滚 402）
    let points = 0;
    if (charged) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const bal = await client.query<{ points: number }>(
          `SELECT points FROM users WHERE id = $1 FOR UPDATE`,
          [user.id],
        );
        const current = Number(bal.rows[0]?.points ?? 0);
        if (current < PLAY_CHAT_COST) {
          await client.query("ROLLBACK");
          return NextResponse.json(
            { ok: false, code: "INSUFFICIENT_POINTS", error: apiError(locale, "insufficientPoints"), points: current },
            { status: 402 },
          );
        }
        const upd = await client.query<{ points: number }>(
          `UPDATE users SET points = points - $2 WHERE id = $1 RETURNING points`,
          [user.id, PLAY_CHAT_COST],
        );
        await client.query(
          `INSERT INTO points_log (user_id, amount, reason) VALUES ($1, $2, 'pet_play')`,
          [user.id, -PLAY_CHAT_COST],
        );
        await client.query("COMMIT");
        points = Number(upd.rows[0]?.points ?? current - PLAY_CHAT_COST);
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    } else {
      const balRes = await pool.query<{ points: number }>(
        `SELECT points FROM users WHERE id = $1`,
        [user.id],
      );
      points = Number(balRes.rows[0]?.points ?? 0);
    }

    // 8) 意图情绪解析（intent-resolver：关键词零成本短路 → LLM 严格契约 5s → 降级链；
    //    角色人设按宠物物种解析——需求一.3：显示雪豹就是雪豹人设，不再硬编码橘猫）。
    //    降级退款（需求五.2）：source=fallback（AI 没工作）→ 已扣积分退回 + 日志 chat_refund。
    const resolution = await resolvePetIntent({
      message,
      locale,
      petType: pet.petType,
      petName: pet.petName,
      happiness: pet.happiness,
      hungerLevel: settledHunger,
      absenceHours,
    });
    let result: PetChatReply = {
      text: resolution.reply,
      mood: resolution.emotion,
      intensity: resolution.intensity,
      action: actionForMood(resolution.emotion),
    };
    let source = resolution.source;
    const refunded = source === "fallback" && charged;
    const durationMs = resolution.llmMs ?? null;
    const tokensUsed = resolution.tokens ?? null;
    console.info(
      `[pet/chat] intent=${resolution.intent} emotion=${resolution.emotion} source=${source} llmMs=${durationMs ?? "-"} tokens=${tokensUsed ?? "-"}`,
    );

    // 退款（需求五.2：AI 没工作就不收费；积分退回 + 流水负负相抵）
    if (refunded) {
      try {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const upd = await client.query<{ points: number }>(
            `UPDATE users SET points = points + $2 WHERE id = $1 RETURNING points`,
            [user.id, PLAY_CHAT_COST],
          );
          await client.query(
            `INSERT INTO points_log (user_id, amount, reason) VALUES ($1, $2, 'pet_play_refund')`,
            [user.id, PLAY_CHAT_COST],
          );
          await client.query("COMMIT");
          points = Number(upd.rows[0]?.points ?? points + PLAY_CHAT_COST);
        } finally {
          client.release();
        }
      } catch (err) {
        console.error("[pet/chat] refund failed:", err);
      }
    }

    // 9) 输出内容审核（AI 输出命中词表 → 替换为安全兜底文案，不回传命中词；已计费不退——
    //    内容安全替换属于正常服务，AI 确实出了文）
    if (!moderateText(result.text).ok) {
      result = fallbackPetReply("", locale, pet.petType);
      source = "fallback";
    }

    // 10) 养成状态推进 + 调用日志（需求六.3：耗时/token/来源落库，成本核算可审计）
    const happiness = Math.max(0, Math.min(100, pet.happiness + 1));
    const hungerLevel = Math.max(0, settledHunger - PLAY_CHAT_HUNGER_DECAY);
    try {
      await pool.query(
        `INSERT INTO pet_play_logs (user_id, adoption_id, user_input, pet_reply, emotion, action, kind, source, duration_ms, tokens_used)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          user.id, adoptionId, message, result.text, result.mood,
          resolution.intent !== "idle" ? resolution.intent : result.action,
          refunded ? "chat_refund" : "chat", source, durationMs, tokensUsed,
        ],
      );
      await pool.query(
        `UPDATE adoptions
            SET happiness = $2, hunger_level = $3, last_interacted_at = now(), chat_count = chat_count + 1
          WHERE id = $1`,
        [adoptionId, happiness, hungerLevel],
      );
    } catch (err) {
      console.error("[pet/chat] persist failed:", err);
    }

    // 11) 统一契约响应（需求三.3：{ text, mood, intensity }；action 已由映射表推导）
    return NextResponse.json({
      ok: true,
      text: result.text,
      mood: result.mood,
      emotion: resolution.emotion,
      intensity: result.intensity,
      action: result.action,
      intent: resolution.intent,
      points,
      freeRemaining: Math.max(0, PET_CHAT_FREE_DAILY - todayChats - (refunded ? 0 : 1)),
      happiness,
      hungerLevel,
      hungry: hungerLevel <= HUNGRY_THRESHOLD,
      source,
    });
  } catch (err) {
    console.error("[pet/chat] failed:", err);
    return NextResponse.json(
      { ok: false, error: apiError(locale, "petPlayFailed") },
      { status: 500 },
    );
  }
}
