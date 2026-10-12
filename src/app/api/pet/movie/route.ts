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
import {
  MOVIE_INTERACTIONS,
  MOVIE_PET_TYPE,
  movieDefaultPetName,
} from "@/lib/pet-play-config";

export const runtime = "nodejs";

interface MoviePetRow {
  id: string;
  petName: string;
  petType: string;
  happiness: number;
  hungerLevel: number;
  level: number;
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
         RETURNING id, pet_name AS "petName", pet_type AS "petType", happiness, hunger_level AS "hungerLevel", level`,
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

    // 3) 积分余额 + 头像派生（与 /api/pet/play 同口径）
    const balRes = await pool.query<{ points: number }>(
      `SELECT points FROM users WHERE id = $1`,
      [user.id],
    );
    const avatar = isSpeciesPetType(pet.petType)
      ? (speciesAvatarFor(speciesIdOf(pet.petType)) ?? getPet(pet.petType).avatar)
      : getPet(pet.petType).avatar;

    return NextResponse.json({
      ok: true,
      pet: {
        id: pet.id,
        name: pet.petName,
        petType: pet.petType,
        avatar,
        happiness: pet.happiness,
        hungerLevel: pet.hungerLevel,
        level: pet.level,
      },
      points: Number(balRes.rows[0]?.points ?? 0),
      // 侧栏互动配置（价格/数值全部由服务端下发；名称走前端 i18n petMovie.feed/toy）
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
