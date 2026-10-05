/**
 * 首页「回来看看」提示 · 共享纯配置（前后端共用，禁止引入服务端依赖）
 * ----------------------------------------------------------------
 * P2 社交传播（2026-10-14）· 改动四：提升次日留存。
 * 三类提醒（可叠加，优先级按数组顺序）：
 *  1) missYou 用户上次登录超过 24 小时 →「你的灵宠想你了」→ /my-pets；
 *  2) feed    持有灵宠最低幸福度低于阈值 →「该去喂养它了」→ /my-pets；
 *  3) reward  有集齐但未领取的明信片系列图鉴奖励 →「待领取奖励」→ /explore-v2。
 * 判定逻辑纯函数化（buildReminders），SQL 只负责取数，便于契约测试直测。
 */

/** 「想你了」判定阈值：上次登录距现在超过该小时数。 */
export const RECALL_AWAY_HOURS = 24;

/** 「该喂养了」判定阈值：最低幸福度低于该值（adoptions.happiness 0-100）。 */
export const RECALL_LOW_HAPPINESS = 40;

export type RecallReminderType = "missYou" | "feed" | "reward";

export type RecallReminder = {
  type: RecallReminderType;
  /** feed 类：最低幸福度灵宠名 */
  petName?: string;
  /** reward 类：集齐未领取的系列数 */
  count?: number;
};

export type RecallInput = {
  /** users.last_login_at（每次登录更新）；null 视为从未登录 → 触发 missYou */
  lastLoginAt: Date | null;
  /** 持有灵宠最低幸福度（无灵宠 → null，不触发 feed） */
  lowestHappiness: number | null;
  /** 最低幸福度灵宠名（feed 文案用） */
  lowestPetName: string | null;
  /** 集齐但未领取的明信片系列数（>0 触发 reward） */
  unclaimedSets: number;
  now?: Date;
};

/** 提醒判定（纯函数）：满足条件的全部返回，前端逐条渲染。 */
export function buildReminders(input: RecallInput): RecallReminder[] {
  const now = input.now ?? new Date();
  const out: RecallReminder[] = [];

  const awayMs = input.lastLoginAt
    ? now.getTime() - input.lastLoginAt.getTime()
    : Number.POSITIVE_INFINITY;
  if (awayMs > RECALL_AWAY_HOURS * 3_600_000) {
    out.push({ type: "missYou" });
  }

  if (input.lowestHappiness != null && input.lowestHappiness < RECALL_LOW_HAPPINESS) {
    out.push({ type: "feed", petName: input.lowestPetName ?? undefined });
  }

  if (input.unclaimedSets > 0) {
    out.push({ type: "reward", count: input.unclaimedSets });
  }

  return out;
}
