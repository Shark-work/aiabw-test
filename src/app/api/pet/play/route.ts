import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

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
import { resolveSpeciesVisual } from "@/lib/pets/species-visuals";
import {
  HUNGER_SETTLE_SQL,
  HUNGRY_THRESHOLD,
  PLAY_ITEMS,
  PLAY_ITEM_SOURCE,
} from "@/lib/pet-play-config";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/pet/play?adoptionId=<uuid> · 互动页初始化聚合（单请求下发全部初始状态）。
 *  - 宠物养成状态（名字/心情/饥饿度/等级/头像派生）+ 积分余额 + 互动背包 + 商品目录；
 *  - 前端零状态推导：渲染所需全部数据由本接口给出（防抄袭需求 2.1）。
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

  const adoptionId = new URL(req.url).searchParams.get("adoptionId") ?? "";
  if (!UUID_RE.test(adoptionId)) {
    return NextResponse.json(
      { ok: false, error: apiError(locale, "adoptionIdRequired") },
      { status: 400 },
    );
  }

  try {
    await ensureDbSchemaOnce();

    const [pet] = await db
      .select({
        id: adoptions.id,
        userId: adoptions.userId,
        petName: adoptions.petName,
        petType: adoptions.petType,
        happiness: adoptions.happiness,
        hungerLevel: adoptions.hungerLevel,
        level: adoptions.level,
      })
      .from(adoptions)
      .where(eq(adoptions.id, adoptionId))
      .limit(1);
    if (!pet) {
      return NextResponse.json(
        { ok: false, error: apiError(locale, "adoptionNotFound") },
        { status: 404 },
      );
    }
    if (pet.userId !== user.id) {
      return NextResponse.json(
        { ok: false, error: apiError(locale, "petPlayForbidden") },
        { status: 403 },
      );
    }

    // 离线饥饿结算（需求四.4：回到页面时按离线整小时衰减，重新结算后下发）
    const settled = await pool.query<{ hungerLevel: number }>(
      `UPDATE adoptions SET ${HUNGER_SETTLE_SQL}, last_interacted_at = now()
        WHERE id = $1 RETURNING hunger_level AS "hungerLevel"`,
      [adoptionId],
    );
    const hungerLevel = Number(settled.rows[0]?.hungerLevel ?? pet.hungerLevel);

    // 积分余额 + 互动背包（source='pet_play' 聚合数量）并行查询
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
    const visual = resolveSpeciesVisual(speciesId);

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
      points: Number(balRes.rows[0]?.points ?? 0),
      items: PLAY_ITEMS.map((i) => ({
        key: i.key,
        name: locale === "en" ? i.nameEn : i.nameZh,
        emoji: i.emoji,
        price: i.price,
        hungerDelta: i.hungerDelta,
        happinessDelta: i.happinessDelta,
        desc: locale === "en" ? i.descEn : i.descZh,
        owned: bagMap.get(i.key) ?? 0,
      })),
    });
  } catch (err) {
    console.error("[pet/play] failed:", err);
    return NextResponse.json(
      { ok: false, error: apiError(locale, "petPlayFailed") },
      { status: 500 },
    );
  }
}
