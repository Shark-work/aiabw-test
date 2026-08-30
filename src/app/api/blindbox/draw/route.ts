import { NextResponse } from "next/server";

import { pool, ensureDbSchemaOnce } from "@/db/client";
import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { executeBlindboxDraw } from "@/lib/blindbox-draw";
import { postBreedShare } from "@/lib/social-poster";
import {
  buildXorpaySign,
  createXorpayOrder,
  getXorpayPayType,
  resolveNotifyUrl,
} from "@/lib/xorpay";

export const runtime = "nodejs";

/** 现金通道（积分不足兜底）创建 XorPay 盲盒订单；返回 { orderId, qr, payUrl, amount }。 */
async function createCashOrder(locale: string, poolRow: Record<string, unknown>, userId: string) {
  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const orderId = `blindbox-${String(poolRow.id)}-${userId}-${nonce}`;
  const name = locale === "en" ? String(poolRow.nameEn) : String(poolRow.nameZh);
  const price = Number(poolRow.priceCny ?? 0).toFixed(2);
  const pay_type = getXorpayPayType();
  const notify_url = resolveNotifyUrl();
  const sign = buildXorpaySign({ name, pay_type, price, order_id: orderId, notify_url });

  const { ok, data, error } = await createXorpayOrder({
    order_id: orderId,
    name,
    price,
    pay_type,
    notify_url,
    sign,
  });
  if (!ok) throw new Error(error ?? "XORPAY_ORDER_FAILED");

  const d = (data ?? {}) as Record<string, unknown>;
  const info = (d.info ?? {}) as Record<string, unknown>;
  const qr = (d.qr ?? d.qrcode ?? d.url ?? d.pay_url ?? d.payurl ?? info.qr ?? info.url ?? info.payurl) as string | undefined;
  if (!qr) throw new Error("XORPAY_NO_QR");
  return {
    orderId,
    qr,
    payUrl: (d.url ?? d.pay_url ?? info.url ?? null) as string | null,
    amount: Number(price),
  };
}

/** 现金订单已支付（notify 已抽取）→ 组装抽取结果供前端轮询返回。 */
const CASH_RESULT_SQL = `
  SELECT l.is_legendary, l.cost,
         u.id AS "mintedId", u.hash_id AS "hashId", u.collectible_id AS "collectibleId",
         u.generation, u.locked_until AS "lockedUntil",
         d.id AS "speciesId", d.name_zh AS "nameZh", d.name_en AS "nameEn",
         c.element AS "element", c.rarity AS "rarity",
         (SELECT p.image_url FROM pets p WHERE p.species_id = d.id AND p.image_url IS NOT NULL LIMIT 1) AS "imageUrl"
    FROM blindbox_logs l
    JOIN user_collectibles u ON u.hash_id = l.result_hash_id
    JOIN digital_collectibles c ON c.id = u.collectible_id
    JOIN pet_dictionary d ON d.id = c.species_id
   WHERE l.order_id = $1
   LIMIT 1`;

/**
 * POST /api/blindbox/draw — 盲盒抽奖
 * 请求体：{ poolId, paymentMethod?: "points" | "cash", orderId?: string }
 *  - paymentMethod="points"（默认）：积分通道（事务原子扣费 / 铸造 / 流水）；
 *  - paymentMethod="cash"：积分不足兜底，创建 XorPay 现金订单
 *    （支付完成由 pay/notify 回调触发抽取；本接口负责下单 + 前端「结果轮询」返回）。
 */
