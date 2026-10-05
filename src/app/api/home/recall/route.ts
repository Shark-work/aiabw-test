import { NextResponse } from "next/server";

import { pool, ensureDbSchemaOnce } from "@/db/client";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { getUserFromRequest } from "@/lib/auth";
import { buildReminders } from "@/lib/recall-config";

export const runtime = "nodejs";

/**
 * GET /api/home/recall — 首页「回来看看」提醒聚合（P2 社交传播 · 改动四）
 *
 * Bearer 鉴权（未登录 → 401，前端 banner 静默不渲染）。
 * 响应 { ok, reminders }：三类提醒可叠加（missYou / feed / reward），
 * 判定逻辑在 recall-config.buildReminders 纯函数（阈值 RECALL_AWAY_HOURS / RECALL_LOW_HAPPINESS）。
 *
 * 数据源：
 *  - users.last_login_at（每次登录更新，login-security 维护）；
 *  - adoptions 最低幸福度（持有灵宠按 happiness 升序取 1）；
 *  - 集齐未领取的明信片系列数（与明信片墙同口径：event_id 系列去重 + achievements 领取记录）。
 */
export async function GET(req: Request) {
  const locale = resolveLocale(req);
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: apiError(locale, "notSignedIn") },
      { status: 401 },
    );
  }
  try {
    await ensureDbSchemaOnce();
    const [loginRes, petRes, setsRes] = await Promise.all([
      pool.query(`SELECT last_login_at AS "lastLoginAt" FROM users WHERE id = $1::uuid LIMIT 1`, [
        user.id,
      ]),
      pool.query(
        `SELECT pet_name AS "petName", happiness
           FROM adoptions
          WHERE user_id = $1::text
          ORDER BY happiness ASC
          LIMIT 1`,
        [user.id],
      ),
      pool.query(
        `WITH sets AS (
           SELECT pet_category AS cat, count(*)::int AS total
             FROM exploration_events
            WHERE event_type = 'postcard'
            GROUP BY pet_category
         ), owned AS (
           SELECT e.pet_category AS cat, count(DISTINCT r.event_id)::int AS n
             FROM exploration_records r
             JOIN exploration_events e ON e.id = r.event_id
            WHERE r.user_id = $1::uuid AND r.result_type = 'postcard'
            GROUP BY e.pet_category
         )
         SELECT count(*)::int AS n
           FROM sets s
           JOIN owned o ON o.cat = s.cat AND o.n >= s.total
          WHERE NOT EXISTS (
            SELECT 1 FROM achievements a
             WHERE a.user_id = $1::uuid AND a.badge_id = 'postcard-' || s.cat
          )`,
        [user.id],
      ),
    ]);

    const pet = petRes.rows[0];
    const reminders = buildReminders({
      lastLoginAt: loginRes.rows[0]?.lastLoginAt
        ? new Date(loginRes.rows[0].lastLoginAt)
        : null,
      lowestHappiness: pet ? Number(pet.happiness) : null,
      lowestPetName: pet ? String(pet.petName) : null,
      unclaimedSets: Number(setsRes.rows[0]?.n ?? 0),
    });

    return NextResponse.json({ ok: true, reminders });
  } catch (err) {
    console.error("[/api/home/recall] failed:", err);
    return NextResponse.json(
      { ok: false, error: apiError(locale, "recallFailed") },
      { status: 500 },
    );
  }
}
