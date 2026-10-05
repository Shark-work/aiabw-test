/**
 * 季节活动 · 共享纯配置（前后端共用，禁止引入服务端依赖）
 * ----------------------------------------------------------------
 * P2 社交传播（2026-10-14）· 改动三：季节活动骨架。
 * 本次只搭框架：配置表 + 进度表 + 进行中活动接口 + 探索页 banner；
 * 不实现具体活动内容与奖励发放（占位活动 slug='placeholder'，is_active=false，
 * 后续运营通过改配置开启，无需发版）。
 */

/** 活动奖励定义（JSONB）：积分 / VIP 天数 / 限定藏品（后续运营扩展）。 */
export type SeasonalRewards = {
  points?: number;
  vipDays?: number;
  collectibleId?: string;
};

/** 多语言文本（JSONB 存储形态）。 */
export type SeasonalI18nText = { zh: string; en: string };

/** 进行中活动 DTO（/api/seasonal-events/active 响应）。 */
export type SeasonalEventDto = {
  slug: string;
  name: SeasonalI18nText;
  description: SeasonalI18nText;
  startAt: string;
  endAt: string;
  rewards: SeasonalRewards;
};

/** 用户在活动中的进度（user_seasonal_progress 行）。 */
export type SeasonalProgressDto = {
  explorationCount: number;
  bondCrystals: number;
  claimed: boolean;
};

/** 进行中判定（纯函数）：开关开 + 当前时间落在 [startAt, endAt] 窗口内。 */
export function isSeasonalEventActive(
  e: { isActive: boolean; startAt: Date; endAt: Date },
  now: Date = new Date(),
): boolean {
  return e.isActive && e.startAt.getTime() <= now.getTime() && now.getTime() <= e.endAt.getTime();
}

/** 按 locale 取多语言文本（非 zh 一律 en，与全站口径一致）。 */
export function seasonalText(text: SeasonalI18nText, locale: string): string {
  return locale === "zh" ? text.zh : text.en;
}
