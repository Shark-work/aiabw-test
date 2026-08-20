/**
 * 宠物字典（Pet Dictionary）渲染助手：
 *  - renderPetDescription(): 用字典物种的默认介绍模板 + 宠物 Traits 生成默认介绍。
 *    例：字典=雪豹、traits.personality=勇敢 →
 *      “这是一只来自高山的勇敢雪豹，眼神中透着不羁。”
 *  - 展示规则：custom_description 有值 → 显示用户自定义；为 NULL → 显示这里生成的默认介绍。
 */

export type DictionarySpecies = {
  id: string;
  nameZh: string;
  nameEn: string;
  category: string;
  habitat: string | null;
  defaultDescriptionZh: string;
  defaultDescriptionEn: string;
};

export type PetTraits = {
  element?: string;
  rarity?: string;
  personality?: string;
  [k: string]: unknown;
};

/** traits.personality 中文词（默认介绍模板 {trait} 占位符的填充值）。 */
function traitWord(traits?: PetTraits | null): string {
  return traits?.personality || "独特";
}

/** 按 locale 渲染默认介绍；无法解析时回退中文模板。 */
export function renderPetDescription(
  species: Pick<DictionarySpecies, "defaultDescriptionZh" | "defaultDescriptionEn">,
  traits?: PetTraits | null,
  locale?: string,
): string {
  const template =
    locale === "en"
      ? species.defaultDescriptionEn
      : species.defaultDescriptionZh;
  const word = locale === "en" ? translateTrait(traits?.personality) : traitWord(traits);
  return template.replace("{trait}", word);
}

/** 中文特质 → 英文 trait 词（用于 EN 默认介绍）。 */
function translateTrait(zh?: string): string {
  const map: Record<string, string> = {
    勇敢: "brave",
    温柔: "gentle",
    机灵: "clever",
    高傲: "proud",
    慵懒: "lazy",
  };
  return map[zh || ""] || "unique";
}
