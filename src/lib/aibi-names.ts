// 艾比名映射单源（方案 B：DB 只存现实原型名，艾比名在读路径派生，零迁移）。
// 首批覆盖：稀有度史诗（epic）及以上的字典物种 —— 2026-09-30 生产库口径
// （pet_dictionary ⋈ pets WHERE status='active' AND visible=true，物种最高稀有度 ≥ epic，
//   共 7 个：blue_whale / red_panda / tortoise（legendary）+ cheetah / octopus / penguin / sea_otter（epic））。
// 无映射物种一律回退原型名（petName 快照 / speciesName），与 petDisplayName 兜底语义一致；
// 未来扩充物种只需在此追加条目（tests/aibi-names.test.mjs 锁定完整性）。
import { RARITY_WEIGHT, rarityWeight } from "@/lib/species-group";

/** speciesId → 双语艾比名（角色名，风格参照老三宠：抱抱狐 / Huggy Fox）。 */
export const AIBI_NAMES = {
  blue_whale: { zh: "泡泡", en: "Bubbles" }, // 蓝鲸：气泡网捕食
  red_panda: { zh: "栗栗", en: "Rusty" }, // 小熊猫：栗红毛色
  tortoise: { zh: "慢慢", en: "Shelly" }, // 陆龟：龟速 / 龟壳
  cheetah: { zh: "闪闪", en: "Dash" }, // 猎豹：疾驰如闪
  octopus: { zh: "爪爪", en: "Inky" }, // 章鱼：八爪 / 喷墨
  penguin: { zh: "墩墩", en: "Waddles" }, // 企鹅：圆墩摇摆
  sea_otter: { zh: "漂漂", en: "Pebble" }, // 海獭：仰面漂浮 / 胸口藏石
} as const;

export type AibiSpeciesId = keyof typeof AIBI_NAMES;

/** 物种在映射白名单内 → 本地化艾比名；否则 null（调用方回退原型名）。 */
export function aibiNameFor(
  speciesId: string | null | undefined,
  locale: string,
): string | null {
  if (!speciesId) return null;
  const entry = (AIBI_NAMES as Record<string, { zh: string; en: string }>)[speciesId];
  if (!entry) return null;
  return locale === "en" ? entry.en : entry.zh;
}

/** 展示门槛：艾比名仅对史诗（epic）及以上稀有度实例展示，普通版本仍显示原型名。 */
export const AIBI_RARITY_MIN_WEIGHT = RARITY_WEIGHT.epic; // 4

/** 稀有度是否达到艾比名展示门槛（未知/缺失稀有度 → false，保守回退原型名）。 */
export function aibiNameEligible(rarity?: string | null): boolean {
  return rarityWeight(rarity) >= AIBI_RARITY_MIN_WEIGHT;
}
