-- ════════════════════════════════════════════════════════════════════════
-- 0039_pet_chat_observability.sql · 宠物对话可观测性 + 计费口径（2026-10-17，Phase 12）
--
-- 背景（AI 宠物模块框架性修复 需求五.3 / 六.3）：
--   - 每日免费对话 5 次：计数口径 = 当日 pet_play_logs 中 kind='chat' 的行数；
--     AI 全 provider 失败走本地兜底时积分退款，日志行标记 kind='chat_refund'（不占次数）；
--   - 道具使用（/api/pet/play/use）补写交互记录 kind='item'（需求四.3）；
--   - 成本核算：duration_ms（AI 调用耗时）+ tokens_used（token 总消耗，
--     provider 未上报时按字符估算）+ source（ai/fallback 出文来源）。
--
-- 幂等：全部 ADD COLUMN IF NOT EXISTS，可在已有库上重复执行。
-- 生产同步：client.ts 版本闸门（SCHEMA_VERSION 24）自动执行；本文件为档案 + 手动副本。
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE "pet_play_logs" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'chat' NOT NULL;
ALTER TABLE "pet_play_logs" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'ai' NOT NULL;
ALTER TABLE "pet_play_logs" ADD COLUMN IF NOT EXISTS "duration_ms" integer;
ALTER TABLE "pet_play_logs" ADD COLUMN IF NOT EXISTS "tokens_used" integer;
