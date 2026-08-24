/**
 * 数字人 Agent - 心理学内容生成引擎
 *
 * 发帖前先读取网站最新更新（git log / 更新记录），套用心理学框架生成文案：
 *   - 小红书：痛点共鸣 + 情绪价值 + 治愈系文案
 *   - X：引发好奇 + 深度思考 + 互动提问
 *
 * LLM 调用失败时降级为模板兜底文案（保证工作流不中断）。
 */
import { generateText } from "ai";

import { getModel } from "./get-model";

export type SocialPlatform = "x" | "xhs";

export type PsychologyContext = {
  platform: SocialPlatform;
  updates: string;
  memories: string;
};

/** 小红书文案框架：痛点共鸣 + 情绪价值 + 治愈系 */
export function buildXhsPrompt(ctx: PsychologyContext): string {
  return `你是「艾比世界」（AIABW，AI 虚拟宠物陪伴产品）的运营数字人，负责在小红书账号自动营业。
你必须用「心理学文案框架」生成内容，框架要求：
1. 痛点共鸣：开头 1-2 句戳中目标用户的真实情绪痛点（如孤独、焦虑、疲惫、需要陪伴、怕被 AI 替代），让用户觉得“这说的就是我”。
2. 情绪价值：把网站本次更新包装成“治愈/被理解/被陪伴”的体验，强调情感收益而非功能参数。
3. 治愈系文案：整体语气温柔治愈、有画面感，适当使用 emoji（🦊🌙☕），结尾给一个暖心的行动号召（如“今晚，让艾比陪你聊聊天”）。
4. 结构：标题 + 正文分段 + 3-5 个相关话题标签（如 #艾比世界 #AI陪伴 #治愈系 #情绪价值）。

参考信息：
—— 网站最近更新 ——
${ctx.updates || "(无近期更新，请聚焦产品定位)"}
—— 数字人已有记忆 ——
${ctx.memories || "(暂无记忆)"}

只输出最终发布的小红书正文（不含多余解释），不超过 1000 字。`;
}

/** X (Twitter) 文案框架：引发好奇 + 深度思考 + 互动提问 */
export function buildXPrompt(ctx: PsychologyContext): string {
  return `You are the digital human of "AIABW" (an AI virtual pet companion product) operating the X/Twitter account automatically.
Generate ONE engaging post using this psychology copywriting framework:
1. Curiosity hook: open with a bold/intriguing question or statement that makes people want to read more.
2. Deep thought: connect this week's product updates to a meaningful idea (companionship, loneliness, AI & human connection, productivity & mental health).
3. Interactive question: end with a question that invites replies (e.g. "What do you think?").
4. Keep it under 280 characters, plain text, minimal emoji, no hashtags spam (at most 1-2).

Context:
— Recent website updates —
${ctx.updates || "(no recent updates; focus on the product vision)"}
— Agent memories —
${ctx.memories || "(no memories yet)"}

Output only the final tweet text.`;
}

/** 按平台分发提示词模板。 */
export function buildPlatformPrompt(platform: SocialPlatform, ctx: PsychologyContext): string {
  return platform === "xhs" ? buildXhsPrompt(ctx) : buildXPrompt(ctx);
}

/** 模板兜底文案（LLM 不可用时保证工作流不中断）。 */
export function fallbackCopy(platform: SocialPlatform, updates: string): string {
  const head = (updates || "艾比世界正在变得更好").trim().slice(0, 120);
  if (platform === "xhs") {
    return `深夜还在刷手机的你，是不是也觉得心里空落落的？🦊
其实每个人都需要一个“随时都在”的陪伴。
艾比世界本周又有新进展啦：${head}。
我们相信，治愈感来自有人懂你、陪你。
今晚，让艾比陪你聊聊心里话吧🌙
#艾比世界 #AI陪伴 #治愈系 #情绪价值`;
  }
  return `AIABW keeps getting better: ${head}
AI pets are not replacements for human connection — they're training wheels for it.
What's one thing you wish an AI companion could understand about you?`;
}

/** 截断到目标字符数（尽量在换行/空格处断）。 */
export function trimToChar(text: string, max: number): string {
  const t = (text ?? "").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const nl = cut.lastIndexOf("\n");
  const sp = cut.lastIndexOf(" ");
  const at = Math.max(nl, sp);
  return (at > max * 0.6 ? cut.slice(0, at) : cut).trim();
}

const MAX_CHARS: Record<SocialPlatform, number> = { x: 280, xhs: 1000 };

/** 生成一条平台帖子；LLM 失败自动降级为模板兜底，绝不抛异常。 */
export async function generateSocialCopy(
  platform: SocialPlatform,
  updates: string,
  memories: string,
): Promise<{ text: string; source: "llm" | "fallback" }> {
  const maxChars = MAX_CHARS[platform] ?? 1000;
  const ctx: PsychologyContext = { platform, updates: updates || "", memories: memories || "" };
  try {
    const { text } = await generateText({
      model: getModel(),
      system: buildPlatformPrompt(platform, ctx),
      prompt: `请结合上面的更新与框架，生成一条不超过 ${maxChars} 字符的 ${platform === "xhs" ? "小红书" : "X"} 帖子。`,
      temperature: 0.9,
      maxOutputTokens: 700,
    });
    const trimmed = trimToChar(text, maxChars);
    if (trimmed) return { text: trimmed, source: "llm" };
    return { text: fallbackCopy(platform, updates), source: "fallback" };
  } catch (err) {
    console.error("[agent-psychology] LLM generation failed, using fallback:", err);
    return { text: fallbackCopy(platform, updates), source: "fallback" };
  }
}
