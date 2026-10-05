/**
 * 探索 v2 · 奖励引擎（产品升级 Phase 3，2026-10-16）
 *
 * 纯函数模块（API 路由 / 契约测试共用；与 exploration-engine.ts 同风格）：
 *
 * 奖励池（每次探索结算）：
 *   1) 基础积分：按事件稀有度 common +2 / rare +5 / epic +10；VIP ×1.5 向下取整
 *      （呼应探索引擎 VIP 步数 ×1.5 的既定权益口径）
 *   2) 连探加成：连续探索第 2 天起每天 +1，上限 +5（streak - 1 封 5）
 *   3) 里程碑：累计探索每满 10 次（10/20/30…）额外 +10 积分 + 灵魂碎片 ×1
 *   4) 道具掉落：rare 30% / epic 100% 掉落 1 件（复用签到盲盒道具池 rollCheckinItem）
 *   5) 灵魂卡碎片：epic 100% / rare 20% 掉落；入 user_items
 *      （item_key='soul_fragment'，source='exploration'，背包通用原则；
 *       碎片兑换用途留待后续迭代，本期只做产出外显）
 *
 * 幂等设计（与发放事务配合）：
 *   - points_log.ref = 'explore:' + recordId，idx_points_log_ref 唯一索引兜底，
 *     同一探索记录重复结算（重试/重放）撞 UNIQUE → 事务回滚，绝不重复发奖；
 *   - streak / 里程碑全部由 exploration_records 实时推导（无冗余进度表，
 *     无双写不一致风险——与成就系统「进度由源表推导」规格一致）。
 */

import {
  rollCheckinItem,
  type CheckinItem,
} from "@/lib/checkin-items";
import type { Rarity } from "@/lib/exploration-engine";

// ───────────── 配置常量 ─────────────

export const EXPLORATION_REWARD_CONFIG = {
  /** 基础积分（按事件稀有度） */
  BASE_POINTS: { common: 2, rare: 5, epic: 10 } as Record<Rarity, number>,
  /** VIP 基础分倍率（向下取整） */
  VIP_MULTIPLIER: 1.5,
  /** 连探加成上限：streak 第 2 天起每天 +1，封 +5 */
  STREAK_BONUS_CAP: 5,
  /** 里程碑间隔（累计探索次数）与奖励 */
  MILESTONE_INTERVAL: 10,
  MILESTONE_POINTS: 10,
  MILESTONE_FRAGMENTS: 1,
  /** 灵魂卡碎片（user_items 条目） */
  FRAGMENT_ITEM_KEY: "soul_fragment",
  REWARD_SOURCE: "exploration",
  /** 碎片掉落概率（按稀有度） */
  FRAGMENT_DROP: { common: 0, rare: 0.2, epic: 1 } as Record<Rarity, number>,
  /** 道具掉落概率（按稀有度） */
  ITEM_DROP: { common: 0, rare: 0.3, epic: 1 } as Record<Rarity, number>,
  /** points_log.reason（审计流水） */
  POINTS_REASON: "exploration_reward",
} as const;

// ───────────── 类型 ─────────────

export type ExplorationRewards = {
  /** 基础积分（已含 VIP 倍率） */
  basePoints: number;
  /** 连探加成积分 */
  streakBonus: number;
  /** 里程碑积分（未触发为 0） */
  milestonePoints: number;
  /** 本次总积分（base + streak + milestone） */
  points: number;
  /** 掉落道具（签到盲盒池条目；无掉落为 []） */
  items: CheckinItem[];
  /** 本次获得灵魂碎片数（含里程碑追加） */
  fragments: number;
  /** 结算后连续探索天数（含今天） */
  streak: number;
  /** 触发的里程碑次数（如 10/20；未触发为 null） */
  milestone: number | null;
};

/** API 响应里的道具快照（展示名由服务端按 locale 选好） */
export type ExplorationRewardItemPayload = {
  key: string;
  name: string;
  emoji: string;
  rarity: string;
};

/** API 响应里的奖励块（rewards=null 表示发放失败降级） */
export type ExplorationRewardsPayload = Omit<ExplorationRewards, "items"> & {
  items: ExplorationRewardItemPayload[];
};

// ───────────── 1) 连续天数计算 ─────────────

/** 'YYYY-MM-DD'（UTC）→ 前一天 */
function prevDay(d: string): string {
  const dt = new Date(`${d}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

/**
 * 连续探索天数：输入用户探索过的日期列表（UTC 'YYYY-MM-DD'，DESC 去重）+ 今天。
 *  - 今天已有记录（start 结算场景）→ 从今天往回数；
 *  - 今天还没有、但昨天有（quota 展示场景）→ 连续未断，从昨天往回数；
 *  - 否则连续已断 → 0。
 */
export function computeStreak(daysDesc: string[], today: string): number {
  if (!Array.isArray(daysDesc) || daysDesc.length === 0) return 0;
  const yesterday = prevDay(today);
  let cursor: string;
  if (daysDesc[0] === today) cursor = today;
  else if (daysDesc[0] === yesterday) cursor = yesterday;
  else return 0;
  let streak = 1;
  for (let i = 1; i < daysDesc.length; i++) {
    const prev = prevDay(cursor);
    if (daysDesc[i] === prev) {
      streak++;
      cursor = prev;
    } else break;
  }
  return streak;
}

// ───────────── 2) 奖励结算 ─────────────

/**
 * 单次探索奖励结算。
 * @param rarity 事件稀有度
 * @param isVip VIP 用户（基础分 ×1.5）
 * @param streak 结算后连续天数（含今天，由 computeStreak 得出）
 * @param totalCount 累计探索次数（含本次，= COUNT(exploration_records) 写入后）
 * @param random 随机源（测试注入）；调用顺序固定：碎片 roll → 道具 roll(稀有度) → 道具 pick
 */
export function computeRewards(input: {
  rarity: Rarity;
  isVip: boolean;
  streak: number;
  totalCount: number;
  random?: () => number;
}): ExplorationRewards {
  const rand = input.random ?? Math.random;
  const C = EXPLORATION_REWARD_CONFIG;

  const base = C.BASE_POINTS[input.rarity] ?? C.BASE_POINTS.common;
  const basePoints = input.isVip ? Math.floor(base * C.VIP_MULTIPLIER) : base;

  const streak = Math.max(0, Math.floor(input.streak));
  const streakBonus = Math.min(Math.max(streak - 1, 0), C.STREAK_BONUS_CAP);

  const totalCount = Math.max(0, Math.floor(input.totalCount));
  const milestone =
    totalCount > 0 && totalCount % C.MILESTONE_INTERVAL === 0 ? totalCount : null;
  const milestonePoints = milestone ? C.MILESTONE_POINTS : 0;

  const points = basePoints + streakBonus + milestonePoints;

  // 灵魂碎片：稀有度概率 + 里程碑追加（调用顺序 1：碎片 roll）
  let fragments = 0;
  if (rand() < (C.FRAGMENT_DROP[input.rarity] ?? 0)) fragments += 1;
  if (milestone) fragments += C.MILESTONE_FRAGMENTS;

  // 道具掉落：rare 30% / epic 100%，复用签到盲盒池（调用顺序 2/3）
  const items: CheckinItem[] = [];
  if (rand() < (C.ITEM_DROP[input.rarity] ?? 0)) {
    items.push(rollCheckinItem(rand(), false, rand()));
  }

  return {
    basePoints,
    streakBonus,
    milestonePoints,
    points,
    items,
    fragments,
    streak,
    milestone,
  };
}
