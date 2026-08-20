/**
 * 宠物“用户心理学”工具库：
 *  - 损失厌恶：petIsStale() —— 超过 3 天未互动 → 前端灰暗滤镜 + 💧/🍖 状态；
 *  - 稀缺性：getRarityMeta() —— 稀有度徽章文案与配色；
 *  - 禀赋效应：formatAdoptionImprint() —— “由你于 X 孕育”专属印记；
 *             formatGenealogy() —— 族谱（父母 ID）。
 */

/** 损失厌恶阈值：超过 3 天未互动视为“冷落”。 */
export const PET_STALE_DAYS = 3;
export const PET_STALE_MS = PET_STALE_DAYS * 24 * 3600 * 1000;

export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

export type RarityMeta = {
  labelZh: string;
  labelEn: string;
  emoji: string;
  /** tailwind 徽章样式 */
  badgeClass: string;
  /** 高光诞生动画的配色 */
  glow: string;
};

/** 稀有度 → 徽章/动画元数据（稀缺性 + 炫耀心理）。 */
export function getRarityMeta(rarity?: string | null): RarityMeta {
  switch (rarity as Rarity) {
    case "legendary":
      return {
        labelZh: "传说",
        labelEn: "Legendary",
        emoji: "👑",
        badgeClass: "bg-gradient-to-r from-amber-400 to-yellow-500 text-white",
        glow: "from-amber-300/70 via-yellow-400/60 to-orange-300/70",
      };
    case "epic":
      return {
        labelZh: "史诗",
        labelEn: "Epic",
        emoji: "🌟",
        badgeClass: "bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white",
        glow: "from-violet-400/70 via-fuchsia-400/60 to-pink-300/70",
      };
    case "rare":
      return {
        labelZh: "稀有",
        labelEn: "Rare",
        emoji: "💎",
        badgeClass: "bg-gradient-to-r from-sky-500 to-blue-500 text-white",
        glow: "from-sky-300/70 via-blue-400/60 to-cyan-300/70",
      };
    case "uncommon":
      return {
        labelZh: "不凡",
        labelEn: "Uncommon",
        emoji: "🟢",
        badgeClass: "bg-emerald-500 text-white",
        glow: "from-emerald-300/60 to-teal-300/60",
      };
    default:
      return {
        labelZh: "常见",
        labelEn: "Common",
        emoji: "⚪",
        badgeClass: "bg-zinc-400 text-white",
        glow: "from-zinc-300/40 to-zinc-200/40",
      };
  }
}

/** 合成出该稀有度时是否触发全屏“高光诞生动画”。 */
export function shouldCelebrate(rarity?: string | null): boolean {
  return rarity === "rare" || rarity === "epic" || rarity === "legendary";
}

/**
 * 损失厌恶：宠物是否处于“被冷落”状态。
 * 基线 = lastInteractionTime ?? adoptedAt；超过 PET_STALE_DAYS 即返回 stale。
 * 返回 { stale, daysSince, level }：
 *   level: "hungry" (3~7 天 → 🍖 饿了) | "lonely" (>7 天 → 💧 想你了)
 */
export function petStaleState(
  lastInteractionTime: string | null,
  adoptedAt: string | null,
  now = Date.now(),
): { stale: boolean; daysSince: number; level: "hungry" | "lonely" | null } {
  const baseline = lastInteractionTime ?? adoptedAt;
  if (!baseline) return { stale: false, daysSince: 0, level: null };
  const t = new Date(baseline).getTime();
  if (Number.isNaN(t)) return { stale: false, daysSince: 0, level: null };
  const daysSince = Math.floor((now - t) / (24 * 3600 * 1000));
  if (daysSince < PET_STALE_DAYS) return { stale: false, daysSince, level: null };
  return { stale: true, daysSince, level: daysSince > 7 ? "lonely" : "hungry" };
}

/** 禀赋效应：专属印记 “由你于 2026-05-20 孕育”。 */
export function formatAdoptionImprint(
  adoptedAt: string | null,
  locale?: string,
): string {
  if (!adoptedAt) return "";
  const d = new Date(adoptedAt);
  if (Number.isNaN(d.getTime())) return "";
  const dateStr = d.toLocaleDateString(locale === "en" ? "en-US" : "zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return locale === "en" ? `Born for you on ${dateStr}` : `由你于 ${dateStr} 孕育`;
}

/** 禀赋效应：族谱文案，如 “父母 #A1B2C3 × #D4E5F6”；无父母返回 null。 */
export function formatGenealogy(parentIds: unknown): string | null {
  if (!Array.isArray(parentIds) || parentIds.length === 0) return null;
  const ids = parentIds.slice(0, 2).map((x) => String(x));
  if (ids.length === 1) return `父系 ${ids[0]}`;
  return `父母 ${ids[0]} × ${ids[1]}`;
}
