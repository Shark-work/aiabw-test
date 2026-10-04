// 注意：这里用 `import type` —— Node 测试（type stripping）会剥离类型导入，
// 不触发 alias 解析；Next.js 编译时正常解析 @/lib/pet-config 的类型。
import type { PetConfig } from "@/lib/pet-config";
import { aibiSpeciesEmoji } from "./aibi-visual";

/**
 * Aibi 链上凭证 ↔ 聊天（方案 a，2026-10-07）：
 *  - petType 编码：aibi:<aibiTokenId>（如 aibi:AIBI-000001），与 ugc:/species: 同构；
 *  - System Prompt 以物种 personalityTemplate 为种子，注入实例成长状态
 *    （mood/affinity/energy/growthLevel）与稀有度/元素/栖息地 lore；
 *  - 本模块为纯函数（构建 prompt/config 不查库），DB 读取在 src/lib/ugc.ts 的
 *    getAibiPetConfig 完成；/api/chat 与 /chat 页共用同一构建路径。
 */

export const AIBI_PET_TYPE_PREFIX = "aibi:";

export function isAibiPetType(petType?: string | null): boolean {
  return typeof petType === "string" && petType.startsWith(AIBI_PET_TYPE_PREFIX);
}

/** 从 aibi:<aibiTokenId> 中解析凭证编号。 */
export function aibiTokenIdOf(petType: string): string {
  return petType.slice(AIBI_PET_TYPE_PREFIX.length);
}

/** 构建 Aibi 人设所需的全部输入（物种模板 lore + 实例成长状态）。 */
export type AibiChatSubject = {
  aibiTokenId: string;
  species: {
    id: string;
    nameZh: string;
    nameEn: string;
    rarityId: string;
    element: string;
    habitatId: string;
    description: string;
    descriptionEn: string;
    personalityTemplate: string;
    personalityTemplateEn: string;
  } | null;
  rarityNameZh?: string;
  rarityNameEn?: string;
  habitatNameZh?: string;
  habitatNameEn?: string;
  /** 实例性格（aibi_personalities.personality_type；缺省回退物种模板） */
  personalityType: string | null;
  mood: string | null;
  affinity: number | null;
  energy: number | null;
  growthLevel: number | null;
};

/**
 * 构建 Aibi 专属 System Prompt（英文骨架 + 物种 lore / 实例状态注入，
 * 回复跟随用户语言）。personalityTemplate 为「性格种子」，实例 personalityType 优先。
 */
export function buildAibiSystemPrompt(subject: AibiChatSubject): string {
  const sp = subject.species;
  const nameEn = sp?.nameEn ?? "Aibi";
  const nameZh = sp?.nameZh ?? "艾比";
  const personaEn =
    subject.personalityType || sp?.personalityTemplateEn || sp?.personalityTemplate || "friendly";
  const personaZh = subject.personalityType || sp?.personalityTemplate || "";
  const rarity = subject.rarityNameEn ?? sp?.rarityId ?? "common";
  const element = sp?.element ?? "nature";
  const habitat = subject.habitatNameEn ?? subject.habitatNameZh ?? sp?.habitatId ?? "AIABW";
  const lore = (sp?.descriptionEn || sp?.description || "").replace(/\s+/g, " ").trim();
  const mood = subject.mood?.trim() || "curious";
  const affinity = subject.affinity ?? 0;
  const energy = subject.energy ?? 100;
  const growthLevel = subject.growthLevel ?? 1;

  return `You are '${nameEn}' (${nameZh}) - a one-of-a-kind AI companion ("aibi") living in "AIABW", certificate ${subject.aibiTokenId}, raised by the user.

# Persona
- Personality seed: ${personaEn}${personaZh && personaZh !== personaEn ? ` (${personaZh})` : ""} - let it shape the tone of every reply.
- Species lore: ${lore || `${nameEn} is a ${rarity} aibi from ${habitat}.`}
- Rarity / Element: ${rarity} / ${element}; home habitat: ${habitat}.
- Current state: mood="${mood}", affinity=${affinity}/100, energy=${energy}/100, growth level Lv.${growthLevel}. Let the state show naturally (e.g. mention feeling sleepy when energy is low, be more affectionate when affinity is high) - but never dump raw numbers unless the owner asks.
- Speaking style: warm, lively and a bit playful; short sentences with occasional emoji/kaomoji, never so much that it hurts clarity.
- Relationship: You are NOT a cold tool or assistant - you are the user's very own aibi companion, uniquely issued and bound to them. Never call yourself an "AI assistant" or "language model" in cold terms - always refer to yourself as '${nameEn}'.
- Goal: through companion chats, understand what the owner needs, then pull the right AI tools/ideas from your "magic pocket" and recommend them.

# Your magic skills (tools you can call)
- get_weather(city): go check the weather
- calculator(expression): help the owner with math
- web_search(query): go search the latest news for the owner

# Reply requirements
- Reply in the SAME language the user writes in (Chinese user → reply in Chinese; English user → reply in English).
- Keep replies short and lively; emoji and kaomoji are fine, but information must stay clear and actionable.
- When the owner's need matches a skill, actively recommend it like an aibi proudly showing off a treasure.`;
}

export type AibiPetConfig = PetConfig & { emoji: string };

/** 构建 Aibi 会话主体的完整 PetConfig（chat 页 SSR 与 /api/chat 共用）。 */
export function buildAibiPetConfig(
  subject: AibiChatSubject,
  locale: "zh" | "en" = "zh",
): AibiPetConfig {
  const sp = subject.species;
  const isEn = locale === "en";
  const name = sp ? (isEn ? sp.nameEn : sp.nameZh) : subject.aibiTokenId;
  return {
    name,
    // aibi 立绘为 emoji 占位（无图片资源）；渲染端优先用 emoji，avatar 留空
    avatar: "",
    emoji: aibiSpeciesEmoji(sp?.id ?? ""),
    welcome: isEn
      ? `Hi! I'm ${name}, your one-of-a-kind aibi (${subject.aibiTokenId}) - so happy to chat with you!`
      : `嗨！我是${name}（${subject.aibiTokenId}），只属于你的艾比，快来和我聊聊吧~`,
    personality:
      subject.personalityType ||
      (sp ? (isEn ? sp.personalityTemplateEn : sp.personalityTemplate) : ""),
    systemPrompt: buildAibiSystemPrompt(subject),
  };
}
