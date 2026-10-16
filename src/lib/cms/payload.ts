/**
 * Payload Local API 单例（服务端专用模块，禁止客户端 import——与 characters.ts 同红线）。
 *
 * 可用性判定（loader 降级链的第一道闸）：
 *  1. PAYLOAD_CMS_DISABLE=1 → 全局熔断（运维应急开关）；
 *  2. 有 TURSO_DATABASE_URL → 启用（生产正典：Turso libSQL）；
 *  3. 无 TURSO_* 且非生产 → 启用（本地开发缺省 file:payload.db，与 payload.config.ts 同口径）；
 *  4. 生产无 TURSO_* → 禁用（serverless 无本地盘，直接走降级链，不触碰 DB）。
 *
 * 单例语义：getPayload({ config }) 进程内缓存一次（RSC/路由并发共享）；
 * 初始化失败（如 Turso 不可达）不缓存 rejected promise——下次调用重试，
 * 避免一次网络抖动把整个进程钉死在降级链上。
 */
import configPromise from "@payload-config";
import { getPayload, type Payload } from "payload";

let cached: Promise<Payload> | null = null;

/** CMS 是否可用（false = loader 直接走降级链，零 DB 触碰）。 */
export function cmsEnabled(): boolean {
  if (process.env.PAYLOAD_CMS_DISABLE === "1") return false;
  if (process.env.TURSO_DATABASE_URL) return true;
  return process.env.NODE_ENV !== "production";
}

/** 取 Payload Local API 实例（调用前必须先经 cmsEnabled() 判定）。 */
export function getCms(): Promise<Payload> {
  if (!cached) {
    const p = getPayload({ config: configPromise });
    p.catch(() => {
      if (cached === p) cached = null; // 初始化失败 → 解除缓存，允许下次重试
    });
    cached = p;
  }
  return cached;
}
