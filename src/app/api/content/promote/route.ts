import { NextResponse } from "next/server";

import { pool, ensureDbSchemaOnce } from "@/db/client";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { getUserFromRequest } from "@/lib/auth";
import { PROMOTE_CONTENT_TYPE, PROMOTE_DAYS, PROMOTE_PRICING } from "@/lib/leaderboard";
import { redactSensitive } from "@/lib/privacy";

export const runtime = "nodejs";

/**
 * GET /api/content/promote — 我的可推广藏品实例列表（PromoteModal 数据源）
 *  - 鉴权；返回持有的 active user_collectibles 实例（id/名/图/稀有度/元素/代数）；
 *  - 每只附 promoting: 当前是否已有生效中的推广（前端置灰防重复购买）；
 *  - pricing：时长档位与价格（与 POST 同源，前端不做硬编码）。
 */
export async function GET(req: Request) {
  const locale = resolveLocale(req);
  try {
    await ensureDbSchemaOnce();
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: apiError(locale, "signInFirst") }, { status: 401 });
    }
    const { rows } = await pool.query(
      `SELECT uc.id, uc.generation, uc.hash_id AS "hashId",
              dc.name_zh AS "nameZh", dc.name_en AS "nameEn", dc.rarity, dc.element,
              dc.base_image_url AS "imageUrl",
              EXISTS(
                SELECT 1 FROM promoted_content pc
                 WHERE pc.content_type = $2 AND pc.content_id = uc.id AND pc.end_time > now()
              ) AS "promoting"
         FROM user_collectibles uc
         JOIN digital_collectibles dc ON dc.id = uc.collectible_id
        WHERE uc.owner_id = $1::uuid AND uc.status = 'active'
        ORDER BY uc.minted_at DESC
        LIMIT 50`,
      [user.id, PROMOTE_CONTENT_TYPE],
    );
    return NextResponse.json({
      ok: true,
      items: rows.map((r) => ({
        id: String(r.id),
        name: locale === "en" ? String(r.nameEn) : String(r.nameZh),
        rarity: String(r.rarity ?? "common"),
        element: r.element ? String(r.element) : null,
        generation: Number(r.generation ?? 1),
        hashId: String(r.hashId),
        imageUrl: String(r.imageUrl ?? ""),
        promoting: Boolean(r.promoting),
      })),
      pricing: PROMOTE_DAYS.map((d) => ({ days: d, cost: PROMOTE_PRICING[d] })),
    });
  } catch (err) {
    console.error("[content/promote] targets failed:", redactSensitive(err instanceof Error ? err.message : String(err)));
    return NextResponse.json({ ok: false, error: "promote_failed" }, { status: 500 });
  }
}

/**
 * POST /api/content/promote — 购买推荐曝光位
 * 请求体：{ contentId, days }（days ∈ 1/3/7；价格 100/250/500 积分）
 * 事务链（串行化 + 幂等）：
 *  1) pg_advisory_xact_lock(hashtext('promote:<contentId>'))：同藏品并发购买串行，后到者走 already_promoted；
 *  2) 生效窗口防重（content_id 级，任何人）：已推广中 → 409 already_promoted（不扣分）；
 *  3) 条件扣积分（points >= cost 原子防负）：0 行 → 402 insufficient_points { needed }；
 *  4) INSERT promoted_content（priority = days，时长越长坑位越靠前）；
 *  5) points_log 流水（amount=-cost, reason='promote', ref='promote:<id>' 唯一对账）。
 */
export async function POST(req: Request) {
  const locale = resolveLocale(req);
  try {
    await ensureDbSchemaOnce();
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: apiError(locale, "signInFirst") }, { status: 401 });
    }
    const body = (await req.json().catch(() => null)) as { contentId?: string; days?: number } | null;
    const contentId = typeof body?.contentId === "string" ? body.contentId.trim() : "";
    const days = Number(body?.days);
    if (!contentId || !(PROMOTE_DAYS as readonly number[]).includes(days)) {
      return NextResponse.json({ ok: false, error: apiError(locale, "promoteInvalidRequest") }, { status: 400 });
    }
    const cost = PROMOTE_PRICING[days];

    // 藏品归属与状态校验（事务外，纯读）
    const own = await pool.query(
      `SELECT owner_id, status FROM user_collectibles WHERE id = $1::uuid`,
      [contentId],
    );
    if (own.rows.length === 0) {
      return NextResponse.json({ ok: false, error: apiError(locale, "collectibleNotFound") }, { status: 404 });
    }
    if (String(own.rows[0].owner_id) !== user.id) {
      return NextResponse.json({ ok: false, error: apiError(locale, "noPermissionPet") }, { status: 403 });
    }
    if (String(own.rows[0].status) !== "active") {
      return NextResponse.json({ ok: false, error: apiError(locale, "collectibleInactive") }, { status: 400 });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // 1) 同藏品购买串行化
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`promote:${contentId}`]);
      // 2) 生效窗口防重
      const dup = await client.query(
        `SELECT id, end_time AS "endTime" FROM promoted_content
          WHERE content_type = $1 AND content_id = $2::uuid AND end_time > now()
          LIMIT 1`,
        [PROMOTE_CONTENT_TYPE, contentId],
      );
      if (dup.rows.length > 0) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { ok: false, error: "already_promoted", endTime: new Date(dup.rows[0].endTime).toISOString() },
          { status: 409 },
        );
      }
      // 3) 原子扣积分（防负余额竞态）
      const debit = await client.query(
        `UPDATE users SET points = points - $2 WHERE id = $1::uuid AND points >= $2 RETURNING points`,
        [user.id, cost],
      );
      if (debit.rows.length === 0) {
        await client.query("ROLLBACK");
        return NextResponse.json({ ok: false, error: "insufficient_points", needed: cost }, { status: 402 });
      }
      // 4) 创建推广记录
      const ins = await client.query(
        `INSERT INTO promoted_content (content_type, content_id, promoter_id, start_time, end_time, priority)
         VALUES ($1, $2::uuid, $3::uuid, now(), now() + make_interval(days => $4), $4)
         RETURNING id, start_time AS "startTime", end_time AS "endTime"`,
        [PROMOTE_CONTENT_TYPE, contentId, user.id, days],
      );
      const promotion = ins.rows[0];
      // 5) 积分流水（ref 唯一对账；唯一索引兜底重复提交）
      await client.query(
        `INSERT INTO points_log (user_id, amount, reason, ref) VALUES ($1::uuid, $2, 'promote', $3)`,
        [user.id, -cost, `promote:${promotion.id}`],
      );
      await client.query("COMMIT");
      return NextResponse.json({
        ok: true,
        promotion: {
          id: String(promotion.id),
          contentId,
          days,
          cost,
          startTime: new Date(promotion.startTime).toISOString(),
          endTime: new Date(promotion.endTime).toISOString(),
        },
        points: Number(debit.rows[0].points),
      });
    } catch (txErr) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("[content/promote] failed:", redactSensitive(err instanceof Error ? err.message : String(err)));
    return NextResponse.json({ ok: false, error: "promote_failed" }, { status: 500 });
  }
}

