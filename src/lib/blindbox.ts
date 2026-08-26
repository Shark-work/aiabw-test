// 盲盒概率算法（纯函数，无 DB / 无 Next 依赖，便于单元测试）：
//  - weightedPick：按概率映射加权随机，决定本次抽中的稀有度；
//  - randomDna：为盲盒宠物生成随机元素/性格（铸造 DNA 用）。
// 概率无需严格归一（内部按总和归一化），便于运营直接写 {common:70, rare:20, ...}。

export type RarityProbabilities = Record<string, number>;

const RARITY_FALLBACK = "common";

/**
 * 加权随机抽取一个稀有度。
 *  - probabilities 为空/全 0 → 返回 "common"（兜底）；
 *  - 内部自动归一化（总和可不为 1）；
 *  - 支持注入随机源（测试可 mock）。
 */
export function weightedPick(
  probabilities: RarityProbabilities | null | undefined,
  rand: () => number = Math.random,
): string {
  const entries = Object.entries(probabilities ?? {});
  const valid = entries.filter(
    ([, p]) => typeof p === "number" && Number.isFinite(p) && p > 0,
  );
  if (valid.length === 0) return RARITY_FALLBACK;

  const total = valid.reduce((s, [, p]) => s + p, 0);
  if (total <= 0) return RARITY_FALLBACK;

  let r = rand() * total;
  for (const [key, p] of valid) {
    r -= p;
    if (r < 0) return key;
  }
  // 浮点误差兜底
  return valid[valid.length - 1][0];
}

/** 盲盒宠物随机 DNA（元素 / 性格）。 */
export function randomDna(
  rand: () => number = Math.random,
): { element: string; personality: string } {
  const elements = ["fire", "water", "earth", "air"];
  const personalities = ["温柔", "勇敢", "机灵", "慵懒", "活泼", "沉稳"];
  return {
    element: elements[Math.floor(rand() * elements.length)],
    personality: personalities[Math.floor(rand() * personalities.length)],
  };
}
