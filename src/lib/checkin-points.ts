// 每日签到积分 · 加权随机（1–10，纯逻辑模块：API 路由 / 单元测试共用）。
// 需求（2026-09）：固定 +10 改为随机 1–10，数值越大概率越低，形成递减分布：
//   1-3   高概率 ≈50%（每日稳定收益）
//   4-6   中概率 ≈30%
//   7-9   低概率 ≈15%
//   10    极低概率 ≈5%（"抽到大额"的惊喜感，养成经济节奏）
// 实现：先按档位权重 roll 档位，再在档内均匀随机一个整数
// （与 rollCheckinItem 同一模式：可注入随机数，便于确定性单测）。

export type CheckinPointsTier = {
  /** 档位最小积分（含） */
  min: number;
  /** 档位最大积分（含） */
  max: number;
  /** 档位命中概率（所有档位权重之和 = 1） */
  weight: number;
};

/** 签到积分档位权重（1-3: 50% / 4-6: 30% / 7-9: 15% / 10: 5%，需求红线） */
export const CHECKIN_POINTS_TIERS: readonly CheckinPointsTier[] = [
  { min: 1, max: 3, weight: 0.5 },
  { min: 4, max: 6, weight: 0.3 },
  { min: 7, max: 9, weight: 0.15 },
  { min: 10, max: 10, weight: 0.05 },
] as const;

/** 单次签到积分下限（未含月卡倍率） */
export const CHECKIN_POINTS_MIN = 1;
/** 单次签到积分上限（未含月卡倍率） */
export const CHECKIN_POINTS_MAX = 10;

/**
 * 加权随机签到积分：先按权重 roll 档位，再档内均匀随机。
 * 累积比较用整数百分比（50/80/95/100）而非浮点累加，
 * 避免 0.5+0.3+0.15=0.9500000000000001 这类误差让边界值落入错误档位。
 * @param rand 档位 roll 用随机数 [0, 1)，默认 Math.random()
 * @param pickRand 档内均匀挑选用随机数 [0, 1)，默认 Math.random()
 * @returns 1–10 的整数积分
 */
export function rollCheckinPoints(
  rand: number = Math.random(),
  pickRand: number = Math.random(),
): number {
  const r = rand * 100;
  let accPercent = 0;
  for (const tier of CHECKIN_POINTS_TIERS) {
    accPercent += Math.round(tier.weight * 100);
    if (r < accPercent) {
      const span = tier.max - tier.min + 1;
      return tier.min + Math.min(span - 1, Math.floor(pickRand * span));
    }
  }
  // 兜底（rand < 1 且权重总和为 1 时不可达）
  return CHECKIN_POINTS_TIERS[CHECKIN_POINTS_TIERS.length - 1].max;
}
