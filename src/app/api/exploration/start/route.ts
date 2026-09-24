import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db, ensureDbSchemaOnce, pool } from "@/db/client";
import { animalWiki, explorationEventsV2, users } from "@/db/schema";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { getUserFromRequest } from "@/lib/auth";
import { todayString } from "@/lib/chat-quota-config";
import {
  generateDistance,
  generateSteps,
  getMaxExplorations,
  pickWeightedEvent,
  serializeResultData,
  toEventResult,
  toKnowledgeSnapshot,
  type ExplorationStartResponse,
  type ExplorationEventRow,
  type EventType,
  type Rarity,
} from "@/lib/exploration-engine";
import { getActiveSubscription } from "@/lib/subscription-config";
import { isPremium } from "@/lib/premium";
import { syncAchievements } from "@/lib/achievements-service";
import type { NewlyUnlockedBadge } from "@/lib/achievements-config";

export const runtime = "nodejs";

/**
 * POST /api/exploration/start
 * 触发一次探索：
 *   1) 校验登录（未登录 → 401）
 *   2) 取 isVip（active subscription || premium_until > now）
 *   3) 取 maxCount；查今日次数
 *   4) 超限 → 429 EXPLORATION_LIMIT
 *   5) 抽取事件（按权重），生成本次步数 / 距离
 *   6) 知识类事件关联查询 animal_wiki[knowledge_link]
 *   7) 写入 exploration_records；返回 { event, steps, distance, knowledge?, todayCount, maxCount, isVip }
 */
export async function POST(req: Request) {
  const locale = resolveLocale(req);
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      {
        ok: false,
        code: "SIGN_IN_REQUIRED",
        error: apiError(locale, "signInFirst"),
        todayCount: 0,
        maxCount: 1,
        isVip: false,
      },
      { status: 401 },
    );
  }

  try {
    await ensureDbSchemaOnce();

    // 1) VIP 状态：active 订阅或 premium_until > now
    const [userRow] = await db
      .select({
        premiumUntil: users.premiumUntil,
        isUnlocked: users.isUnlocked,
      })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    const activeSub = await getActiveSubscription(user.id);
    const isVip =
      !!activeSub ||
      isPremium(userRow?.premiumUntil ?? null) ||
      (userRow?.isUnlocked ?? false);
    const maxCount = getMaxExplorations(isVip);

    // 2) 今日探索次数（按今天 0 点起的记录数）
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
    if (todayCount >= maxCount) {
      return NextResponse.json(
        {
          ok: false,
          code: "EXPLORATION_LIMIT",
          error: apiError(locale, "explorationLimit", { max: maxCount }),
          todayCount,
          maxCount,
          isVip,
        },
        { status: 429 },
      );
    }

    // 3) 抽取事件
    const eventRows = await db
      .select()
      .from(explorationEventsV2);
    if (eventRows.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          code: "SERVER_ERROR",
          error: apiError(locale, "explorationEmpty"),
          todayCount,
          maxCount,
          isVip,
        },
        { status: 500 },
      );
    }
    const poolRows: ExplorationEventRow[] = eventRows.map((r) => ({
      id: r.id,
      petCategory: r.petCategory,
      eventType: r.eventType as EventType,
      title: r.title,
      description: r.description,
      imageEmoji: r.imageEmoji ?? null,
      rarity: r.rarity as Rarity,
      weight: r.weight,
      requiredEquipment: r.requiredEquipment ?? null,
      knowledgeLink: r.knowledgeLink ?? null,
    }));
    const picked = pickWeightedEvent(poolRows, { isVip });
    const steps = generateSteps(isVip);
    const distance = generateDistance(isVip);

    // 4) 知识类：查 animal_wiki
    let knowledge: ReturnType<typeof toKnowledgeSnapshot> = null;
    if (picked.eventType === "knowledge" && picked.knowledgeLink) {
      const [wRow] = await db
        .select()
        .from(animalWiki)
        .where(eq(animalWiki.id, picked.knowledgeLink))
        .limit(1);
      knowledge = toKnowledgeSnapshot(wRow as unknown as Record<string, unknown>);
    }

    // 5) 写记录
    const recordId = `rec-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    const now = new Date();
    const resultData = serializeResultData({
      title: picked.title,
      description: picked.description,
      emoji: picked.imageEmoji,
      rarity: picked.rarity,
      knowledgeId: picked.knowledgeLink ?? null,
    });
    const isRare = picked.rarity !== "common";
    await pool.query(
      `INSERT INTO exploration_records
         (id, user_id, pet_id, event_id, result_type, result_data,
          steps_gained, distance_gained, is_rare, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        recordId,
        user.id,
        null,
        picked.id,
        picked.eventType,
        resultData,
        steps,
        distance,
        isRare,
        now,
      ],
    );

    // 6) 成就评估（roadmap 任务二：探索完成节点；失败不阻断探索主流程）
    let newlyUnlocked: NewlyUnlockedBadge[] = [];
    try {
      newlyUnlocked = (await syncAchievements(user.id)).newlyUnlocked;
    } catch (achvErr) {
      console.error("[/api/exploration/start] achievements sync failed:", achvErr);
    }

    // 7) 返回
    const eventResult = toEventResult(picked);
    eventResult.knowledge = knowledge;
    const body: ExplorationStartResponse = {
      ok: true,
      event: eventResult,
      steps,
      distance,
      todayCount: todayCount + 1,
      maxCount,
      isVip,
      newlyUnlocked,
    };
    return NextResponse.json(body);
  } catch (err) {
    console.error("[/api/exploration/start] failed:", err);
    return NextResponse.json(
      {
        ok: false,
        code: "SERVER_ERROR",
        error: apiError(locale, "explorationStartFailed"),
        todayCount: 0,
        maxCount: 1,
        isVip: false,
      },
      { status: 500 },
    );
  }
}
