import { setRequestLocale, getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import { and, desc, eq, gte } from "drizzle-orm";

import { db, pool } from "@/db/client";
import { explorationRecords, users } from "@/db/schema";
import { verifyToken } from "@/lib/auth";
import { isPremium } from "@/lib/premium";
import { getActiveSubscription } from "@/lib/subscription-config";
import { todayString } from "@/lib/chat-quota-config";
import { getMaxExplorations, deserializeResultData } from "@/lib/exploration-engine";
import { ExploreV2Panel } from "@/components/exploration-v2/explore-v2-panel";
import type { TimelineRecord } from "@/components/exploration-v2/pet-timeline";

/**
 * /[locale]/explore-v2
 * 探索 v2 主页：登录用户可访问；SSR 加载首屏
 *   - 今日已探索次数（按今天 0 点起的记录数）
 *   - VIP 状态 → maxCount
 *   - 最近 50 条记录（按时间倒序）
 */
export default async function ExploreV2Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("explorationV2");

  const cookieStore = await cookies();
  const tokenCookie =
    cookieStore.get("aiabw_token")?.value ??
    cookieStore.get("auth_token")?.value;
  const user = tokenCookie ? await verifyToken(tokenCookie) : null;
  if (!user) {
    return (
      <main className="mx-auto max-w-md p-6 text-center text-sm text-zinc-500">
        {t("signInFirst")}
      </main>
    );
  }

  const [userRow] = await db
    .select({ premiumUntil: users.premiumUntil, isUnlocked: users.isUnlocked })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  const sub = await getActiveSubscription(user.id);
  const isVip =
    !!sub || isPremium(userRow?.premiumUntil ?? null) || (userRow?.isUnlocked ?? false);
  const maxCount = getMaxExplorations(isVip);

  const today = todayString();
  const todayRes = (await pool.query(
    `SELECT count(*)::int AS count
       FROM exploration_records
      WHERE user_id = $1
        AND created_at >= (now() - interval '24 hours')
        AND to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') = $2`,
    [user.id, today],
  )) as { rows: Array<{ count: number }> };
  const todayCount = todayRes.rows[0]?.count ?? 0;

  const records = await db
    .select({
      id: explorationRecords.id,
      resultType: explorationRecords.resultType,
      resultData: explorationRecords.resultData,
      stepsGained: explorationRecords.stepsGained,
      distanceGained: explorationRecords.distanceGained,
      isRare: explorationRecords.isRare,
      createdAt: explorationRecords.createdAt,
    })
    .from(explorationRecords)
    .where(
      and(
        eq(explorationRecords.userId, user.id),
        gte(explorationRecords.createdAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
      ),
    )
    .orderBy(desc(explorationRecords.createdAt))
    .limit(50);

  const initialRecords: TimelineRecord[] = records.map((r) => {
    const meta = deserializeResultData(r.resultData);
    return {
      id: r.id,
      resultType: r.resultType,
      title: meta.title,
      description: meta.description,
      emoji: meta.emoji,
      rarity: meta.rarity,
      isRare: r.isRare,
      stepsGained: r.stepsGained,
      distanceGained: Number(r.distanceGained),
      knowledgeId: meta.knowledgeId,
      createdAt: r.createdAt.toISOString(),
    };
  });

  return (
    <main className="mx-auto max-w-md px-4 py-6">
      <ExploreV2Panel
        initialTodayCount={todayCount}
        initialMaxCount={maxCount}
        initialIsVip={isVip}
        initialRecords={initialRecords}
      />
    </main>
  );
}
