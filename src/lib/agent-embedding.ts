/**
 * 数字人 Agent 记忆 - 纯逻辑层（无 DB / 无 Next 依赖，便于单元测试）
 *
 * embedding 方案：字符级 n-gram 哈希向量（确定性、离线可算、无需外部 API）。
 *   - 分词：CJK 单字 + 拉丁单词 + 相邻二元组；
 *   - 每个 token 哈希到固定维度的计数向量，L2 归一化；
 *   - 相似度：余弦相似度。
 * 语义去重：写入新记忆前与现有记忆计算相似度，>= 阈值则“合并/更新”，不新增。
 */

export type MemoryType = "fact" | "skill" | "user_preference";

/** 向量维度（Neon double precision[] 存储） */
export const EMBEDDING_DIM = 128;

/** 语义去重阈值：相似度 > 90% 视为重复（合并或更新，不新增） */
export const DEDUP_SIMILARITY_THRESHOLD = 0.9;

const VALID_MEMORY_TYPES = new Set(["fact", "skill", "user_preference"]);

export function isMemoryType(v: unknown): v is MemoryType {
  return typeof v === "string" && VALID_MEMORY_TYPES.has(v);
}

/** 归一化文本：小写、去标点与空白、保留中英文与数字。 */
export function normalizeText(text: string): string {
  return (text ?? "")
    .toLowerCase()
    .replace(/[\s，。、！？；：,.!?;:"'“”‘’（）()【】\[\]《》<>#@&*\-_/\\=+~`|]+/g, "");
}

/** 将文本切成 token：拉丁单词 / CJK 单字 / 相邻二元组。 */
export function tokenize(text: string): string[] {
  const lower = (text ?? "").toLowerCase();
  const tokens: string[] = [];
  // 拉丁单词（保留词边界，先于空白归一化提取）
  for (const word of lower.match(/[a-z0-9]+/g) ?? []) {
    tokens.push(`w:${word}`);
  }
  // CJK 单字 + 相邻二元组（含中英混排边界）
  const t = normalizeText(text);
  for (const ch of t) {
    if (/[a-z0-9]/.test(ch)) continue; // 拉丁词已处理，避免重复
    tokens.push(`c:${ch}`);
  }
  for (let i = 0; i < t.length - 1; i++) {
    tokens.push(`b:${t.slice(i, i + 2)}`);
  }
  return tokens;
}

/** 把 token 集合哈希为固定维度的 L2 归一化向量。 */
export function embed(text: string): number[] {
  const vec = new Array<number>(EMBEDDING_DIM).fill(0);
  for (const token of tokenize(text)) {
    let h = 0;
    for (let j = 0; j < token.length; j++) {
      h = (h * 31 + token.charCodeAt(j)) >>> 0;
    }
    vec[h % EMBEDDING_DIM] += 1;
  }
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return vec.map((v) => v / norm);
}

/** 余弦相似度：两向量均为 embed() 输出的 L2 归一化向量。 */
export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < len; i++) dot += a[i] * b[i];
  return dot;
}

/** 语义去重判定：相似度 >= 阈值视为重复。 */
export function isDuplicate(
  embeddingA: number[],
  embeddingB: number[],
  threshold: number = DEDUP_SIMILARITY_THRESHOLD,
): boolean {
  if (!Array.isArray(embeddingA) || !Array.isArray(embeddingB) || embeddingA.length === 0 || embeddingB.length === 0) {
    return false;
  }
  return cosineSimilarity(embeddingA, embeddingB) >= threshold;
}
