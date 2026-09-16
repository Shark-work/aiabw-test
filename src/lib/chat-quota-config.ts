/**
 * 宠物旅行日记 · VIP 订阅系统配置（纯常量，零依赖、零副作用）
 *
 * 设计原则：
 *  - FREE_DAILY_LIMIT：免费注册用户每日聊天上限。达到后硬限制。
 *  - VIP_DAILY_LIMIT：-1 表示无限（VIP 不计数）。
 *  - SOFT_WARN_AT：达到 80% 触发软提醒（黄色提示条）。
 *  - GUEST_DAILY_LIMIT：未登录游客每日上限（更严，5 条）。
 *
 * 与之配套的文案库见 src/lib/quota-messages.ts，
 * 订阅计划元信息见 src/lib/subscription-config.ts。
 */

export const QUOTA_CONFIG = {
  /** 免费用户每日聊天上限（条） */
  FREE_DAILY_LIMIT: 10,
  /** 未登录游客每日聊天上限（条）。暂不实施（chat API 已要求登录） */
  GUEST_DAILY_LIMIT: 5,
  /** VIP 每日聊天上限：-1 = 无限 */
  VIP_DAILY_LIMIT: -1,
  /** 软提醒阈值（0-1）；达到 80% 弹黄色提示 */
  SOFT_WARN_AT: 0.8,
} as const;

export type QuotaStatus = "normal" | "soft_warn" | "hard_limit" | "vip";

/**
 * 计算当前额度状态。
 *
 *  - VIP：始终返回 'vip'（无限）
 *  - 计数 >= FREE_DAILY_LIMIT：返回 'hard_limit'（达到上限）
 *  - 计数 >= FREE_DAILY_LIMIT × SOFT_WARN_AT：返回 'soft_warn'（接近上限）
 *  - 其它：返回 'normal'
 */
export function getQuotaStatus(messageCount: number, isVip: boolean): QuotaStatus {
  if (isVip) return "vip";
  if (messageCount >= QUOTA_CONFIG.FREE_DAILY_LIMIT) return "hard_limit";
  if (messageCount >= Math.floor(QUOTA_CONFIG.FREE_DAILY_LIMIT * QUOTA_CONFIG.SOFT_WARN_AT)) {
    return "soft_warn";
  }
  return "normal";
}

/**
 * 剩余可用次数（仅对 free 用户有意义；VIP 永远返回 -1）
 */
export function getRemaining(messageCount: number, isVip: boolean): number {
  if (isVip) return -1;
  return Math.max(0, QUOTA_CONFIG.FREE_DAILY_LIMIT - messageCount);
}

/**
 * 本地日期（YYYY-MM-DD）—— 用服务器 UTC 日期。
 * 跨时区一致性：以服务器时区为准，避免游客跨时区双重计数。
 */
export function todayString(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
