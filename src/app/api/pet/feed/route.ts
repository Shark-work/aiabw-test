import { NextResponse } from "next/server";

import { ensureDbSchemaOnce, pool } from "@/db/client";
import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from "@/lib/rate-limit";
import { movieInteractionByKind } from "@/lib/pet-play-config";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/pet/feed · 剧场侧栏一键互动（需求二.3：喂食扣余额 → 触发 eat → 恢复饥饿度）。
 *
 * 防抄袭红线（需求四）：余额扣除 / 数值结算 100% 在本路由事务内完成，前端只发 kind、渲染结果。
 * 事务（与 /api/pet/play/use 同模式）：
 *   宠物归属校验 → 锁 users FOR UPDATE → 余额不足 402 → 扣积分 + points_log('pet_movie_feed')
 *   → adoptions 饥饿度/心情按互动配置增量（0-100 clamp）→ 返回最新状态。
 *
 * 请求：{ adoptionId: string(uuid), kind: "food" | "toy" }
 * 响应：{ ok:true, kind, points, hungerLevel, happiness }
 * 错误：401 未登录 / 429 限流 / 400 参数 / 402 积分不足 / 403 非本人宠物 / 404 宠物不存在
 */
export async function POST(req: Request) {
  const locale = resolveLocale(req);
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: apiError(locale, "sessionExpired") },
      { status: 401 },
    );
  }

  const rl = checkRateLimit(`pet-feed:${user.id}`, RATE_LIMITS.petFeed);
  if (rl.limited) return rateLimitResponse(req, rl.retryAfterSec);

  let body: { adoptionId?: unknown; kind?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const adoptionId = typeof body.adoptionId === "string" ? body.adoptionId : "";
  const kind = typeof body.kind === "string" ? body.kind : "";
  const interaction = movieInteractionByKind(kind);
  if (!UUID_RE.test(adoptionId) || !interaction) {
    return NextResponse.json(
      { ok: false, error: apiError(locale, "petMovieKindInvalid") },
      { status: 400 },
    );
  }

  const client = await pool.connect();
  try {
    await ensureDbSchemaOnce();
    await client.query("BEGIN");

    // 宠物归属校验（事务内，防 TOCTOU 后状态漂移）
    const own = await client.query<{ ok: boolean }>(
      `SELECT (user_id = $2) AS ok FROM adoptions WHERE id = $1`,
      [adoptionId, user.id],
    );
    if (own.rows.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { ok: false, error: apiError(locale, "adoptionNotFound") },
        { status: 404 },
      );
    }
    if (own.rows[0].ok !== true) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { ok: false, error: apiError(locale, "petPlayForbidden") },
        { status: 403 },
      );
    }

    // 锁余额 → 扣积分（经济主约束；不足即 402 回滚）
    const bal = await client.query<{ points: number }>(
      `SELECT points FROM users WHERE id = $1 FOR UPDATE`,
      [user.id],
    );
    const current = Number(bal.rows[0]?.points ?? 0);
    if (current < interaction.cost) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { ok: false, code: "INSUFFICIENT_POINTS", error: apiError(locale, "insufficientPoints"), points: current },
        { status: 402 },
      );
    }
    const updPoints = await client.query<{ points: number }>(
      `UPDATE users SET points = points - $2 WHERE id = $1 RETURNING points`,
      [user.id, interaction.cost],
    );
    await client.query(
      `INSERT INTO points_log (user_id, amount, reason) VALUES ($1, $2, 'pet_movie_feed')`,
      [user.id, -interaction.cost],
    );

    // 养成状态结算（0-100 clamp，SQL 内完成——前端零数值逻辑）
    const upd = await client.query<{ hungerLevel: number; happiness: number }>(
      `UPDATE adoptions
          SET hunger_level = LEAST(100, GREATEST(0, hunger_level + $2)),
              happiness    = LEAST(100, GREATEST(0, happiness + $3)),
              last_interacted_at = now()
        WHERE id = $1
        RETURNING hunger_level AS "hungerLevel", happiness`,
      [adoptionId, interaction.hungerDelta, interaction.happinessDelta],
    );
    await client.query("COMMIT");

    return NextResponse.json({
      ok: true,
      kind: interaction.kind,
      points: Number(updPoints.rows[0]?.points ?? current - interaction.cost),
      hungerLevel: Number(upd.rows[0]?.hungerLevel ?? 0),
      happiness: Number(upd.rows[0]?.happiness ?? 0),
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[pet/feed] failed:", err);
    return NextResponse.json(
      { ok: false, error: apiError(locale, "petPlayFailed") },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
