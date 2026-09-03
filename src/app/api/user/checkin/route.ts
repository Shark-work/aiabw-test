import { NextResponse } from "next/server";
import { and, eq, isNull, not, or, sql } from "drizzle-orm";

import { db, ensureDbSchemaOnce } from "@/db/client";
import { users, pointsLog, userItems } from "@/db/schema";
import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { isPremium } from "@/lib/premium";
import { moodKeyFor, rollCheckinItem } from "@/lib/checkin-items";

export const runtime = "nodejs";

/** 每日签到积分（月卡用户 ×2） */
const CHECKIN_POINTS = 10;
/** 连签 7 天额外奖励积分（成就，月卡用户 ×2） */
const CHECKIN_BONUS_POINTS = 100;
/** 连签成就周期：每满 7 天 额外积分 + 心情盲盒道具 */
const STREAK_BONUS_PERIOD = 7;
/** 月卡签到积分倍率（高级公民：签到奖励翻倍） */
const PREMIUM_POINTS_MULTIPLIER = 2;

/** 日期字符串（本地时区，YYYY-MM-DD） */
function dateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * GET /api/user/checkin
 * 签到状态（每日弹窗判定用）：
 *  - checkedToday：今天是否已签到；
 *  - streak：当前连签天数；
 *  - nextStreak：若现在签到将达成的天数（昨天签过 → +1，否则重置为 1）；
 *  - premium：是否月卡用户（前端展示双倍/保底提示）。
 */
export async function GET(req: Request) {
  const locale = resolveLocale(req);
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: apiError(locale, "signInFirst") }, { status: 401 });
    }

    await ensureDbSchemaOnce();
    const [me] = await db
      .select({
        points: users.points,
        lastCheckinDate: users.lastCheckinDate,
        checkinStreak: users.checkinStreak,
        premiumUntil: users.premiumUntil,
      })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    const t = dateStr(new Date());
    const yest = dateStr(new Date(Date.now() - 24 * 60 * 60 * 1000));
    const checkedToday = me?.lastCheckinDate === t;
    const streak = me?.checkinStreak ?? 0;
    const nextStreak = checkedToday ? streak : me?.lastCheckinDate === yest ? streak + 1 : 1;

    return NextResponse.json({
      ok: true,
      checkedToday,
      streak,
      nextStreak,
      premium: isPremium(me?.premiumUntil),
      points: me?.points ?? 0,
      checkinDate: me?.lastCheckinDate ?? null,
    });
  } catch (err) {
    console.error("[user/checkin] status failed:", err);
    return NextResponse.json({ ok: false, error: apiError(locale, "checkinFailed") }, { status: 500 });
  }
}

/**
 * POST /api/user/checkin
 * 每日签到（P0-1 升级：心情盲盒 + 月卡特权）：
 *  - +10 积分（一天一次，原子条件更新防并发重复签到）；月卡用户积分 ×2；
 *  - 连签逻辑：昨天签到过 → streak+1，否则重置为 1；
 *  - 连签每满 7 天 → 额外 +100 积分（月卡 ×2）+ 随机心情盲盒道具
 *    （普通 70% / 稀有 25% / 传说 5%；月卡保底稀有）写入 user_items 背包；
 *  - mood：连签天数对应的心情档位（1 天/3 天/≥7 天），前端据此展示宠物表情与台词。
 * TODO(P0-2)：断签花 ¥1 补签 —— 接入 XorPay（/api/pay/create kind=checkin_makeup），
 *  支付回调后回填 last_checkin_date 并修正 streak；当前版本占位未实现。
 */
export async function POST(req: Request) {
  const locale = resolveLocale(req);
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: apiError(locale, "signInFirst") }, { status: 401 });
    }

    await ensureDbSchemaOnce();
    const t = dateStr(new Date());
    const yest = dateStr(new Date(Date.now() - 24 * 60 * 60 * 1000));

    const [me] = await db
      .select({
        points: users.points,
        lastCheckinDate: users.lastCheckinDate,
        checkinStreak: users.checkinStreak,
        premiumUntil: users.premiumUntil,
      })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    const premium = isPremium(me?.premiumUntil);

    const already = me?.lastCheckinDate === t;
    if (already) {
      return NextResponse.json({
        ok: true,
        already: true,
        points: me.points ?? 0,
        streak: me.checkinStreak ?? 0,
        premium,
        mood: moodKeyFor(me.checkinStreak ?? 0),
        item: null,
        checkinDate: t,
      });
    }

    // 连签判定：昨天签到过 → +1，否则重置为 1
    const isConsecutive = me?.lastCheckinDate === yest;
    const newStreak = isConsecutive ? (me?.checkinStreak ?? 0) + 1 : 1;
    const bonus = newStreak % STREAK_BONUS_PERIOD === 0;
    const multiplier = premium ? PREMIUM_POINTS_MULTIPLIER : 1;
    const gain = CHECKIN_POINTS * multiplier;
    const bonusGain = bonus ? CHECKIN_BONUS_POINTS * multiplier : 0;
    const totalGain = gain + bonusGain;

    // 心情盲盒：连签每满 7 天随机一件道具；月卡保底稀有（普通强制升级为稀有）
    const item = bonus ? rollCheckinItem(Math.random(), premium) : null;

    // 原子更新（数据库级防重复签到）：仅当 lastCheckinDate 不是今天才 +积分
    const res = await db.transaction(async (tx) => {
      const upd = await tx
        .update(users)
        .set({
          points: sql`${users.points} + ${totalGain}`,
          lastCheckinDate: t,
          checkinStreak: newStreak,
        })
        .where(
          and(
            eq(users.id, user.id),
            or(isNull(users.lastCheckinDate), not(eq(users.lastCheckinDate, t))),
          ),
        );
      if (upd.rowCount === 0) return null;
      await tx.insert(pointsLog).values({ userId: user.id, amount: gain, reason: "checkin" });
      if (bonusGain > 0) {
        await tx.insert(pointsLog).values({ userId: user.id, amount: bonusGain, reason: "checkin_bonus" });
      }
      if (item) {
        await tx.insert(userItems).values({
          userId: user.id,
          itemKey: item.key,
          rarity: item.rarity,
          source: "checkin_blindbox",
        });
      }
      return true;
    });

    if (res === null) {
      // 并发下已被其它请求签到
      const [again] = await db
        .select({ points: users.points, checkinStreak: users.checkinStreak })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);
      return NextResponse.json({
        ok: true,
        already: true,
        points: again?.points ?? 0,
        streak: again?.checkinStreak ?? 0,
        premium,
        mood: moodKeyFor(again?.checkinStreak ?? 0),
        item: null,
        checkinDate: t,
      });
    }

    return NextResponse.json({
      ok: true,
      already: false,
      points: (me?.points ?? 0) + totalGain,
      pointsGain: gain,
      streak: newStreak,
      bonus,
      bonusPoints: bonusGain,
      premium,
      mood: moodKeyFor(newStreak),
      item,
      achieved: bonus ? `checkin_${newStreak}` : null,
      checkinDate: t,
    });
  } catch (err) {
    console.error("[user/checkin] failed:", err);
    return NextResponse.json({ ok: false, error: apiError(locale, "checkinFailed") }, { status: 500 });
  }
}

