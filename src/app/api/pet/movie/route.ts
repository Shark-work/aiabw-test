import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";

import { db, ensureDbSchemaOnce, pool } from "@/db/client";
import { adoptions } from "@/db/schema";
import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { getPet } from "@/lib/pet-config";
import { isSpeciesPetType, speciesIdOf } from "@/lib/species-prompt";
import { speciesAvatarFor } from "@/lib/species-avatars";
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from "@/lib/rate-limit";
import { characterView, resolveCharacter } from "@/lib/pets/characters";
import { isRiveAssetAvailable } from "@/lib/pets/rive-asset-server";
import { getSpeciesVisualById } from "@/lib/cms/loaders";
import {
  HUNGER_SETTLE_SQL,
  HUNGRY_THRESHOLD,
  LONG_ABSENCE_HOURS,
  MOVIE_INTERACTIONS,
  MOVIE_PET_TYPE,
  movieDefaultPetName,
  PLAY_ITEMS,
  PLAY_ITEM_SOURCE,
} from "@/lib/pet-play-config";

export const runtime = "nodejs";

interface MoviePetRow {
  id: string;
  petName: string;
  petType: string;
  happiness: number;
  hungerLevel: number;
  level: number;
  /** 上次互动时间（自动创建的新宠物 = now() → 久别 0h）。 */
  lastInteractedAt: Date | null;
}

/**
 * GET /api/pet/movie · 剧场页（/pet-movie）初始化聚合（单请求下发全部初始状态）。
 *  - 宠物解析：取用户最早一只 adoption 作为剧场主角；**没有则自动创建打工橘猫**
 *    （species:persian-cat，官方 PetType 无 cat——getPet 会 fallback 狐狸头像）；
 *  - 下发：宠物养成状态 + 积分余额 + 侧栏互动配置（kind/emoji/cost/delta 全部服务端给出，
 *    前端零经济参数——防抄袭需求四）；
 *  - 错误：401 未登录 / 429 限流 / 500 失败。
 */
