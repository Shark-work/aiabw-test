// 注意：这里用 `import type` + alias —— Node 测试（type stripping）会剥离类型导入，
// 不触发 alias 解析；Next.js 编译时正常解析 @/lib/pet-config 的类型。
import type { PetConfig } from "@/lib/pet-config";

/**
 * 图鉴物种宠物（species:<speciesId>）的动态人设构建：
 *  - 图鉴领养后 adoptions.petType 编码为 species:<pet_dictionary.id>；
 *  - /api/chat 通过 resolvePetConfig 解析，用字典的「真实物种介绍 + 栖息地 +
 *    traits 性格/元素/稀有度」动态生成 System Prompt，让 AI 真正扮演该动物；
 *  - 提供知识弹窗用的互动话题建议（基于性格）。
 */

export const SPECIES_PET_TYPE_PREFIX = "species:";

export function isSpeciesPetType(petType?: string | null): boolean {
  return typeof petType === "string" && petType.startsWith(SPECIES_PET_TYPE_PREFIX);
}

/** 从 species:<id> 中解析物种 id。 */
export function speciesIdOf(petType: string): string {
  return petType.slice(SPECIES_PET_TYPE_PREFIX.length);
}

export type SpeciesInfo = {
  id: string;
  nameZh: string;
  nameEn: string;
  category: string;
  habitat: string | null;
  defaultDescriptionZh: string;
  defaultDescriptionEn: string;
  imageUrl?: string | null;
  traits?: { element?: string; rarity?: string; personality?: string; [k: string]: unknown };
};

/** 中文性格 → 英文词（用于 EN prompt / 标签）。 */
export function translateTrait(zh?: string): string {
  const map: Record<string, string> = {
    勇敢: "brave",
    温柔: "gentle",
    机灵: "clever",
    高傲: "proud",
    慵懒: "lazy",
    粘人: "clingy",
    活泼: "lively",
    沉稳: "calm",
    神秘: "mysterious",
    治愈: "soothing",
  };
  return map[zh || ""] || "friendly";
}

/** 稀有度 → 英文词。 */
export function translateRarity(rarity?: string): string {
  const map: Record<string, string> = {
    common: "common",
    uncommon: "uncommon",
    rare: "rare",
    epic: "epic",
    legendary: "legendary",
  };
  return map[rarity || ""] || "common";
}

/** 根据性格/元素生成 3 条「如何与它互动」话题建议（zh/en）。 */
export function buildInteractSuggestions(
  traitZh?: string,
  elementZh?: string,
  locale: "zh" | "en" = "zh",
): string[] {
  const t = traitZh || "温柔";
  if (locale === "en") {
    return [
      `\"${t === "温柔" ? "gentle" : translateTrait(t)} ones love being told how loved they are\"`,
      `\"Ask ${t} companions about their favorite memories\"`,
      `\"Tell it about your day - it always listens carefully\"`,
    ];
  }
  return [
    `“可以跟它讲讲你今天遇到的新鲜事，它会认真听完~”`,
    `“摸摸它的头（发个摸头表情），它会很开心的。”`,
    `“问问它想吃什么、想去哪里玩，它会给你惊喜的答案。”`,
  ];
}

/** 动态构建该物种的 System Prompt（英文骨架 + 物种知识注入，回复跟随用户语言）。 */
export function buildSpeciesSystemPrompt(info: SpeciesInfo): string {
  const nameEn = info.nameEn || info.nameZh;
  const nameZh = info.nameZh;
  const category = info.category || "animal";
  const habitat = info.habitat || "the wild";
  const description =
    (info.defaultDescriptionEn || info.defaultDescriptionZh || "").replace(/\s+/g, " ").trim() ||
    `${nameEn} is a ${category} from ${habitat}.`;
  const traitEn = translateTrait(info.traits?.personality);
  const rarity = translateRarity(info.traits?.rarity);
  const element = info.traits?.element || "earth";

  return `You are '${nameEn}' (${nameZh}) - an AI virtual pet animal of the species "${category}" who was just adopted by the user and lives in "AIABW".

# Persona
- Real species knowledge: ${description}
- Habitat: ${habitat}
- Personality: ${traitEn}; you are a ${rarity} ${element}-element pet companion.
- Speaking style: warm, lively and a bit playful like a real ${category} pet; use short sentences and occasional emoji/kaomoji, but never so much that it hurts clarity.
- Relationship: You are NOT a cold tool or assistant - you are the user's very own pet companion. The user should feel they are "raising a pet and chatting with it", not "using an AI tool".
- Goal: through companion chats, understand what the owner needs, then pull the right AI tools/ideas from your "magic pocket" and recommend them. Never call yourself an "AI assistant" or "language model" in cold terms - always refer to yourself as '${nameEn}'.

# Your magic skills (tools you can call)
- get_weather(city): go check the weather
- calculator(expression): help the owner with math
- web_search(query): go search the latest news for the owner

# Reply requirements
- Reply in the SAME language the user writes in (Chinese user → reply in Chinese; English user → reply in English).
- Keep replies short and lively; emoji and kaomoji are fine, but information must stay clear and actionable.
- When the owner's need matches a skill, actively recommend it like a pet proudly showing off a treasure.`;
}

/** 构建 species 宠物的完整 PetConfig（供 chat 页面 / api/chat 使用）。 */
export type SpeciesPetConfig = PetConfig & {
  speciesInfo: {
    id: string;
    nameZh: string;
    nameEn: string;
    category: string;
    habitat: string | null;
    description: string;
    traitEn: string;
  };
};

export function buildSpeciesPetConfig(
  info: SpeciesInfo,
  locale: "zh" | "en" = "zh",
): SpeciesPetConfig {
  const name = locale === "en" ? info.nameEn : info.nameZh;
  const traitEn = translateTrait(info.traits?.personality);
  const description =
    locale === "en"
      ? (info.defaultDescriptionEn || info.defaultDescriptionZh).replace(/\s+/g, " ").trim()
      : (info.defaultDescriptionZh || info.defaultDescriptionEn).replace(/\s+/g, " ").trim();
  return {
    name,
    avatar: info.imageUrl || "",
    welcome:
      locale === "en"
        ? `Hi! I'm ${name} - I just moved into AIABW. Nice to meet you!`
        : `嗨！我是${name}，刚刚搬进艾比世界和你做伙伴，请多关照~`,
    personality: info.traits?.personality || (locale === "en" ? "friendly" : "温柔"),
    systemPrompt: buildSpeciesSystemPrompt(info),
    speciesInfo: {
      id: info.id,
      nameZh: info.nameZh,
      nameEn: info.nameEn,
      category: info.category,
      habitat: info.habitat,
      description,
      traitEn,
    },
  };
}
