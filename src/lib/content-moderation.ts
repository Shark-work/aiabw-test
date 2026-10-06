/**
 * Phase 8 · 敏感词内容审核（计划 9.3：违规内容 400 拦截 + 用户举报 + admin 审核队列）。
 *
 * 方案：本地词表 + 归一化匹配（零成本 / 零延迟 / 可契约测试）；后续可叠加
 * 阿里云内容安全 API（接口不变，仅替换 moderateText 实现）。
 *
 * 词表口径：news 采集层 BLOCKED_KEYWORDS 扩展为全站统一一份（避免两处词表漂移）。
 * 选词原则：**只收高置信违规词**（违法/色情/诈骗/赌博/政治敏感）——
 * 陪伴类产品刻意不收「自杀/自残」等情绪词（用户倾诉应被宠物温柔回应而非 400），
 * 也不收泛暴力词（"杀人"会误伤狼人杀等正常语境）。误伤成本 > 漏放成本。
 */
export const SENSITIVE_WORDS: string[] = [
  // 时政敏感（沿用 news 采集层口径）
  "政治", "领导人", "选举", "抗议", "示威",
  // 违法 / 有害
  "赌博", "博彩", "诈骗", "传销", "毒品", "冰毒", "枪支", "走私", "洗钱",
  // 色情 / 成人
  "色情", "裸体", "约炮", "援交",
  // 辱骂 / 仇恨（仅高置信攻击词）
  "傻逼", "nmsl",
];

export interface ModerationResult {
  ok: boolean;
  /** 命中的敏感词（仅服务端日志/举报参考，不回传给用户，避免规避学习）。 */
  hits: string[];
}

/** 空白 + 零宽字符族（U+200B-U+200D、U+FEFF）——fromCharCode 构造避免源码藏隐形字符。 */
const INVISIBLE_RE = new RegExp(
  "[\\s" +
    String.fromCharCode(0x200b) +
    "-" +
    String.fromCharCode(0x200d) +
    String.fromCharCode(0xfeff) +
    "]+",
  "g",
);

/** 归一化：小写 + 去除所有空白/零宽字符（防「赌 博」「赌​博」变体绕过）。 */
function normalize(text: string): string {
  return text.toLowerCase().replace(INVISIBLE_RE, "");
}

/** 审核单段文本：ok=false 时 hits 为命中词表。空文本视为通过。 */
export function moderateText(text: string): ModerationResult {
  if (!text || !text.trim()) return { ok: true, hits: [] };
  const n = normalize(text);
  const hits = SENSITIVE_WORDS.filter((w) => n.includes(w.toLowerCase()));
  return { ok: hits.length === 0, hits };
}

/** 过滤模式：返回不含敏感词的条目（AI 输出多候选场景，如起名建议）。 */
export function filterClean<T>(items: T[], getText: (item: T) => string): T[] {
  return items.filter((it) => moderateText(getText(it)).ok);
}
