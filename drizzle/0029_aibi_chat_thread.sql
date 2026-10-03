-- Aibi ↔ 聊天（方案 a，2026-10-07）：aibi_tokens 增加 thread_id 会话绑定列。
--  - nullable：老数据为 NULL，首次点「创建聊天」经 POST /api/threads 创建线程后回填；
--  - ON DELETE SET NULL：线程删除时凭证保留、绑定自动解除（不级联删凭证）；
--  - 幂等（IF NOT EXISTS），可安全重复执行；应用侧由 src/db/client.ts 版本闸门（v12）自动同步。
ALTER TABLE "aibi_tokens" ADD COLUMN IF NOT EXISTS "thread_id" uuid REFERENCES "threads"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_aibi_tokens_thread_id" ON "aibi_tokens" ("thread_id");
