-- 0032_postcard_wall_public.sql
-- P2 社交传播（2026-10-14）：明信片墙公开页隐私开关
--
--   users.postcard_wall_public：是否公开自己的明信片墙（默认 false 不公开）。
--   开启后 /postcard-wall/[userId] 公开页与汇总分享图可被任何人访问（无需登录）；
--   关闭时公开入口一律 404（不泄露开关状态）。设置页可随时切换。
--
-- 幂等：ADD COLUMN IF NOT EXISTS（与 0031 增量列同风格）。

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "postcard_wall_public" boolean DEFAULT false NOT NULL;
