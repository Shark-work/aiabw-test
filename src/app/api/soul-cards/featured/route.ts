import { NextResponse } from "next/server";

import { pool } from "@/db/client";

export const runtime = "nodejs";

/**
 * GET /api/soul-cards/featured — 公开热门灵魂卡（Phase 7 · 7.1-3 首页轮播 + 7.4-3 社区热门 tab）
 *
 * 公开只读（无需登录；卡片本身已有 /soul-cards/[id]/public 公开页机制）：
 *  - 口径：status='active' 流通中卡片，稀有度权重 DESC + 铸造时间 DESC，LIMIT 10；
 *  - 字段：卡面展示全量字段（JOIN pets / pet_dictionary 补齐立绘与物种名），
 *    与 SoulCardDto 同构（缺省字段前端补 null/""），**绝不返回 owner_id / mint_tx / burn_tx**
 *    （归属与链上哈希属敏感信息；公开页同样不暴露）；
 *  - 缓存：模块级内存 TTL 60s（与 /api/news、/api/visits 同模式，
 *    Serverless 多实例命中率略降但数据只读无正确性问题；接入 Redis 时替换此处即可）。
 */
export type FeaturedSoulCard = {
  id: string;
  petId: string;
  name: string;
  rarity: string;
  element: string;
  habitat: string | null;
  aiPersonality: Record<string, unknown>;
  growthStage: string;
  growthLevel: number;
  growthExp: number;
  tokenId: number;
  certificateNo: string;
  mintedAt: string;
  petImageUrl: string;
  speciesId: string;
  speciesNameZh: string;
  speciesNameEn: string;
};

const CACHE_TTL_MS = 60_000;
let cache: { cards: FeaturedSoulCard[]; expiresAt: number } | null = null;

export async function GET() {
  const now = Date.now();
  if (cache && now < cache.expiresAt) {
    return NextResponse.json({ ok: true, cards: cache.cards });
  }

  try {
    const { rows } = await pool.query<Record<string, unknown>>(
      `SELECT sc.id, sc.pet_id, sc.name, sc.rarity, sc.element, sc.habitat,
              sc.ai_personality, sc.growth_stage, sc.growth_level, sc.growth_exp,
              sc.token_id, sc.certificate_no, sc.minted_at,
              p.image_url AS pet_image_url, p.species_id,
              pd.name_zh AS species_name_zh, pd.name_en AS species_name_en
         FROM soul_cards sc
         JOIN pets p ON p.id = sc.pet_id
         JOIN pet_dictionary pd ON pd.id = p.species_id
        WHERE sc.status = 'active'
        ORDER BY CASE sc.rarity
                   WHEN 'legendary' THEN 4
                   WHEN 'epic' THEN 3
                   WHEN 'rare' THEN 2
                   WHEN 'uncommon' THEN 1
                   ELSE 0
                 END DESC,
                 sc.minted_at DESC
        LIMIT 10`,
    );
    const cards: FeaturedSoulCard[] = rows.map((r) => ({
      id: String(r.id),
      petId: String(r.pet_id),
      name: String(r.name),
      rarity: String(r.rarity),
      element: String(r.element),
      habitat: (r.habitat as string | null) ?? null,
      aiPersonality: (r.ai_personality as Record<string, unknown>) ?? {},
      growthStage: String(r.growth_stage),
      growthLevel: Number(r.growth_level),
      growthExp: Number(r.growth_exp),
      tokenId: Number(r.token_id),
      certificateNo: String(r.certificate_no),
      mintedAt: r.minted_at instanceof Date ? r.minted_at.toISOString() : String(r.minted_at),
      petImageUrl: String(r.pet_image_url),
      speciesId: String(r.species_id),
      speciesNameZh: String(r.species_name_zh),
      speciesNameEn: String(r.species_name_en),
    }));
    cache = { cards, expiresAt: now + CACHE_TTL_MS };
    return NextResponse.json({ ok: true, cards });
  } catch (err) {
    console.error("[api/soul-cards/featured] failed:", err);
    // 只读展示接口：失败返回空列表（前端静默降级不渲染），不暴露内部错误
    return NextResponse.json({ ok: true, cards: [] });
  }
}
