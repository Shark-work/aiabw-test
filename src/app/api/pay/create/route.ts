import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db, ensureDbSchemaOnce, pool } from "@/db/client";
import { adoptions, cosmetics, blindboxPools, users } from "@/db/schema";
import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { PREMIUM_PRICE_CNY } from "@/lib/premium";
import { findPointsPack } from "@/lib/points-recharge";
import { PROMOTE_CONTENT_TYPE } from "@/lib/leaderboard";
import {
  BREED_ACCEL_PRICE_CNY,
  CHAT_PACK_MESSAGES,
  CHAT_PACK_PRICE_CNY,
  PROMO_CASH_PRICE_CNY,
  VIP_YEARLY_DAYS,
  VIP_YEARLY_PRICE_CNY,
} from "@/lib/monetization-products";
import { CHECKIN_MAKEUP_PRICE_CNY, localDateStr, makeupOrderId } from "@/lib/checkin-makeup";
import {
  XORPAY_AID,
  XORPAY_APP_SECRET,
  XORPAY_PRODUCT_NAME,
  buildXorpaySign,
  createXorpayOrder,
  getXorpayPayType,
  resolveNotifyUrl,
} from "@/lib/xorpay";

export const runtime = "nodejs";

const DEFAULT_AMOUNT = 9.9;

