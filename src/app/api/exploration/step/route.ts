import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";

import { db, ensureDbSchemaOnce } from "@/db/client";
import { adoptions, userItems, userPostcards } from "@/db/schema";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import {
  EXPLORATION_MAPS,
  STEPS_PER_MESSAGE,
  advanceStep,
  applyEquipmentToSteps,
  fillItemPlaceholder,
  pickEventForMap,
  type Weather,
  type MapEventSeed,
} from "@/lib/exploration-config";
import {
  canPassObstacle,
  canResistWeather,
  rareEventMultiplier,
} from "@/lib/shop-config";

export const runtime = "nodejs";

const POSTCARD_AI_SUMMARIES: Record<number, { zh: string; en: string; emoji: string }> = {
  1: { zh: "在村庄里收到了老婆婆的祝福羽毛~", en: "Granny blessed you with a lucky feather in the village~", emoji: "🏘️" },
  2: { zh: "草地上的蝴蝶和宝贝见证了你的足迹~", en: "Butterflies and grass treasures marked your trail~", emoji: "🌾" },
  3: { zh: "森林里的小猫向你眨了眨眼~", en: "A forest kitten winked at you~", emoji: "🌲" },
  4: { zh: "你找到了过河的办法，勇气可嘉~", en: "You found a way across the river - brave soul~", emoji: "🌊" },
  5: { zh: "沙漠之舟陪你走过了沙丘~", en: "A desert companion walked the dunes with you~", emoji: "🏜️" },
  6: { zh: "雪山之巅的极光映在你眼中~", en: "Aurora crowned you on the snowy peak~", emoji: "🏔️" },
  7: { zh: "星空之下，你完成了全部旅程~", en: "Under the stars, you completed the whole journey~", emoji: "🌌" },
};

function normalizeWeather(value: unknown): Weather {
  if (value === "rainy" || value === "snowy" || value === "cloudy") return value;
  return "sunny";
}

/** 用 MapEventSeed 渲染出可发给前端的 EventView。 */
function renderEvent(
  seed: MapEventSeed,
  locale: "zh" | "en",
): { type: string; title: string; description: string; rewardItemKey: string | null } {
  const title = locale === "en" ? seed.titleEn : seed.titleZh;
  const template = locale === "en" ? seed.descriptionEn : seed.descriptionZh;
  const description = fillItemPlaceholder(template, seed.rewardItemKey ?? null, locale);
  return {
    type: seed.eventType,
    title,
    description,
    rewardItemKey: seed.rewardItemKey ?? null,
  };
}

