-- ════════════════════════════════════════════════════════════════════════
-- 0037_worldview.sql · 艾比大陆世界观内容体系（2026-10-16）
--
-- 四张世界观内容表（种子由 src/lib/worldview-data.ts 单一数据源生成，
-- client.ts 版本闸门自动同步时经 src/db/worldview-seed.ts upsert 灌库）：
--   1) world_regions     8 大区域（艾比小镇 + 7 探索区域；habitat_id 逻辑映射
--                        aibi_habitats.id，不建 FK——区域是世界观概念，栖息地是游戏数据）
--   2) world_life_forms  3 种生命形态（凡兽/灵宠/古灵）
--   3) world_values      5 大信条（共鸣/探索/收藏/羁绊/传承）
--   4) world_glossary    6 个核心概念词条（灵魂种子/灵魂卡/地脉能量/羁绊结晶/明信片/灵魂树）
-- 全部内容表公开只读（/api/world 查询接口），双语列 zh/en 成对存储。
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "world_regions" (
  "id"                  text PRIMARY KEY,
  "name_zh"             text NOT NULL,
  "name_en"             text NOT NULL,
  "type_zh"             text NOT NULL,
  "type_en"             text NOT NULL,
  "element_zh"          text NOT NULL,
  "element_en"          text NOT NULL,
  "representatives_zh"  text NOT NULL,
  "representatives_en"  text NOT NULL,
  "description_zh"      text NOT NULL,
  "description_en"      text NOT NULL,
  "habitat_id"          text,
  "emoji"               text NOT NULL DEFAULT '🗺️',
  "sort_order"          integer NOT NULL DEFAULT 0,
  "created_at"          timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "world_life_forms" (
  "id"              text PRIMARY KEY,
  "name_zh"         text NOT NULL,
  "name_en"         text NOT NULL,
  "title_zh"        text NOT NULL,
  "title_en"        text NOT NULL,
  "description_zh"  text NOT NULL,
  "description_en"  text NOT NULL,
  "examples_zh"     text NOT NULL,
  "examples_en"     text NOT NULL,
  "emoji"           text NOT NULL DEFAULT '🐾',
  "sort_order"      integer NOT NULL DEFAULT 0,
  "created_at"      timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "world_values" (
  "id"          text PRIMARY KEY,
  "name_zh"     text NOT NULL,
  "name_en"     text NOT NULL,
  "slogan_zh"   text NOT NULL,
  "slogan_en"   text NOT NULL,
  "feature_zh"  text NOT NULL,
  "feature_en"  text NOT NULL,
  "emoji"       text NOT NULL DEFAULT '✨',
  "sort_order"  integer NOT NULL DEFAULT 0,
  "created_at"  timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "world_glossary" (
  "id"             text PRIMARY KEY,
  "term_zh"        text NOT NULL,
  "term_en"        text NOT NULL,
  "definition_zh"  text NOT NULL,
  "definition_en"  text NOT NULL,
  "emoji"          text NOT NULL DEFAULT '📖',
  "sort_order"     integer NOT NULL DEFAULT 0,
  "created_at"     timestamp DEFAULT now() NOT NULL
);

-- 展示顺序固定走 sort_order（内容表行数极小：8/3/5/6，无需额外索引）
