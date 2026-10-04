/**
 * 明信片墙 · 共享纯配置（前后端共用，禁止引入服务端依赖）
 * ----------------------------------------------------------------
 * P1 故事外显（2026-10-14）· 改动四：探索产出外显。
 * 明信片 = exploration_records（result_type='postcard'），故事文本沿用探索奇遇文案
 * （result_data 反序列化，与 /api/exploration/history 同口径）。
 *
 * 系列 = exploration_events.pet_category（cat/fox/dog/rabbit/bird）；
 * 集齐某系列全部 postcard 事件 → 可领取图鉴奖励（积分），
 * 领取记录复用 achievements 表（badge_id='postcard-<category>'，
 * UNIQUE(user_id,badge_id) 幂等，不落新表；与元老探险家徽章同模式）。
 */

export const POSTCARD_SETS = [
  { category: "cat", emoji: "🐱", labelZh: "猫咪系列", labelEn: "Cat Series" },
  { category: "fox", emoji: "🦊", labelZh: "赤狐系列", labelEn: "Fox Series" },
  { category: "dog", emoji: "🐶", labelZh: "柴犬系列", labelEn: "Shiba Series" },
  { category: "rabbit", emoji: "🐰", labelZh: "垂耳兔系列", labelEn: "Bunny Series" },
  { category: "bird", emoji: "🦜", labelZh: "鹦鹉系列", labelEn: "Bird Series" },
] as const;
export type PostcardSetCategory = (typeof POSTCARD_SETS)[number]["category"];

/** 集齐单系列明信片的图鉴奖励（积分）。 */
export const POSTCARD_SET_REWARD_POINTS = 30;

/** 领取记录 badge_id（achievements 表复用，UNIQUE(user_id,badge_id) 幂等）。 */
export function postcardSetBadgeId(category: string): string {
  return `postcard-${category}`;
}

/** 领取记录 badge_id 前缀（查已领取列表用）。 */
export const POSTCARD_BADGE_PREFIX = "postcard-";