/**
 * POST /api/exploration/step
 * 请求体：{ adoptionId: string }
 *
 * 推进逻辑（聊天驱动）：
 *  1) 读取当前 exploration_steps / current_map_id / map_progress / weather；
 *  2) 每条消息推进 STEPS_PER_MESSAGE（默认 10）步；
 *  3) 步数更新在 map 内部累积；到达 100 时完成一段地图，触发明信片 + 进入下一段；
 *  4) 每累计 20 步检查一次是否触发事件（item / weather / npc / obstacle）；
 *  5) 返回新状态 + 可能的事件 / 明信片。
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { adoptionId?: string };
  const adoptionId = typeof body.adoptionId === "string" ? body.adoptionId : "";

  if (!adoptionId) {
    return NextResponse.json(
      { ok: false, error: apiError(resolveLocale(req), "missingAdoptionId") },
      { status: 400 },
    );
  }

  const locale = resolveLocale(req);

  try {
    await ensureDbSchemaOnce();

    const [row] = await db
      .select({
        id: adoptions.id,
        userId: adoptions.userId,
        explorationSteps: adoptions.explorationSteps,
        currentMapId: adoptions.currentMapId,
        mapProgress: adoptions.mapProgress,
        weather: adoptions.weather,
      })
      .from(adoptions)
      .where(eq(adoptions.id, adoptionId))
      .limit(1);

    if (!row) {
      return NextResponse.json(
        { ok: false, error: apiError(resolveLocale(req), "adoptionNotFound") },
        { status: 404 },
      );
    }

    let curMapId = row.currentMapId ?? 1;
    let curProgress = row.mapProgress ?? 0;
    let curSteps = row.explorationSteps ?? 0;
    let curWeather = normalizeWeather(row.weather);

    // 商城装备：加载当前用户已装备（source='shop'）的 itemKey 集合
    //  - 仅登录用户生效（匿名领养的 userId='anonymous' 跳过）
    //  - 商城永久装备视作'账号级'装备（不依赖 equipped_adoption_id，与签到盲盒不同）
    let equippedItemKeys: string[] = [];
    if (row.userId && row.userId !== "anonymous") {
      try {
        const owned = await db
          .select({ itemKey: userItems.itemKey })
          .from(userItems)
          .where(
            and(
              eq(userItems.userId, row.userId),
              eq(userItems.source, "shop"),
            ),
          );
        // 去重（同一件永久装备可能有多条 user_items 记录）
        equippedItemKeys = Array.from(new Set(owned.map((o) => o.itemKey)));
      } catch (e) {
        console.warn("[/api/exploration/step] load equipped items failed:", e);
        equippedItemKeys = [];
      }
    }

    // 装备 → 步数倍率（compass 等）
    const actualStepsPerMessage = applyEquipmentToSteps(STEPS_PER_MESSAGE, equippedItemKeys);
    const rareMult = rareEventMultiplier(equippedItemKeys);

    const completedMapIds: number[] = [];
    const events: ReturnType<typeof renderEvent>[] = [];
    let rewardItem: { key: string; emoji: string; name: string; rarity: string } | null = null;

    for (let i = 0; i < actualStepsPerMessage; i++) {
      const next = advanceStep({ currentMapId: curMapId, mapProgress: curProgress });
      curMapId = next.currentMapId;
      curProgress = next.mapProgress;
      curSteps += 1;

      if (typeof next.completedMapId === "number") {
        completedMapIds.push(next.completedMapId);
        const nextMapInfo = EXPLORATION_MAPS.find((m) => m.id === curMapId);
        if (nextMapInfo) curWeather = nextMapInfo.defaultWeather;
      }

      // 事件检查：每累计 20 步做一次概率判定（MVP 简化版）
      // 装备倍率：rare_event（如 lantern）让事件触发概率 ×rareMult
      if (curSteps > 0 && curSteps % 20 === 0) {
        const randomVal = Math.random();
        // 把 rareMult 折算成新的 randomVal：mult > 1 → 降低 randomVal（更易触发）
        const biasedRandom = rareMult > 1 ? randomVal / rareMult : randomVal;
        const event = pickEventForMap(curMapId, biasedRandom, curWeather);
        if (event) {
          // 装备效果：obstacle_pass / weather_resist → 标记 passedByEquipment / negatedByEquipment，弹窗展示提示
          const passed = event.eventType === "obstacle" && canPassObstacle(equippedItemKeys);
          const negated = event.eventType === "weather" && canResistWeather(equippedItemKeys);
          const view = renderEvent(event, locale);
          if (passed || negated) {
            const tag = passed ? " [装备自动通过]" : " [装备免疫]";
            events.push({ ...view, description: view.description + tag });
          } else {
            events.push(view);
          }

          if (event.eventType === "item" && event.rewardItemKey) {
            if (row.userId && row.userId !== "anonymous") {
              try {
                const rarity =
                  event.rewardItemKey === "feather" ? "epic" :
                  event.rewardItemKey === "compass" || event.rewardItemKey === "bridge" ? "rare" :
                  "common";
                await db.insert(userItems).values({
                  userId: row.userId,
                  itemKey: event.rewardItemKey,
                  rarity,
                  source: "exploration",
                });
                rewardItem = { key: event.rewardItemKey, emoji: "🎁", name: event.rewardItemKey, rarity };
              } catch (e) {
                console.warn("[/api/exploration/step] user_items insert failed:", e);
              }
            }
          }

          if (event.eventType === "weather" && event.weatherBias) {
            curWeather = event.weatherBias;
          }
        }
      }
    }

    await db
      .update(adoptions)
      .set({
        explorationSteps: curSteps,
        currentMapId: curMapId,
        mapProgress: curProgress,
        weather: curWeather,
      })
      .where(eq(adoptions.id, adoptionId));

    // 跨地图 → 写明信片
    const postcards: { mapId: number; mapNameZh: string; mapNameEn: string; aiSummaryZh: string; aiSummaryEn: string; emoji: string }[] = [];
    for (const mapId of completedMapIds) {
      const summary = POSTCARD_AI_SUMMARIES[mapId] ?? {
        zh: "一段新的旅程结束啦~",
        en: "Another journey complete~",
        emoji: "✨",
      };
      const card = {
        mapId,
        mapNameZh: `地图 ${mapId}`,
        mapNameEn: `Map ${mapId}`,
        aiSummaryZh: summary.zh,
        aiSummaryEn: summary.en,
        emoji: summary.emoji,
      };
      postcards.push(card);
      if (row.userId && row.userId !== "anonymous") {
        try {
          await db.insert(userPostcards).values({
            userId: row.userId,
            adoptionId: row.id,
            mapId: card.mapId,
            mapNameZh: card.mapNameZh,
            mapNameEn: card.mapNameEn,
            aiSummaryZh: card.aiSummaryZh,
            aiSummaryEn: card.aiSummaryEn,
            illustrationEmoji: card.emoji,
          });
        } catch (e) {
          console.warn("[/api/exploration/step] user_postcards insert failed:", e);
        }
      }
    }

    return NextResponse.json({
      ok: true,
      adoptionId: row.id,
      explorationSteps: curSteps,
      currentMapId: curMapId,
      mapProgress: curProgress,
      weather: curWeather,
      events,
      rewardItem,
      completedMaps: completedMapIds,
      postcards,
    });
  } catch (err) {
    console.error("[/api/exploration/step] failed:", err);
    return NextResponse.json(
      { ok: false, error: apiError(resolveLocale(req), "interactFailed") },
      { status: 500 },
    );
  }
}
