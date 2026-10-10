import { NextRequest, NextResponse } from "next/server";

import { pool } from "@/db/client";

export const runtime = "nodejs";

/**
 * GET /api/world?lang=zh|en — 艾比大陆世界观内容查询接口（2026-10-16）
 *
 * 公开只读（无需登录），单请求查 4 张世界观内容表（world_regions / world_life_forms /
 * world_values / world_glossary，drizzle/0037 种子落库），按 lang 返回对应语言字段：
 *  - regions：8 大区域（名称/类型/地脉属性/代表灵宠/氛围描述/habitatId 映射/emoji）；
 *  - lifeForms：3 种生命形态（凡兽/灵宠/古灵，含副标题/描述/代表例）；
 *  - values：5 大信条（名称/标语/对应玩法）；
 *  - glossary：6 个核心概念词条（术语/释义）。
 * 缓存：模块级内存 TTL 60s × 2 语言（与 /api/home/stats 同模式）。
 * 降级：DB 异常返回 { ok: true, data: null }，前端静默回退到 import worldview-data 静态渲染。
 */

export interface WorldRegionDto {
  id: string;
  name: string;
  type: string;
  element: string;
  representatives: string;
  description: string;
  habitatId: string | null;
  emoji: string;
}

export interface WorldLifeFormDto {
  id: string;
  name: string;
  title: string;
  description: string;
  examples: string;
  emoji: string;
}

export interface WorldValueDto {
  id: string;
  name: string;
  slogan: string;
  feature: string;
  emoji: string;
}

export interface WorldGlossaryDto {
  id: string;
  term: string;
  definition: string;
  emoji: string;
}

export interface WorldData {
  regions: WorldRegionDto[];
  lifeForms: WorldLifeFormDto[];
  values: WorldValueDto[];
  glossary: WorldGlossaryDto[];
}

const CACHE_TTL_MS = 60_000;
const cache: Record<string, { data: WorldData; expiresAt: number } | null> = {};

export async function GET(req: NextRequest) {
  const lang = req.nextUrl.searchParams.get("lang") === "en" ? "en" : "zh";
  const now = Date.now();
  const hit = cache[lang];
  if (hit && now < hit.expiresAt) {
    return NextResponse.json({ ok: true, data: hit.data });
  }

  const zh = lang === "zh";
  try {
    const [regions, lifeForms, values, glossary] = await Promise.all([
      pool.query(
        `SELECT "id", ${zh ? '"name_zh" AS "name", "type_zh" AS "type", "element_zh" AS "element", "representatives_zh" AS "representatives", "description_zh" AS "description"' : '"name_en" AS "name", "type_en" AS "type", "element_en" AS "element", "representatives_en" AS "representatives", "description_en" AS "description"'},
                "habitat_id" AS "habitatId", "emoji"
           FROM "world_regions" ORDER BY "sort_order" ASC`,
      ),
      pool.query(
        `SELECT "id", ${zh ? '"name_zh" AS "name", "title_zh" AS "title", "description_zh" AS "description", "examples_zh" AS "examples"' : '"name_en" AS "name", "title_en" AS "title", "description_en" AS "description", "examples_en" AS "examples"'},
                "emoji"
           FROM "world_life_forms" ORDER BY "sort_order" ASC`,
      ),
      pool.query(
        `SELECT "id", ${zh ? '"name_zh" AS "name", "slogan_zh" AS "slogan", "feature_zh" AS "feature"' : '"name_en" AS "name", "slogan_en" AS "slogan", "feature_en" AS "feature"'},
                "emoji"
           FROM "world_values" ORDER BY "sort_order" ASC`,
      ),
      pool.query(
        `SELECT "id", ${zh ? '"term_zh" AS "term", "definition_zh" AS "definition"' : '"term_en" AS "term", "definition_en" AS "definition"'},
                "emoji"
           FROM "world_glossary" ORDER BY "sort_order" ASC`,
      ),
    ]);

    const data: WorldData = {
      regions: regions.rows as WorldRegionDto[],
      lifeForms: lifeForms.rows as WorldLifeFormDto[],
      values: values.rows as WorldValueDto[],
      glossary: glossary.rows as WorldGlossaryDto[],
    };
    cache[lang] = { data, expiresAt: now + CACHE_TTL_MS };
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/world] failed:", err);
    // 只读展示接口：失败返回 null（前端静默降级到 import worldview-data 静态渲染）
    return NextResponse.json({ ok: true, data: null });
  }
}
