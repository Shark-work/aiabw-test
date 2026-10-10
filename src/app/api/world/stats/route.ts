import { NextResponse } from "next/server";

import { pool } from "@/db/client";

export const runtime = "nodejs";

/**
 * GET /api/world/stats — 灵魂树彩蛋 · 大陆统计（2026-10-16）
 *
 * 公开只读（无需登录），单 SQL 聚合 4 指标：
 *  - speciesTotal：图鉴已收录物种数（pet_dictionary，凡兽百科）；
 *  - soulPetSpeciesTotal：灵宠物种数（aibi_species，12 种灵魂共鸣兽）；
 *  - regionsTotal：大陆区域数（world_regions，8）；
 *  - resonancesTotal：总共鸣次数（adoptions，每次唤醒/领养即一次灵魂共鸣）。
 * 缓存：模块级内存 TTL 60s（与 /api/home/stats 同模式）。
 * 降级：DB 异常返回 { ok: true, stats: null }，彩蛋静默降级只展示创世短文案。
 */
export type WorldStats = {
  speciesTotal: number;
  soulPetSpeciesTotal: number;
  regionsTotal: number;
  resonancesTotal: number;
};

const CACHE_TTL_MS = 60_000;
let cache: { stats: WorldStats; expiresAt: number } | null = null;

export async function GET() {
  const now = Date.now();
  if (cache && now < cache.expiresAt) {
    return NextResponse.json({ ok: true, stats: cache.stats });
  }

  try {
    const { rows } = await pool.query<{
      species_total: number;
      soul_pet_species_total: number;
      regions_total: number;
      resonances_total: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM pet_dictionary) AS species_total,
         (SELECT count(*)::int FROM aibi_species) AS soul_pet_species_total,
         (SELECT count(*)::int FROM world_regions) AS regions_total,
         (SELECT count(*)::int FROM adoptions) AS resonances_total`,
    );
    const r = rows[0];
    const stats: WorldStats = {
      speciesTotal: r?.species_total ?? 0,
      soulPetSpeciesTotal: r?.soul_pet_species_total ?? 0,
      regionsTotal: r?.regions_total ?? 0,
      resonancesTotal: r?.resonances_total ?? 0,
    };
    cache = { stats, expiresAt: now + CACHE_TTL_MS };
    return NextResponse.json({ ok: true, stats });
  } catch (err) {
    console.error("[api/world/stats] failed:", err);
    // 只读展示接口：失败返回 null（前端静默降级）
    return NextResponse.json({ ok: true, stats: null });
  }
}
