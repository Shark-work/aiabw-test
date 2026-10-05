import { NextResponse } from "next/server";

import { pool } from "@/db/client";

export const runtime = "nodejs";

/**
 * GET /api/soul-cards/featured — 首页「社区灵魂卡」轮播数据源（Phase 7 · 7.1-3）
 *
 * 公开只读（无需登录；卡片本身已有 /soul-cards/[id]/public 公开页机制，
 * 本接口仅返回卡面展示所需的最小字段，绝不泄漏 ownerId 等敏感信息）：
 *  - 口径：status='active' 流通中卡片，稀有度权重 DESC + 铸造时间 DESC，LIMIT 10；
 *  - 缓存：模块级内存 TTL 60s（与 /api/news、/api/visits 同模式，
 *    Serverless 多实例命中率略降但数据只读无正确性问题；接入 Redis 时替换此处即可）。
 */
export type FeaturedSoulCard = {
  id: string;
  name: string;
  rarity: string;
  element: string;
  certificateNo: string;
  growthLevel: number;
};

const CACHE_TTL_MS = 60_000;
let cache: { cards: FeaturedSoulCard[]; expiresAt: number } | null = null;

export async function GET() {
  const now = Date.now();
  if (cache && now < cache.expiresAt) {
    return NextResponse.json({ ok: true, cards: cache.cards });
  }

  try {
    const { rows } = await pool.query<{
      id: string;
      name: string;
      rarity: string;
      element: string;
      certificate_no: string;
      growth_level: number;
    }>(
      `SELECT id, name, rarity, element, certificate_no, growth_level
         FROM soul_cards
        WHERE status = 'active'
        ORDER BY CASE rarity
                   WHEN 'legendary' THEN 4
                   WHEN 'epic' THEN 3
                   WHEN 'rare' THEN 2
                   WHEN 'uncommon' THEN 1
                   ELSE 0
                 END DESC,
                 minted_at DESC
        LIMIT 10`,
    );
    const cards: FeaturedSoulCard[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      rarity: r.rarity,
      element: r.element,
      certificateNo: r.certificate_no,
      growthLevel: r.growth_level,
    }));
    cache = { cards, expiresAt: now + CACHE_TTL_MS };
    return NextResponse.json({ ok: true, cards });
  } catch (err) {
    console.error("[api/soul-cards/featured] failed:", err);
    // 只读展示接口：失败返回空列表（前端静默降级不渲染），不暴露内部错误
    return NextResponse.json({ ok: true, cards: [] });
  }
}
