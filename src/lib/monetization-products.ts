/**
 * 变现商品定价表（产品升级 Phase 6 · 指令 1，服务端唯一定价来源）。
 *
 * 安全约束：与 POINTS_PACKS 同规 —— 价格一律以此表为准，拒绝客户端提交金额（防改价）。
 * 改动本表 = 价格变更，无需 bump SCHEMA_VERSION（纯代码常量）。
 *
 * 订单号约定（pay/notify 按前缀分发）：
 *  - premium-yearly-<userId>-<nonce>   高级公民年卡（premium_until +365 天）
 *  - breedaccel-<collectibleId>-<userId>-<nonce>  结晶加速（清 breed_cooldown_until）
 *  - chatpack-<messages>-<userId>-<nonce>         聊天包（当日已用额度回充）
 *  - promo24-<contentId>-<userId>-<nonce>         推荐曝光 24h 现金通道
 */

/** 高级公民年卡：¥148 / 365 天（对比月卡 ¥18×12=¥216，省 ¥68，与实施计划 8.1.1 一致） */
export const VIP_YEARLY_PRICE_CNY = 148;
export const VIP_YEARLY_DAYS = 365;

/** 结晶加速：¥5 / 次（立即清除 user_collectibles.breed_cooldown_until） */
export const BREED_ACCEL_PRICE_CNY = 5;

/** 聊天包：¥9.9 / 50 句（当日 chat_quotas.message_count 回充，等价当日额度 +50） */
export const CHAT_PACK_PRICE_CNY = 9.9;
export const CHAT_PACK_MESSAGES = 50;

/** 推荐曝光现金通道：¥6 / 24 小时（与积分通道 1 天档等价，priority=1） */
export const PROMO_CASH_PRICE_CNY = 6;
export const PROMO_CASH_HOURS = 24;
