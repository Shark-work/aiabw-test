import { NextResponse } from "next/server";

import { pool } from "@/db/client";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { getUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * POST /api/postcard-wall/share-reward — 明信片墙分享奖励（Phase 7 · 7.8-3）
 *
 * 口径（防刷设计，零 schema 变更）：
 *  - 每日首次成功分享奖励 5 积分；ref = `share-wall:{userId}:{YYYY-MM-DD}`（DB 当日口径），
 *    points_log.ref 唯一索引 ON CONFLICT DO NOTHING 幂等——重复调用/并发/重放最多入账一次；
 *  - 事务化：流水插入成功才 users.points += 5（同事务原子，失败整体回滚）；
 *  - 不校验墙归属：分享自己或他人的墙均为平台传播行为，同一用户每日仅一次，奖励额小（5），
 *    滥用上限 150 分/月，风险可控；
 *  - 返回 { ok, rewarded, points }：rewarded=false 表示今日已领（前端静默不提示）。
 */
const SHARE_REWARD_POINTS = 5;

export async function POST(req: Request) {
  const locale = resolveLocale(req);
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: apiError(locale, "notSignedIn") },
      { status: 401 },
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ins = await client.query(
      `INSERT INTO points_log (user_id, amount, reason, ref)
       VALUES ($1::uuid, $2, 'share_reward', ` +
        `'share-wall:' || $1::text || ':' || to_char(now(), 'YYYY-MM-DD')` +
        `)
       ON CONFLICT (ref) DO NOTHING
       RETURNING id`,
      [user.id, SHARE_REWARD_POINTS],
    );
    if (ins.rowCount === 0) {
      await client.query("COMMIT");
      return NextResponse.json({ ok: true, rewarded: false, points: 0 });
    }
    await client.query(
      `UPDATE users SET points = points + $2 WHERE id = $1::uuid`,
      [user.id, SHARE_REWARD_POINTS],
    );
    await client.query("COMMIT");
    return NextResponse.json({ ok: true, rewarded: true, points: SHARE_REWARD_POINTS });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[api/postcard-wall/share-reward] failed:", err);
    return NextResponse.json(
      { ok: false, error: apiError(locale, "shareRewardFailed") },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
