import { NextResponse } from "next/server";

import { ensureDbSchemaOnce, pool } from "@/db/client";
import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { PLAY_ITEM_SOURCE, playItemByKey } from "@/lib/pet-play-config";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/pet/play/use · 使用互动道具（喂食 / 玩耍）。
 * 事务（防抄袭需求 2.1，状态变更 100% 后端）：
 *   锁取最早一件背包道具 → 无库存 409 → 删除该行 →
 *   adoptions 饥饿度/心情按商品数值增量（0-100 clamp）→ 返回最新状态。
 * 请求：{ itemKey, adoptionId }；响应：{ ok:true, hungerLevel, happiness, remaining }
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

  let body: { itemKey?: unknown; adoptionId?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const itemKey = typeof body.itemKey === "string" ? body.itemKey : "";
  const adoptionId = typeof body.adoptionId === "string" ? body.adoptionId : "";
  const item = playItemByKey(itemKey);
  if (!item || !UUID_RE.test(adoptionId)) {
    return NextResponse.json(
      { ok: false, error: apiError(locale, "petPlayItemUnknown") },
      { status: 400 },
    );
  }

  const client = await pool.connect();
  try {
    await ensureDbSchemaOnce();
    await client.query("BEGIN");

    // 宠物归属校验（行内校验，避免 TOCTOU 后再验一次的成本——先锁道具再校验归属足够）
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

    // 锁取最早一件（FIFO 消耗）
    const row = await client.query<{ id: string }>(
      `SELECT id FROM user_items
        WHERE user_id = $1 AND item_key = $2 AND source = $3
        ORDER BY created_at ASC LIMIT 1 FOR UPDATE`,
      [user.id, item.key, PLAY_ITEM_SOURCE],
    );
    if (row.rows.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { ok: false, code: "ITEM_EMPTY", error: apiError(locale, "petPlayItemEmpty") },
        { status: 409 },
      );
    }
    await client.query(`DELETE FROM user_items WHERE id = $1`, [row.rows[0].id]);

    const upd = await client.query<{ hungerLevel: number; happiness: number }>(
      `UPDATE adoptions
          SET hunger_level = LEAST(100, GREATEST(0, hunger_level + $2)),
              happiness    = LEAST(100, GREATEST(0, happiness + $3)),
              last_interacted_at = now()
        WHERE id = $1
        RETURNING hunger_level AS "hungerLevel", happiness`,
      [adoptionId, item.hungerDelta, item.happinessDelta],
    );
    const remain = await client.query<{ qty: string }>(
      `SELECT COUNT(*)::text AS qty FROM user_items WHERE user_id = $1 AND item_key = $2 AND source = $3`,
      [user.id, item.key, PLAY_ITEM_SOURCE],
    );
    await client.query("COMMIT");

    return NextResponse.json({
      ok: true,
      itemKey: item.key,
      hungerLevel: Number(upd.rows[0]?.hungerLevel ?? 0),
      happiness: Number(upd.rows[0]?.happiness ?? 0),
      remaining: Number(remain.rows[0]?.qty ?? 0),
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[pet/play/use] failed:", err);
    return NextResponse.json(
      { ok: false, error: apiError(locale, "petPlayFailed") },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
