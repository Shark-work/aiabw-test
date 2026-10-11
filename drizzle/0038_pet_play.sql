-- ════════════════════════════════════════════════════════════════════════
-- 0038_pet_play.sql · AI 宠物互动页（Rive 沉浸互动 /pets/my/[id]/play，2026-10-16）
--
-- 需求原始 4 表与既有 schema 的映射（避免重复建表 / 命名冲突，代码事实为准）：
--   需求 pets(id,user_id,type,hunger_level,mood_value,intimacy,created_at)
--     → 既有 adoptions 表（id/userId/petType/adoptedAt 已存在）：
--       hunger_level = 本迁移新补列（下方 1)）
--       mood_value   = adoptions.happiness（0-100，/api/interact 既有维护口径）
--       intimacy     = adoptions.level + chat_count 派生（roadmap 锁定口径：
--                      代码无独立 intimacy 字段，亲密度即 happiness/等级体系）
--   需求 items(id,name,price,description,image_url)
--     → 代码常量目录 src/lib/pet-play-config.ts PLAY_ITEMS（与 checkin-items 同模式：
--       道具是运营配置而非用户数据，emoji 图标即 image_url 语义，免迁移演进）
--   需求 user_backpack(user_id,item_id,quantity)
--     → 既有 user_items 表（item_key 引用目录常量；source='pet_play' 区分来源；
--       数量 = COUNT(*) 聚合，一件一行——不制造第三套背包体系）
--   需求 chat_logs(id,user_id,user_input,pet_reply,emotion,created_at)
--     → 本迁移新表 pet_play_logs（下方 2)，扩展 adoption_id 维度 + action 列
--       （Rive 状态机触发动作，服务端契约的一部分，必须落库可审计））
--
-- 迁移内容：
--   1) adoptions.hunger_level  饥饿度 0-100（默认 50；喂食 +N，对话随时间缓慢消耗）
--   2) pet_play_logs           互动对话流水（user/adoption 维度 + 情绪/动作契约）
--   3) idx_pet_play_logs_user      按用户查历史
--   4) idx_pet_play_logs_adoption  按宠物查历史
--
-- 幂等：全部 IF NOT EXISTS / IF NOT EXISTS COLUMN，可在已有库上重复执行。
-- 生产同步：client.ts 版本闸门（SCHEMA_VERSION 23）自动执行；本文件为档案 + 手动副本。
-- ════════════════════════════════════════════════════════════════════════

-- 1) 饥饿度列（需求 pets.hunger_level 在既有领养体系上的落点）
ALTER TABLE "adoptions" ADD COLUMN IF NOT EXISTS "hunger_level" integer DEFAULT 50 NOT NULL;

-- 2) 互动对话流水（需求 chat_logs 落点；emotion/action 为 Rive 状态机契约标签）
CREATE TABLE IF NOT EXISTS "pet_play_logs" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id"     uuid NOT NULL REFERENCES "users"("id"),
  "adoption_id" uuid NOT NULL REFERENCES "adoptions"("id"),
  "user_input"  text NOT NULL,
  "pet_reply"   text NOT NULL,
  "emotion"     text NOT NULL DEFAULT 'idle',
  "action"      text NOT NULL DEFAULT 'idle',
  "created_at"  timestamp DEFAULT now() NOT NULL
);

-- 3) 4) 查询索引
CREATE INDEX IF NOT EXISTS "idx_pet_play_logs_user"     ON "pet_play_logs" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_pet_play_logs_adoption" ON "pet_play_logs" ("adoption_id", "created_at");
