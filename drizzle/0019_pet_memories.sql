-- 宠物旅行日记 · 宠物长期记忆库（VIP 专属）（drizzle/0019_pet_memories.sql）
-- 幂等：与 drizzle/0018_subscription.sql 风格一致，可在已存在表上重复执行。
--
--  pet_memories 结构化记忆表（区别于 adoptions.memory_context 的 JSON 存储）：
--   - memory_type: preference(偏好) / event(事件) / fact(事实) / emotion(情绪)
--   - importance: 重要度 1-10，用于召回排序权重
--   - times_recalled + last_recalled_at: 召回统计
--   - expires_at: 临时记忆可设置过期（NULL=永不过期）
--  VIP 访问控制：见 src/lib/memory-gate.hasMemoryAccess()。

CREATE TABLE IF NOT EXISTS "pet_memories" (
  "id"               text PRIMARY KEY,
  "user_id"          uuid NOT NULL REFERENCES "users"("id"),
  "pet_id"           text,
  "memory_type"      text NOT NULL CHECK ("memory_type" IN ('preference', 'event', 'fact', 'emotion')),
  "content"          text NOT NULL,
  "source_message"   text,
  "importance"       integer DEFAULT 5 NOT NULL CHECK ("importance" BETWEEN 1 AND 10),
  "times_recalled"   integer DEFAULT 0 NOT NULL,
  "last_recalled_at" timestamp,
  "expires_at"       timestamp,
  "created_at"       timestamp DEFAULT now() NOT NULL
);

-- 索引：按用户、按用户+宠物、按用户+类型快速过滤
CREATE INDEX IF NOT EXISTS "idx_pet_memories_user"      ON "pet_memories" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_pet_memories_user_pet"  ON "pet_memories" ("user_id", "pet_id");
CREATE INDEX IF NOT EXISTS "idx_pet_memories_user_type" ON "pet_memories" ("user_id", "memory_type");
