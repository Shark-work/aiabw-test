/**
 * 积分充值档位表（服务端唯一定价来源）。
 *
 * 安全约束：客户端只传「档位积分值」，价格与积分一律以此表为准，
 * 拒绝一切客户端提交金额（防改价：1 分钱买 5000 积分）。
 * 定价梯度：量大优惠（每元约 16.7 → 25 积分）。
 *
 * 改动本表 = 价格变更，无需 bump SCHEMA_VERSION（纯代码常量）。
 */
export type PointsPack = { points: number; priceCny: number };

export const POINTS_PACKS: readonly PointsPack[] = [
  { points: 100, priceCny: 6 },
  { points: 500, priceCny: 25 },
  { points: 1000, priceCny: 45 },
  { points: 5000, priceCny: 200 },
] as const;

/** 按档位积分值查档；未命中（非法档位）返回 undefined。 */
export function findPointsPack(points: number): PointsPack | undefined {
  return POINTS_PACKS.find((p) => p.points === points);
}
