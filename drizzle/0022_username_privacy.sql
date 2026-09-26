-- 隐私改造（roadmap 外专项）：
--  1) users.username 站内唯一公开昵称（注册必填；存量按 user_0001 格式回填；登录名不再使用邮箱）
--  2) users.show_in_leaderboard 排行榜参与开关（默认参与；用户可在设置页 opt-out）
-- 说明：生产库由 src/db/client.ts 的版本闸门幂等 DDL 应用（同语句），本文件仅作结构存档。
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "username" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "show_in_leaderboard" boolean DEFAULT true NOT NULL;
CREATE SEQUENCE IF NOT EXISTS "users_username_seq" START 1;
UPDATE "users" SET "username" = 'user_' || lpad(nextval('users_username_seq')::text, 4, '0') WHERE "username" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "users_username_key" ON "users" ("username");
ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL;
