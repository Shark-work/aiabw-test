-- 0031_onboarding.sql
-- P1 故事外显（2026-10-14）：新手引导「唤醒仪式」完成标记
--
--   users.onboarding_completed：新手三步引导（遇见 → 唤醒 → 启程）完成后置 true，
--   下次登录不再进入引导；未完成时首页顶部展示「灵宠还在沉睡」轻量 banner。
--   存量老用户默认 false，但因已持有灵宠（adoptions 非空），前端判定
--   showOnboarding = !completed && !hasPet，老用户天然不进入引导、不见 banner。
--
-- 幂等：ADD COLUMN IF NOT EXISTS（与 0029/0030 增量列同风格）。

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "onboarding_completed" boolean DEFAULT false NOT NULL;
