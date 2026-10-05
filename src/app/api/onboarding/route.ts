import { NextResponse } from "next/server";

import { pool, ensureDbSchemaOnce } from "@/db/client";
import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";

export const runtime = "nodejs";

/** 新手引导完成奖励：首次完成五步引导发放（幂等，由 RETURNING 门控保证仅一次）。 */
const ONBOARDING_REWARD_POINTS = 10;

/**
 * GET /api/onboarding — 新手引导「唤醒仪式」状态查询
 * 响应：{ ok, completed, hasPet, candidates }
 *  - completed：users.onboarding_completed（五步引导完成标记）；
 *  - hasPet：是否已持有灵宠（adoptions 非空）——存量老用户天然跳过引导与 banner；
 *  - candidates：仅未完成且无灵宠时返回至多 3 只随机「待唤醒」灵宠（Phase 2 视觉化
 *    物种卡片选择），可领养口径与 /api/pets/claim 一致（visible=true 且 owner/guest_owner
 *    均为空）。
 *
 * POST /api/onboarding — 标记引导完成（幂等，重复调用结果一致）。
 * 首次完成（false → true 翻转成功）同事务发放引导奖励 +10 积分
 * （users.points += 10；points_log reason='onboarding_reward'），响应 reward 字段；
 * 重复调用 reward=null 不重复发放。
 */
export async function GET(req: Request) {
  const locale = resolveLocale(req);
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: apiError(locale, "signInFirst") },
      { status: 401 },
    );
  }
  try {
    await ensureDbSchemaOnce();
    const { rows: stateRows } = await pool.query(
      `SELECT u.onboarding_completed AS "completed",
              EXISTS(SELECT 1 FROM adoptions a WHERE a.user_id = u.id::text) AS "hasPet"
         FROM users u
        WHERE u.id = $1`,
      [user.id],
    );
    const completed = !!stateRows[0]?.completed;
    const hasPet = !!stateRows[0]?.hasPet;

    let candidates: Array<Record<string, unknown>> = [];
    if (!completed && !hasPet) {
      // Phase 2：视觉化物种卡片选择 —— 至多 3 只随机候选，前端卡片网格供用户挑选
      const { rows } = await pool.query(
        `SELECT p.id AS "petId", p.species_id AS "speciesId", p.image_url AS "imageUrl",
                p.traits, d.name_zh AS "nameZh", d.name_en AS "nameEn",
                d.category, d.habitat
           FROM pets p
           JOIN pet_dictionary d ON d.id = p.species_id
          WHERE p.visible = true AND p.owner_id IS NULL AND p.guest_owner IS NULL
          ORDER BY random()
          LIMIT 3`,
      );
      candidates = rows.map((row) => {
        const traits = (row.traits ?? {}) as Record<string, unknown>;
        return {
          petId: String(row.petId),
          speciesId: String(row.speciesId),
          name: locale === "en" ? String(row.nameEn) : String(row.nameZh),
          category: String(row.category),
          habitat: row.habitat ? String(row.habitat) : null,
          imageUrl: row.imageUrl ? String(row.imageUrl) : null,
          rarity: typeof traits.rarity === "string" ? traits.rarity : "common",
          element: typeof traits.element === "string" ? traits.element : null,
        };
      });
    }

    return NextResponse.json({ ok: true, completed, hasPet, candidates });
  } catch (err) {
    console.error("[onboarding] status failed:", err);
    return NextResponse.json(
      { ok: false, error: apiError(locale, "onboardingFailed") },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const locale = resolveLocale(req);
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: apiError(locale, "signInFirst") },
      { status: 401 },
    );
  }
  const client = await pool.connect();
  try {
    await ensureDbSchemaOnce();
    await client.query("BEGIN");
    // 仅 false → true 翻转成功才算「首次完成」（并发/重复调用幂等）
    const { rowCount } = await client.query(
      `UPDATE users SET onboarding_completed = true
        WHERE id = $1 AND onboarding_completed = false
        RETURNING id`,
      [user.id],
    );
    let reward: { points: number } | null = null;
    if ((rowCount ?? 0) > 0 && ONBOARDING_REWARD_POINTS > 0) {
      await client.query(
        `UPDATE users SET points = points + $2 WHERE id = $1`,
        [user.id, ONBOARDING_REWARD_POINTS],
      );
      await client.query(
        `INSERT INTO points_log (user_id, amount, reason) VALUES ($1, $2, 'onboarding_reward')`,
        [user.id, ONBOARDING_REWARD_POINTS],
      );
      reward = { points: ONBOARDING_REWARD_POINTS };
    }
    await client.query("COMMIT");
    return NextResponse.json({ ok: true, completed: true, reward });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[onboarding] complete failed:", err);
    return NextResponse.json(
      { ok: false, error: apiError(locale, "onboardingFailed") },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
