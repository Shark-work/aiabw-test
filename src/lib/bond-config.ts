/**
 * 羁绊结晶 · 共享纯配置（前后端共用，禁止引入服务端依赖）
 * ----------------------------------------------------------------
 * P1 故事外显（2026-10-14）· 改动三：繁育叙事升级为「羁绊结晶」。
 * 羁绊值表达两只灵宠在同一主人陪伴下的共同经历深浅，达到阈值后解锁「结晶」
 * （底层复用 /api/pets/breed：创建结晶灵宠 + 羁绊结晶藏品 + 自动灵魂凭证）。
 *
 * 数据口径（全部可由现有源表实时推导，不落冗余进度列）：
 *  - 共同经历：用户累计探索次数（exploration_records 用户维度——V2 探索为
 *    灵宠陪伴下的共同经历，pet_id 未启用，与成就系统同口径）；
 *  - 双向陪伴：双方幸福度较小值（adoptions.happiness，两只都要被照顾羁绊才深）；
 *  - 双向互动：双方聊天数较小值（adoptions.chat_count，同理）。
 */

/** 羁绊解锁阈值：达到后可「结晶」。 */
export const BOND_UNLOCK_THRESHOLD = 60;
export const BOND_SCORE_MAX = 100;

/** 子项权重/封顶：探索 ×4 封顶 40 + 幸福 min ×0.3 封顶 30 + 聊天 min ×1.5 封顶 30。 */
export const BOND_EXPLORE_CAP = 40;
export const BOND_EXPLORE_RATE = 4;
export const BOND_HAPPY_CAP = 30;
export const BOND_HAPPY_RATE = 0.3;
export const BOND_CHAT_CAP = 30;
export const BOND_CHAT_RATE = 1.5;

export type BondInputs = {
  /** 用户累计探索次数（两只灵宠共享的世界经历） */
  sharedExplorations: number;
  /** 当前灵宠幸福度 0-100 */
  myHappiness: number;
  /** 伴侣灵宠幸福度 0-100 */
  partnerHappiness: number;
  /** 当前灵宠累计聊天数 */
  myChats: number;
  /** 伴侣灵宠累计聊天数 */
  partnerChats: number;
};

/**
 * 羁绊值纯函数（0-100）：
 *   共同经历（探索 ×4，封顶 40）
 * + 双向陪伴（双方幸福度较小值 ×0.3，封顶 30）
 * + 双向互动（双方聊天数较小值 ×1.5，封顶 30）
 * 设计取向：鼓励均衡养成——只宠一只到满、另一只冷落，羁绊涨不上去。
 */
export function bondScore(i: BondInputs): number {
  const explore = Math.min(
    BOND_EXPLORE_CAP,
    Math.max(0, Math.trunc(i.sharedExplorations)) * BOND_EXPLORE_RATE,
  );
  const happy = Math.min(
    BOND_HAPPY_CAP,
    Math.max(0, Math.min(i.myHappiness, i.partnerHappiness)) * BOND_HAPPY_RATE,
  );
  const chats = Math.min(
    BOND_CHAT_CAP,
    Math.max(0, Math.min(i.myChats, i.partnerChats)) * BOND_CHAT_RATE,
  );
  return Math.min(BOND_SCORE_MAX, Math.round(explore + happy + chats));
}

/** 是否达到结晶解锁阈值。 */
export function bondUnlocked(score: number): boolean {
  return score >= BOND_UNLOCK_THRESHOLD;
}
