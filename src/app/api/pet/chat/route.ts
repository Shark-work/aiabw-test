import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db, ensureDbSchemaOnce, pool } from "@/db/client";
import { adoptions } from "@/db/schema";
import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { moderateText } from "@/lib/content-moderation";
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from "@/lib/rate-limit";
import { generateThrottled } from "@/lib/llm-fallback";
import {
  buildWorkerCatPrompt,
  fallbackPlayReply,
  parsePlayResponse,
  PLAY_CHAT_COST,
  PLAY_CHAT_HUNGER_DECAY,
  type PlayReply,
} from "@/lib/pet-play-config";

export const runtime = "nodejs";
export const maxDuration = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/pet/chat · AI 宠物互动页对话（打工橘猫人设，严格 JSON 契约）。
 *
 * 防抄袭红线（需求 2.1）：
 *  - 状态判断 / 大模型调用 / 积分扣除 100% 在本路由完成；前端只发消息、渲染
 *    { reply, emotion, action }；大模型密钥仅存在于服务端环境变量（DEEPSEEK_* 等，
 *    经 llm-fallback 多 provider 降级链读取），客户端 bundle 零密钥、零 prompt。
 *  - 输入/输出双向内容审核（Phase 8 moderateText）；输出 JSON 白名单归一。
 *
 * 请求：{ adoptionId: string(uuid), message: string(1-500) }
 * 响应：{ ok:true, reply, emotion, action, points, happiness, hungerLevel, source }
 * 错误：401 未登录 / 429 限流 / 400 审核或参数 / 402 积分不足 / 403 非本人宠物 / 404 宠物不存在
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

  // 2) 限流（防连点/脚本；积分扣除是经济主约束）
  const rl = checkRateLimit(`pet-play:${user.id}`, RATE_LIMITS.petPlay);
  if (rl.limited) return rateLimitResponse(req, rl.retryAfterSec);

  // 3) 参数校验
  let body: { adoptionId?: unknown; message?: unknown };
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
  if (!message || message.length > 500) {
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

    // 5) 宠物归属校验
    const [pet] = await db
      .select({
        id: adoptions.id,
        userId: adoptions.userId,
        petName: adoptions.petName,
        happiness: adoptions.happiness,
        hungerLevel: adoptions.hungerLevel,
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

    // 6) 积分扣除（事务：行锁校验余额 → 扣分 → 流水；不足整体回滚）
    let points = 0;
    {
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
    }

    // 7) 大模型生成（服务端密钥；并发限速 + 跨 provider 降级；失败走本地兜底，功能永可用）
    let result: PlayReply;
    let source: "ai" | "fallback" = "ai";
    try {
      const r = await generateThrottled({
        system: buildWorkerCatPrompt({
          petName: pet.petName,
          happiness: pet.happiness,
          hungerLevel: pet.hungerLevel,
        }),
        prompt: message,
        temperature: 0.9,
        maxOutputTokens: 220,
      });
      const parsed = parsePlayResponse(r.text);
      result = parsed ?? fallbackPlayReply(message, locale);
      if (!parsed) source = "fallback";
    } catch (err) {
      console.warn("[pet/chat] AI unavailable, local fallback:", err instanceof Error ? err.message : err);
      result = fallbackPlayReply(message, locale);
      source = "fallback";
    }

    // 8) 输出内容审核（AI 输出命中词表 → 替换为安全兜底文案，不回传命中词）
    if (!moderateText(result.reply).ok) {
      result = fallbackPlayReply("", locale);
      source = "fallback";
    }

    // 9) 养成状态推进 + 对话流水（best-effort：回复已生成、积分已扣，写库失败不影响返回）
    const happiness = Math.max(0, Math.min(100, pet.happiness + 1));
    const hungerLevel = Math.max(0, pet.hungerLevel - PLAY_CHAT_HUNGER_DECAY);
    try {
      await pool.query(
        `INSERT INTO pet_play_logs (user_id, adoption_id, user_input, pet_reply, emotion, action)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [user.id, adoptionId, message, result.reply, result.emotion, result.action],
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

    // 10) 统一 JSON 契约（需求 1.2：reply / emotion / action 三字段永远在）
    return NextResponse.json({
      ok: true,
      reply: result.reply,
      emotion: result.emotion,
      action: result.action,
      points,
      happiness,
      hungerLevel,
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