export async function GET(req: Request) {
  const locale = resolveLocale(req);
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: apiError(locale, "sessionExpired") },
      { status: 401 },
    );
  }

  const rl = checkRateLimit(`pet-movie:${user.id}`, RATE_LIMITS.petPlay);
  if (rl.limited) return rateLimitResponse(req, rl.retryAfterSec);

  try {
    await ensureDbSchemaOnce();

    // 1) 解析剧场主角：用户最早一只 adoption（与 /pets/my 列表首只口径一致）
    let [pet] = await db
      .select({
        id: adoptions.id,
        petName: adoptions.petName,
        petType: adoptions.petType,
        happiness: adoptions.happiness,
        hungerLevel: adoptions.hungerLevel,
        level: adoptions.level,
        lastInteractedAt: adoptions.lastInteractedAt,
      })
      .from(adoptions)
      .where(eq(adoptions.userId, user.id))
      .orderBy(asc(adoptions.adoptedAt))
      .limit(1);

    // 2) 无任何宠物 → 自动创建打工橘猫（新用户进剧场开箱即用；并发双建各归各，无唯一约束冲突）
    if (!pet) {
      const created = await pool.query<MoviePetRow>(
        `INSERT INTO adoptions (user_id, pet_name, pet_type)
         VALUES ($1, $2, $3)
         RETURNING id, pet_name AS "petName", pet_type AS "petType", happiness, hunger_level AS "hungerLevel", level, last_interacted_at AS "lastInteractedAt"`,
        [user.id, movieDefaultPetName(locale), MOVIE_PET_TYPE],
      );
      pet = created.rows[0];
    }
    if (!pet) {
      return NextResponse.json(
        { ok: false, error: apiError(locale, "petPlayFailed") },
        { status: 500 },
      );
    }

    // 距上次互动小时数（必须在结算刷新 last_interacted_at 前捕获；久别重逢 returning 标记；新创建宠物 = 0）
    const absenceHours = pet.lastInteractedAt
      ? Math.max(0, (Date.now() - new Date(pet.lastInteractedAt).getTime()) / 3_600_000)
      : 0;

    // 3) 离线饥饿结算（需求四.4：回到页面按离线整小时衰减后下发）+ 积分余额 + 头像派生 + 背包
    const settled = await pool.query<{ hungerLevel: number }>(
      `UPDATE adoptions SET ${HUNGER_SETTLE_SQL}, last_interacted_at = now()
        WHERE id = $1 RETURNING hunger_level AS "hungerLevel"`,
      [pet.id],
    );
    const hungerLevel = Number(settled.rows[0]?.hungerLevel ?? pet.hungerLevel);

    const [balRes, bagRes] = await Promise.all([
      pool.query<{ points: number }>(`SELECT points FROM users WHERE id = $1`, [user.id]),
      pool.query<{ itemKey: string; qty: string }>(
        `SELECT item_key AS "itemKey", COUNT(*)::text AS qty
           FROM user_items WHERE user_id = $1 AND source = $2
          GROUP BY item_key`,
        [user.id, PLAY_ITEM_SOURCE],
      ),
    ]);
    const bagMap = new Map(bagRes.rows.map((r) => [r.itemKey, Number(r.qty)]));

    const avatar = isSpeciesPetType(pet.petType)
      ? (speciesAvatarFor(speciesIdOf(pet.petType)) ?? getPet(pet.petType).avatar)
      : getPet(pet.petType).avatar;
    // 物种视觉注册表（换皮层）：speciesId → Rive 资产/立绘/场景主题；
    // 按 rivePath 逐路径探测上架——某物种素材缺席只影响该物种（雪豹不再播橘猫素材）。
    const speciesId = isSpeciesPetType(pet.petType) ? speciesIdOf(pet.petType) : null;
    // 视觉配置走 CMS loader（60s 缓存；空表/未配置回退 resolveSpeciesVisual 注册表——
    // 后台改物种视觉「改表即改站」，2026-10-18 ui-wiring）
    const visual = await getSpeciesVisualById(speciesId ?? "");

    return NextResponse.json({
      ok: true,
      pet: {
        id: pet.id,
        name: pet.petName,
        petType: pet.petType,
        speciesId,
        avatar,
        happiness: pet.happiness,
        hungerLevel,
        level: pet.level,
      },
      // 角色展示层（需求一：greeting/displayName 由角色注册表下发，前端零硬编码）
      character: characterView(resolveCharacter(pet.petType), locale),
      // Rive 上架探测（按物种 rivePath 逐路径）：未上架 → 前端零请求直降静态立绘；上架自动切 Rive
      riveAvailable: visual.rivePath ? isRiveAssetAvailable(visual.rivePath) : false,
      hungry: hungerLevel <= HUNGRY_THRESHOLD,
      // 久别重逢（距上次互动 ≥ LONG_ABSENCE_HOURS）：前端进场 sleepy 态 + wake 唤醒
      returning: absenceHours >= LONG_ABSENCE_HOURS,
      points: Number(balRes.rows[0]?.points ?? 0),
      // 背包商品目录（需求四：剧场侧栏改背包模式，与 play 页同目录/同事务路由）
      items: PLAY_ITEMS.map((i) => ({
        key: i.key,
        name: locale === "en" ? i.nameEn : i.nameZh,
        emoji: i.emoji,
        price: i.price,
        hungerDelta: i.hungerDelta,
        happinessDelta: i.happinessDelta,
        effect: i.effect,
        desc: locale === "en" ? i.descEn : i.descZh,
        owned: bagMap.get(i.key) ?? 0,
      })),
      // legacy 直购互动（老客户端兼容；新客户端走 items + /api/pet/play/buy|use）
      interactions: MOVIE_INTERACTIONS.map((i) => ({
        kind: i.kind,
        emoji: i.emoji,
        cost: i.cost,
        hungerDelta: i.hungerDelta,
        happinessDelta: i.happinessDelta,
      })),
    });
  } catch (err) {
    console.error("[pet/movie] failed:", err);
    return NextResponse.json(
      { ok: false, error: apiError(locale, "petPlayFailed") },
      { status: 500 },
    );
  }
}
