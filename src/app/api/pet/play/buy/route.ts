import { NextResponse } from "next/server";

import { ensureDbSchemaOnce, pool } from "@/db/client";
import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { PLAY_ITEM_SOURCE, playItemByKey } from "@/lib/pet-play-config";

export const runtime = "nodejs";

/**
 * POST /api/pet/play/buy · 购买互动道具（侧边栏「购买按钮」）。
 * 扣费/入库 100% 后端事务（防抄袭需求 2.1）：
 *   行锁读余额 → 不足整体回滚 402 → 扣积分 → points_log → user_items(source='pet_play') 入库。
 * 请求：{ itemKey }；响应：{ ok:true, points, itemKey, owned }
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

  let body: { itemKey?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const itemKey = typeof body.itemKey === "string" ? body.itemKey : "";
  const item = playItemByKey(itemKey);
  if (!item) {
    return NextResponse.json(
      { ok: false, error: apiError(locale, "petPlayItemUnknown") },
      { status: 400 },
    );
  }

  const client = await pool.connect();
  try {
    await ensureDbSchemaOnce();
    await client.query("BEGIN");

    const bal = await client.query<{ points: number }>(
      `SELECT points FROM users WHERE id = $1 FOR UPDATE`,
      [user.id],
    );
    const current = Number(bal.rows[0]?.points ?? 0);
    if (current < item.price) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { ok: false, code: "INSUFFICIENT_POINTS", error: apiError(locale, "insufficientPoints"), points: current },
        { status: 402 },
      );
    }

    const upd = await client.query<{ points: number }>(
      `UPDATE users SET points = points - $2 WHERE id = $1 RETURNING points`,
      [user.id, item.price],
    );
    await client.query(
      `INSERT INTO points_log (user_id, amount, reason) VALUES ($1, $2, 'pet_play_buy')`,
      [user.id, -item.price],
    );
    await client.query(
      `INSERT INTO user_items (user_id, item_key, rarity, source) VALUES ($1, $2, 'common', $3)`,
      [user.id, item.key, PLAY_ITEM_SOURCE],
    );
    const owned = await client.query<{ qty: string }>(
      `SELECT COUNT(*)::text AS qty FROM user_items WHERE user_id = $1 AND item_key = $2 AND source = $3`,
      [user.id, item.key, PLAY_ITEM_SOURCE],
    );
    await client.query("COMMIT");

    return NextResponse.json({
      ok: true,
      points: Number(upd.rows[0]?.points ?? current - item.price),
      itemKey: item.key,
      owned: Number(owned.rows[0]?.qty ?? 1),
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[pet/play/buy] failed:", err);
    return NextResponse.json(
      { ok: false, error: apiError(locale, "buyFailed") },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