/**
 * POST /api/pay/create
 * 请求体：{ adoptionId: string, amount?: number }
 *
 * 1. 校验领养记录存在，且属于当前登录用户；
 * 2. 按 XorPay 规范计算 MD5 签名（name + pay_type + price + order_id + notify_url + app_secret）；
 * 3. 调用 https://xorpay.com/api/pay/{aid} 统一下单；
 * 4. 返回支付二维码内容（qr）给前端渲染。
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const locale = resolveLocale(req);
    // 商品类型：unlock（多宠解锁，默认）/ cosmetic（宠物装扮）/ premium（高级公民月卡）
    // / blindbox（盲盒抽奖）/ points（积分充值）/ checkin_makeup（断签补签）
    // Phase 6 新增：vip_yearly（年卡）/ breed_accel（结晶加速）/ chat_pack（聊天包）/ promo_24h（现金曝光）
    const kind: "unlock" | "cosmetic" | "premium" | "blindbox" | "points" | "checkin_makeup"
      | "vip_yearly" | "breed_accel" | "chat_pack" | "promo_24h" =
      body?.kind === "cosmetic" ? "cosmetic"
      : body?.kind === "premium" ? "premium"
      : body?.kind === "blindbox" ? "blindbox"
      : body?.kind === "points" ? "points"
      : body?.kind === "checkin_makeup" ? "checkin_makeup"
      : body?.kind === "vip_yearly" ? "vip_yearly"
      : body?.kind === "breed_accel" ? "breed_accel"
      : body?.kind === "chat_pack" ? "chat_pack"
      : body?.kind === "promo_24h" ? "promo_24h"
      : "unlock";
    const adoptionId =
      typeof body?.adoptionId === "string" ? body.adoptionId.trim() : "";
    const cosmeticId =
      typeof body?.cosmeticId === "string" ? body.cosmeticId.trim() : "";
    const poolId =
      typeof body?.poolId === "string" ? body.poolId.trim() : "";
    // Phase 6：breed_accel 目标藏品 / promo_24h 推广目标（均为 user_collectibles.id）
    const collectibleId =
      typeof body?.collectibleId === "string" ? body.collectibleId.trim() : "";
    const contentId =
      typeof body?.contentId === "string" ? body.contentId.trim() : "";

    // unlock / cosmetic 需要宠物；premium / points 无需；blindbox 需要奖池
    if (kind === "blindbox") {
      if (!poolId) {
        return NextResponse.json({ ok: false, error: apiError(locale, "invalidBlindboxPool") }, { status: 400 });
      }
    } else if (kind === "breed_accel") {
      if (!collectibleId) {
        return NextResponse.json({ ok: false, error: apiError(locale, "collectibleNotFound") }, { status: 400 });
      }
    } else if (kind === "promo_24h") {
      if (!contentId) {
        return NextResponse.json({ ok: false, error: apiError(locale, "promoteInvalidRequest") }, { status: 400 });
      }
    } else if (kind === "unlock" || kind === "cosmetic") {
      if (!adoptionId) {
        return NextResponse.json({ ok: false, error: apiError(locale, "missingAdoptionId") }, { status: 400 });
      }
    }
    if (kind === "cosmetic" && !cosmeticId) {
      return NextResponse.json({ ok: false, error: apiError(locale, "invalidCosmetic") }, { status: 400 });
    }

    // points 充值：档位必须命中服务端价格表（src/lib/points-recharge.ts）。
    // 价格/积分只信服务端常量，绝不读客户端金额 —— 防「1 分钱买 5000 积分」改价攻击。
    // 此校验在鉴权与 XorPay 下单之前，非法档位不会产生任何外部调用。
    const requestedPoints = typeof body?.points === "number" ? Math.floor(body.points) : NaN;
    const pointsPack = kind === "points" ? findPointsPack(requestedPoints) ?? null : null;
    if (kind === "points" && !pointsPack) {
      return NextResponse.json(
        { ok: false, code: "INVALID_POINTS_PACK", error: apiError(locale, "invalidPointsPack") },
        { status: 400 },
      );
    }

    // —— 鉴权：必须登录，且只能为自己的宠物发起支付 ——
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: apiError(locale, "signInFirst") }, { status: 401 });
    }

    // —— 环境变量防御性检查：缺少任何一项都直接返回 500，避免发起无效请求 ——
    const missing: string[] = [];
    if (!XORPAY_AID) missing.push("XORPAY_AID");
    if (!XORPAY_APP_SECRET) missing.push("XORPAY_SECRET");
    if (!resolveNotifyUrl()) missing.push("XORPAY_NOTIFY_URL");
    if (missing.length > 0) {
      console.error("[pay/create] missing payment config:", missing.join(", "));
      return NextResponse.json(
        { ok: false, error: `${apiError(locale, "missingPaymentConfig")}: ${missing.join(", ")}` },
        { status: 500 },
      );
    }

    // 首次访问自动建表（幂等）
    await ensureDbSchemaOnce();

    // 校验领养记录存在，且属于当前登录用户（premium 月卡 / blindbox 盲盒 / points 积分充值无需宠物）
    // —— 断签补签资格校验（鉴权后、XorPay 下单前）：无连签记录 / 连签未中断 → 400，不产生外部调用 ——
    let makeupDate = "";
    if (kind === "checkin_makeup") {
      const [mu] = await db
        .select({ lastCheckinDate: users.lastCheckinDate, checkinStreak: users.checkinStreak })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);
      if ((mu?.checkinStreak ?? 0) <= 0) {
        return NextResponse.json(
          { ok: false, code: "NO_STREAK_TO_MAKEUP", error: apiError(locale, "noStreakToMakeup") },
          { status: 400 },
        );
      }
      // 补签目标 = 昨天（服务端计算；YYYY-MM-DD 字典序即日期序）。last ≥ 昨天 → 连签未断，无需补签
      const yest = localDateStr(new Date(Date.now() - 24 * 60 * 60 * 1000));
      if (mu?.lastCheckinDate && mu.lastCheckinDate >= yest) {
        return NextResponse.json(
          { ok: false, code: "NOT_BROKEN", error: apiError(locale, "notBroken") },
          { status: 400 },
        );
      }
      makeupDate = yest;
    }

    // —— Phase 6：breed_accel 目标藏品校验（归属 + 必须在结晶冷却中，否则无需加速）——
    if (kind === "breed_accel") {
      const { rows: accelRows } = await pool.query(
        `SELECT owner_id, breed_cooldown_until AS "cd" FROM user_collectibles WHERE id = $1::uuid LIMIT 1`,
        [collectibleId],
      );
      if (accelRows.length === 0) {
        return NextResponse.json({ ok: false, error: apiError(locale, "collectibleNotFound") }, { status: 404 });
      }
      if (String(accelRows[0].owner_id) !== user.id) {
        return NextResponse.json({ ok: false, error: apiError(locale, "noPermissionPet") }, { status: 403 });
      }
      if (new Date(String(accelRows[0].cd)).getTime() <= Date.now()) {
        return NextResponse.json(
          { ok: false, code: "NOT_IN_COOLDOWN", error: apiError(locale, "accelNotNeeded") },
          { status: 400 },
        );
      }
    }

    // —— Phase 6：promo_24h 推广目标校验（归属 + active + 无生效中推广，防现金/积分双通道撞车）——
    if (kind === "promo_24h") {
      const { rows: promoRows } = await pool.query(
        `SELECT uc.owner_id, uc.status,
                EXISTS(
                  SELECT 1 FROM promoted_content pc
                   WHERE pc.content_type = $2 AND pc.content_id = uc.id AND pc.end_time > now()
                ) AS "promoting"
           FROM user_collectibles uc WHERE uc.id = $1::uuid LIMIT 1`,
        [contentId, PROMOTE_CONTENT_TYPE],
      );
      if (promoRows.length === 0) {
        return NextResponse.json({ ok: false, error: apiError(locale, "collectibleNotFound") }, { status: 404 });
      }
      if (String(promoRows[0].owner_id) !== user.id) {
        return NextResponse.json({ ok: false, error: apiError(locale, "noPermissionPet") }, { status: 403 });
      }
      if (String(promoRows[0].status) !== "active") {
        return NextResponse.json({ ok: false, error: apiError(locale, "collectibleInactive") }, { status: 400 });
      }
      if (promoRows[0].promoting === true) {
        return NextResponse.json(
          { ok: false, code: "ALREADY_PROMOTED", error: apiError(locale, "promoteAlreadyActive") },
          { status: 409 },
        );
      }
    }

    // 仅 unlock / cosmetic 需要领养记录归属校验（其余 kind 无宠物维度）
    if (kind === "unlock" || kind === "cosmetic") {
      const [a] = await db
        .select({ id: adoptions.id, userId: adoptions.userId })
        .from(adoptions)
        .where(eq(adoptions.id, adoptionId))
        .limit(1);
      if (!a) {
        return NextResponse.json({ ok: false, error: apiError(locale, "adoptionNotFound") }, { status: 404 });
      }
      if (a.userId !== user.id) {
        return NextResponse.json(
          { ok: false, error: apiError(locale, "noPermissionPet") },
          { status: 403 },
        );
      }
    }

    // 商品名称 / 价格 / 订单号（kind 分支）
    const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    let name: string;
    let price: string;
    let order_id: string;
    let amount: number | undefined;
    if (kind === "premium") {
      name = "AIABW 高级公民月卡（30 天）";
      price = PREMIUM_PRICE_CNY.toFixed(2);
      order_id = `premium-${user.id}-${nonce}`;
    } else if (kind === "cosmetic") {
      const [c] = await db
        .select()
        .from(cosmetics)
        .where(eq(cosmetics.id, cosmeticId))
        .limit(1);
      if (!c || !c.isVisible) {
        return NextResponse.json({ ok: false, error: apiError(locale, "cosmeticNotFound") }, { status: 404 });
      }
      name = locale === "en" ? c.nameEn : c.nameZh;
      price = Number(c.priceCny).toFixed(2);
      order_id = `cosmetic-${cosmeticId}-${adoptionId}-${nonce}`;
    } else if (kind === "blindbox") {
      const [bp] = await db
        .select()
        .from(blindboxPools)
        .where(and(eq(blindboxPools.id, poolId), eq(blindboxPools.isActive, true)))
        .limit(1);
      if (!bp) {
        return NextResponse.json({ ok: false, error: apiError(locale, "blindboxUnavailable") }, { status: 404 });
      }
      name = locale === "en" ? bp.nameEn : bp.nameZh;
      price = Number(bp.priceCny).toFixed(2);
      order_id = `blindbox-${poolId}-${user.id}-${nonce}`;
    } else if (kind === "points") {
      // 积分充值：pointsPack 已在上方校验非空（非法档位已 400），价格/积分全取服务端档位表
      const pack = pointsPack!;
      name = `AIABW 积分充值（${pack.points} 积分）`;
      price = pack.priceCny.toFixed(2);
      amount = pack.priceCny;
      order_id = `points-${pack.points}-${user.id}-${nonce}`;
    } else if (kind === "checkin_makeup") {
      // 断签补签：资格已在上方校验（断签且有连签记录可挽回），价格/补签日期全取服务端
      name = `AIABW 断签补签（${makeupDate}）`;
      price = CHECKIN_MAKEUP_PRICE_CNY.toFixed(2);
      amount = CHECKIN_MAKEUP_PRICE_CNY;
      order_id = makeupOrderId(user.id, makeupDate, nonce);
    } else if (kind === "vip_yearly") {
      // Phase 6 高级公民年卡：价格/天数取服务端常量；notify 按 premium-yearly- 前缀顺延 365 天
      name = `AIABW 高级公民年卡（${VIP_YEARLY_DAYS} 天）`;
      price = VIP_YEARLY_PRICE_CNY.toFixed(2);
      amount = VIP_YEARLY_PRICE_CNY;
      order_id = `premium-yearly-${user.id}-${nonce}`;
    } else if (kind === "breed_accel") {
      // Phase 6 结晶加速：归属/冷却已在上方校验；notify 清 breed_cooldown_until
      name = "AIABW 结晶加速（1 次）";
      price = BREED_ACCEL_PRICE_CNY.toFixed(2);
      amount = BREED_ACCEL_PRICE_CNY;
      order_id = `breedaccel-${collectibleId}-${user.id}-${nonce}`;
    } else if (kind === "chat_pack") {
      // Phase 6 聊天包：notify 当日已用额度回充 CHAT_PACK_MESSAGES 句（等价当日额度 +50）
      name = `AIABW 聊天包（${CHAT_PACK_MESSAGES} 句）`;
      price = CHAT_PACK_PRICE_CNY.toFixed(2);
      amount = CHAT_PACK_PRICE_CNY;
      order_id = `chatpack-${CHAT_PACK_MESSAGES}-${user.id}-${nonce}`;
    } else if (kind === "promo_24h") {
      // Phase 6 推荐曝光现金通道：归属/防重已在上方校验；notify 写 promoted_content 24h
      name = "AIABW 推荐曝光（24 小时）";
      price = PROMO_CASH_PRICE_CNY.toFixed(2);
      amount = PROMO_CASH_PRICE_CNY;
      order_id = `promo24-${contentId}-${user.id}-${nonce}`;
    } else {
      const rawAmount = body?.amount ?? DEFAULT_AMOUNT;
      amount = Number(rawAmount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ ok: false, error: apiError(locale, "invalidAmount") }, { status: 400 });
      }
      name = XORPAY_PRODUCT_NAME;
      price = amount.toFixed(2);
      order_id = `unlock-${adoptionId}-${nonce}`;
    }

    // 归一化支付方式：兼容旧版数字配置（Vercel 环境变量可能仍是 "2"）
    const pay_type = getXorpayPayType();
    // 回调地址：优先环境变量，占位符/缺失时回退到生产公网地址
    const notify_url = resolveNotifyUrl();

    const sign = buildXorpaySign({ name, pay_type, price, order_id, notify_url });

    console.log(
      "[pay/create] creating XorPay order",
      {
        url: `https://xorpay.com/api/pay/${XORPAY_AID}`,
        order_id,
        name,
        price,
        pay_type,
        notify_url,
      },
    );

    const { ok, data, error } = await createXorpayOrder({
      order_id,
      name,
      price,
      pay_type,
      notify_url,
      sign,
    });

    if (!ok) {
      console.error("[pay/create] XorPay order failed:", error);
      return NextResponse.json(
        { ok: false, error: error ?? apiError(locale, "orderCreateFailed") },
        { status: 502 },
      );
    }

    const d = (data ?? {}) as Record<string, unknown>;
    const info = (d.info ?? {}) as Record<string, unknown>;
    const qr = (d.qr ?? d.qrcode ?? d.url ?? d.pay_url ?? d.payurl ?? info.qr ?? info.url ?? info.payurl) as string | undefined;

    if (!qr) {
      console.error("[pay/create] XorPay returned no QR code:", JSON.stringify(d));
      return NextResponse.json({ ok: false, error: "XorPay returned no QR code" }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      orderId: order_id,
      qr,
      payUrl: (d.url ?? d.pay_url ?? info.url ?? null) as string | null,
      amount: amount ?? 0,
      payType: pay_type,
      kind,
    });
  } catch (err) {
    console.error("[pay/create] unhandled exception:", err);
    return NextResponse.json(
      { ok: false, error: apiError("zh", "payServiceUnavailable") },
      { status: 500 },
    );
  }
}