export async function POST(req: Request) {
  const locale = resolveLocale(req);
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: apiError(locale, "signInFirst") }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    const poolId = typeof body?.poolId === "string" ? body.poolId.trim() : "";
    const paymentMethod: "points" | "cash" = body?.paymentMethod === "cash" ? "cash" : "points";
    const orderIdParam = typeof body?.orderId === "string" ? body.orderId.trim() : "";
    if (!poolId) {
      return NextResponse.json({ ok: false, error: apiError(locale, "invalidBlindboxPool") }, { status: 400 });
    }

    await ensureDbSchemaOnce();

    // 奖池校验（两通道共用）
    const poolRes = await pool.query(
      `SELECT id, name_zh AS "nameZh", name_en AS "nameEn", price_cny AS "priceCny",
              price_points AS "pricePoints", probabilities, species_ids AS "speciesIds",
              is_active AS "isActive", is_daily AS "isDaily"
         FROM blindbox_pools WHERE id = $1 LIMIT 1`,
      [poolId],
    );
    const poolRow = poolRes.rows[0];
    if (!poolRow || poolRow.isActive === false) {
      return NextResponse.json({ ok: false, error: apiError(locale, "blindboxUnavailable") }, { status: 404 });
    }
    const priceCny = Number(poolRow.priceCny ?? 0);
    const pricePoints = Number(poolRow.pricePoints ?? 200);

    // 价格红线：全站最低 1 元（运营硬校验，防 0.x 元残留）
    if (priceCny < 1) {
      return NextResponse.json({ ok: false, error: apiError(locale, "blindboxPriceInvalid") }, { status: 400 });
    }

    // ============ 现金通道（积分不足兜底）============
    if (paymentMethod === "cash") {
      // 1) 结果轮询：orderId 已支付且已抽取 → 返回该次开箱结果（幂等）
      if (orderIdParam) {
        const logRes = await pool.query(
          `SELECT 1 FROM blindbox_logs WHERE order_id = $1 LIMIT 1`,
          [orderIdParam],
        );
        if (logRes.rows.length > 0) {
          const detail = await pool.query(CASH_RESULT_SQL, [orderIdParam]);
          const r = detail.rows[0];
          if (r) {
            const isLegendary = !!r.isLegendary;
            const speciesNameZh = String(r.nameZh);
            const nfr = {
              id: String(r.mintedId),
              hashId: String(r.hashId),
              collectibleId: String(r.collectibleId),
              speciesId: String(r.speciesId),
              speciesName: locale === "en" ? String(r.nameEn) : speciesNameZh,
              rarity: String(r.rarity),
              element: String(r.element),
              generation: Number(r.generation),
              imageUrl: r.imageUrl ? String(r.imageUrl) : "",
              lockedUntil: r.lockedUntil ? String(r.lockedUntil) : null,
            };
            if (isLegendary) {
              void postBreedShare({
                speciesName: speciesNameZh,
                rarity: "legendary",
                element: String(r.element),
                generation: Number(r.generation),
                hashId: String(r.hashId),
              }).catch((err) => console.error("[blindbox] 社交分享异常(非阻塞):", err));
            }
            return NextResponse.json({
              ok: true,
              isLegendary,
              rarity: String(r.rarity),
              poolId,
              nfr,
            });
          }
        }
        // 未支付：返回订单信息，前端继续轮询
        return NextResponse.json({ ok: true, needPayment: true, orderId: orderIdParam, amount: priceCny });
      }

      // 2) 每日福利箱：现金通道每日限购 1 次（复用 blindbox_logs.created_at 判定）
      if (poolRow.isDaily === true) {
        const claimed = await pool.query(
          `SELECT 1 FROM blindbox_logs
            WHERE user_id = $1 AND pool_id = $2
              AND created_at::date = CURRENT_DATE
            LIMIT 1`,
          [user.id, poolId],
        );
        if (claimed.rows.length > 0) {
          return NextResponse.json({ ok: false, error: apiError(locale, "dailyBonusClaimed") }, { status: 429 });
        }
      }

      // 3) 创建新现金订单
      try {
        const order = await createCashOrder(locale, poolRow, user.id);
        return NextResponse.json({ ok: true, needPayment: true, ...order, poolId });
      } catch (err) {
        console.error("[blindbox/draw] cash order failed:", err);
        return NextResponse.json({ ok: false, error: apiError(locale, "orderCreateFailed") }, { status: 502 });
      }
    }

    // ============ 积分通道（默认）============
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 1) 锁定奖池（防并发超卖）
      const { rows: lockRows } = await client.query(
        `SELECT id FROM blindbox_pools WHERE id = $1 AND is_active = true FOR UPDATE`,
        [poolId],
      );
      if (lockRows.length === 0) {
        await client.query("ROLLBACK");
        return NextResponse.json({ ok: false, error: apiError(locale, "blindboxUnavailable") }, { status: 404 });
      }

      // 2) 原子扣积分（行锁：points >= price_points 才成功）
      const cost = await client.query(
        `UPDATE users SET points = points - $1 WHERE id = $2 AND points >= $1`,
        [pricePoints, user.id],
      );
      if (cost.rowCount === 0) {
        await client.query("ROLLBACK");
        return NextResponse.json({ ok: false, error: apiError(locale, "notEnoughPoints") }, { status: 402 });
      }
      await client.query(
        `INSERT INTO points_log (user_id, amount, reason) VALUES ($1, $2, 'blindbox')`,
        [user.id, -pricePoints],
      );
      // 3) 执行抽奖（概率 / 物种 / 铸造 / 流水，同一事务）
      const result = await executeBlindboxDraw(client, {
        userId: user.id,
        poolId,
        payMethod: "points",
        cost: pricePoints,
      });
      if (!result) {
        await client.query("ROLLBACK");
        return NextResponse.json({ ok: false, error: apiError(locale, "blindboxFailed") }, { status: 500 });
      }
      const { rarity, isLegendary } = result;

      await client.query("COMMIT");

      // 4) 社交炫耀：传说级 → 异步非阻塞（失败仅记录日志，不影响抽奖结果）
      if (isLegendary) {
        void postBreedShare({
          speciesName: result.speciesNameZh,
          rarity: "legendary",
          element: result.element,
          generation: 1,
          hashId: result.hashId,
        }).catch((err) => console.error("[blindbox] 社交分享异常(非阻塞):", err));
      }

      return NextResponse.json({
        ok: true,
        isLegendary,
        rarity,
        poolId,
        nfr: {
          id: result.mintedId,
          hashId: result.hashId,
          collectibleId: result.collectibleId,
          speciesId: result.speciesId,
          speciesName: locale === "en" ? result.speciesNameEn : result.speciesNameZh,
          rarity,
          element: result.element,
          generation: 1,
          imageUrl: result.imageUrl,
          lockedUntil: result.lockedUntil,
        },
      });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("[blindbox/draw] failed:", err);
    return NextResponse.json({ ok: false, error: apiError(locale, "blindboxFailed") }, { status: 500 });
  }
}
