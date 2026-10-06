/**
 * Phase 8 · AI 响应缓存层（计划 9.2「缓存热门回复：相同 prompt 缓存 LLM 响应，预期节省 30-50%」）。
 *
 * 设计：
 *  - 存储：DB 表 ai_response_cache（drizzle/0035）——Serverless 实例间共享，
 *    不受冷启动影响（内存缓存在 Vercel 多实例下命中率趋零）；
 *  - key：scope + ':' + sha256(归一化 prompt) 前 32 hex——scope 区分业务
 *    （name-suggestions 等），归一化（trim+压缩空白）避免空白差异造成缓存碎片；
 *  - 过期：expires_at 惰性过期——读时判定，命中才 UPDATE hits（命中率监控数据源），
 *    过期行读时顺手 DELETE；另有 1% 概率触发全表过期清理，避免死行堆积；
 *  - 容错：所有 DB 异常仅 console.error 并视为 miss/跳过——缓存故障绝不影响主流程；
 *  - 适用面：非流式、prompt 离散度低的 generateText 调用（聊天 streamText 因
 *    system prompt 千人千面 + 工具调用，不缓存）。
 */
import { createHash } from "node:crypto";

import { pool } from "@/db/client";

/** 归一化 prompt（压缩连续空白）后取 sha256 前 32 hex，加 scope 前缀。 */
export function aiCacheKey(scope: string, prompt: string): string {
  const normalized = prompt.trim().replace(/\s+/g, " ");
  const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 32);
  return `${scope}:${hash}`;
}

/** 读取缓存：命中且未过期 → hits+1 并返回 response；miss/过期/异常 → null。 */
export async function getCachedAiResponse(
  scope: string,
  prompt: string,
): Promise<string | null> {
  const key = aiCacheKey(scope, prompt);
  try {
    const { rows } = await pool.query(
      `UPDATE "ai_response_cache" SET hits = hits + 1
        WHERE cache_key = $1 AND expires_at > now()
        RETURNING response`,
      [key],
    );
    const hit = rows[0]?.response as string | undefined;
    if (hit != null) {
      // 1% 概率惰性全表清理过期行（避免定时任务；量级小，可忽略成本）
      if (Math.random() < 0.01) {
        void pool
          .query(`DELETE FROM "ai_response_cache" WHERE expires_at <= now()`)
          .catch(() => {});
      }
      return hit;
    }
    // 顺手清掉同 key 过期行，让后续写入走干净的 UPSERT
    await pool.query(
      `DELETE FROM "ai_response_cache" WHERE cache_key = $1 AND expires_at <= now()`,
      [key],
    );
    return null;
  } catch (err) {
    console.error("[ai-cache] read failed (treated as miss):", err);
    return null;
  }
}

/** 写入缓存：UPSERT（同 key 覆盖并重置 hits/过期窗）；异常仅记日志。 */
export async function setCachedAiResponse(
  scope: string,
  prompt: string,
  response: string,
  ttlDays = 7,
): Promise<void> {
  if (!response) return;
  const key = aiCacheKey(scope, prompt);
  try {
    await pool.query(
      `INSERT INTO "ai_response_cache" (cache_key, scope, response, expires_at)
       VALUES ($1, $2, $3, now() + ($4::int * interval '1 day'))
       ON CONFLICT (cache_key) DO UPDATE SET
         response = EXCLUDED.response,
         hits = 0,
         created_at = now(),
         expires_at = EXCLUDED.expires_at`,
      [key, scope, response, Math.max(1, Math.floor(ttlDays))],
    );
  } catch (err) {
    console.error("[ai-cache] write failed (skipped):", err);
  }
}
