// 智能上下文压缩（Token 降本核心）：
// 当对话轮数超过阈值时，把较早的轮次归档为一条「语义摘要」（规则化生成，零 Token），
// 仅保留最近若干轮原始对话，避免完整历史原封不动发给模型。
//
// 摘要采用「规则化语义总结」而非调用 AI 生成：
//  - 从早期用户消息中提取高频话题词（中文 2-4 字片段 + 英文词），
//  - 用模板组织成一句话摘要，信息密度高、可读性好、零额外成本。
import type { UIMessage } from "ai";

export type CompressOptions = {
  /** 超过该用户轮数才触发压缩（默认 12 轮） */
  maxTurns?: number;
  /** 压缩后保留的最近原始轮数（默认 8 轮） */
  keepRecent?: number;
};

export type CompressResult = {
  /** 压缩后的消息（仅最近原始轮次，摘要由调用方注入 system） */
  messages: UIMessage[];
  /** 生成的早期对话摘要；未压缩时为 null */
  summary: string | null;
  /** 被归档压缩的用户轮数 */
  compressedTurns: number;
};

export const DEFAULT_MAX_TURNS = 10;
export const DEFAULT_KEEP_RECENT = 5;

/** 统计消息中的用户轮数（user 消息条数）。 */
export function countUserTurns(messages: UIMessage[]): number {
  return messages.filter((m) => m.role === "user").length;
}

/** 提取一条 UIMessage 的纯文本内容（text parts 拼接）。 */
export function messageText(m: UIMessage): string {
  return (m.parts ?? [])
    .map((p) => (p.type === "text" && typeof p.text === "string" ? p.text : ""))
    .join(" ")
    .trim();
}

const STOP_WORDS_ZH = new Set([
  "一个", "这个", "那个", "什么", "怎么", "为什么", "可以", "我们", "你们",
  "然后", "还是", "还有", "就是", "自己", "没有", "不会", "知道", "觉得",
  "今天", "昨天", "明天", "现在", "时候", "东西", "请问", "一下", "知道吗",
  "你好", "谢谢", "哈哈", "没事",
]);

const STOP_WORDS_EN = new Set([
  "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "do",
  "does", "did", "to", "of", "in", "on", "at", "for", "with", "what",
  "how", "why", "can", "you", "your", "i", "me", "my", "we", "our", "it",
  "this", "that", "have", "has", "will", "not", "no", "yes", "ok", "okay",
  "hello", "hi", "thanks", "please", "just", "really", "about",
]);

/** 从文本中提取话题关键词：中文连续片段（2-4 字）+ 英文单词，按频次取前 N。 */
export function extractTopics(text: string, limit = 4): string[] {
  const freq = new Map<string, number>();
  const bump = (w: string, weight = 1) =>
    freq.set(w, (freq.get(w) ?? 0) + weight);

  // 中文：2-4 字连续汉字片段
  const hanRuns = text.match(/[\u4e00-\u9fa5]{2,}/g) ?? [];
  // 主题倾向：首个中文片段的前 2 字（通常是对话主题，给高权重）
  const firstRun = hanRuns[0];
  if (firstRun && firstRun.length >= 2 && !STOP_WORDS_ZH.has(firstRun.slice(0, 2))) {
    bump(firstRun.slice(0, 2), 10);
  }
  for (const run of hanRuns) {
    // 3-4 字完整窗口（跳步，减少重叠碎片）
    for (let len = 4; len >= 3; len--) {
      for (let i = 0; i + len <= run.length; i += 2) {
        const w = run.slice(i, i + len);
        if (STOP_WORDS_ZH.has(w)) continue;
        bump(w, len === 3 ? 2 : 1);
      }
    }
    // 2 字核心词：跳步提取，避免「金毛/毛寻/寻回」式滑动碎片
    for (let i = 0; i + 2 <= run.length; i += 2) {
      const w = run.slice(i, i + 2);
      if (STOP_WORDS_ZH.has(w)) continue;
      bump(w, 3);
    }
  }
  // 英文：单词（≥3 字符）
  const enWords = text.match(/[a-zA-Z]{3,}/g) ?? [];
  for (const w of enWords) {
    const lw = w.toLowerCase();
    if (STOP_WORDS_EN.has(lw)) continue;
    bump(lw);
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([w]) => w);
}

/** 把早期轮次归档为一条模板化语义摘要（中英双语，零 Token）。 */
export function summarizeEarlyTurns(messages: UIMessage[]): string {
  const userTexts = messages
    .filter((m) => m.role === "user")
    .map(messageText)
    .filter(Boolean);
  const turns = userTexts.length;
  if (turns === 0) {
    return "[早期对话摘要] 早期对话已归档。";
  }
  const topics = extractTopics(userTexts.join("；"));
  const topicLine =
    topics.length > 0
      ? `用户主要询问/提到了：${topics.join("、")}`
      : "用户与宠物进行了多轮互动";
  return (
    `[早期对话归档摘要] 前 ${turns} 轮对话已整理为摘要：${topicLine}，` +
    `宠物均已作出回应。除非用户再次明确提及，请勿重复询问这些已讨论过的话题；` +
    `如需引用细节，请基于本摘要作答。`
  );
}

/**
 * 压缩对话历史：
 *  - 未超过 maxTurns 轮 → 原样返回（summary=null）；
 *  - 超过 → 早期轮次归档为摘要，仅保留最近 keepRecent 轮原始消息。
 */
export function compressConversation(
  messages: UIMessage[],
  opts: CompressOptions = {},
): CompressResult {
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;
  const keepRecent = opts.keepRecent ?? DEFAULT_KEEP_RECENT;
  const userTurns = countUserTurns(messages);
  if (userTurns <= maxTurns) {
    return { messages, summary: null, compressedTurns: 0 };
  }

  const keep = Math.max(1, Math.min(keepRecent, userTurns));
  let splitIndex = 0;
  let seen = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") seen += 1;
    if (seen === keep) {
      splitIndex = i;
      break;
    }
  }
  const early = messages.slice(0, splitIndex);
  const recent = messages.slice(splitIndex);
  return {
    messages: recent,
    summary: summarizeEarlyTurns(early),
    compressedTurns: countUserTurns(early),
  };
}
