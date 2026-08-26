// 高级公民月卡（Premium）——情绪与特权消费核心：
//  - 人民币月卡购买（XorPay），到期自动降级；
//  - 特权：AI 对话解锁更长上下文记忆（上下文压缩参数放宽）。
import type { CompressOptions } from "@/lib/context-compress";

/** 月卡价格（元，XorPay 下单金额） */
export const PREMIUM_PRICE_CNY = 1;
/** 月卡时长（天） */
export const PREMIUM_DURATION_DAYS = 30;

/** 普通用户：上下文压缩参数（阈值 10 轮 / 保留最近 5 轮） */
export const FREE_COMPRESS: CompressOptions = { maxTurns: 10, keepRecent: 5 };
/** 高级公民：更长上下文记忆（阈值 20 轮 / 保留最近 12 轮） */
export const PREMIUM_COMPRESS: CompressOptions = { maxTurns: 20, keepRecent: 12 };

/** 是否处于高级公民会员期。 */
export function isPremium(premiumUntil: Date | string | null | undefined, now: Date = new Date()): boolean {
  if (!premiumUntil) return false;
  return new Date(premiumUntil).getTime() > now.getTime();
}

/** 按会员状态返回上下文压缩参数（特权：会员更长记忆）。 */
export function compressForPremium(premium: boolean): CompressOptions {
  return premium ? PREMIUM_COMPRESS : FREE_COMPRESS;
}
