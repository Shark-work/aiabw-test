-- 0030_referral_vip_trial.sql · P0 概念收敛：邀请返利 VIP 体验卡档位（2026-10-14）
-- 背景：邀请奖励从「邀请人 +50 积分」升级为「双方各得 3 天 VIP」。
-- trial3d 为隐藏档位（is_active=false）：不出现在 /api/subscription/plans 购买列表，
-- 仅由邀请奖励发放（src/lib/referral-reward.ts grantVipDays，确定性订阅 id 幂等）。
-- 权益与月卡一致（完整 VIP 体验，促进付费转化）；该 INSERT 同时内联于 src/db/client.ts
-- 全量同步段（SCHEMA_VERSION 15），新装库/生产库经 ensureDbSchemaOnce 幂等落种。

INSERT INTO "subscription_plans" ("id","name_zh","name_en","price_rmb","duration_days","daily_chat_limit","features","badge_zh","badge_en","sort_order","is_active") VALUES
  ('trial3d','3 天体验卡','3-Day Trial',0,3,-1,'["unlimitedChat","memoryAccess","rareEquipment","exploreBoost","rareEventBoost","adFree","vipBadge","prioritySupport"]'::jsonb,'邀请奖励','Invite Reward',0,false)
ON CONFLICT ("id") DO NOTHING;

-- 回滚：DELETE FROM "subscription_plans" WHERE "id" = 'trial3d';
-- （存量 user_subscriptions(plan_id='trial3d') 行有外键引用，需先到期或改 plan_id 再删）
