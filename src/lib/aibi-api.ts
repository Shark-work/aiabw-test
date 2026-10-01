/**
 * 艾比平台 Phase 4 · API 统一约定（2026-09-30）
 *  - 成功：HTTP 200 + { data: ... }
 *  - 失败：HTTP 4xx/5xx + { code, message }（message 按 Accept-Language 中英双语）
 *  - 全部 POST 入参经 zod 校验；业务错误经 AibiError(code, status) 抛出。
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveLocale } from "@/i18n/api-errors";
import { AibiError } from "./aibi-errors";

export { AibiError };

const MESSAGES: Record<string, { zh: string; en: string }> = {
  UNAUTHORIZED: { zh: "请先登录", en: "Please sign in first." },
  FORBIDDEN: { zh: "无权限执行该操作", en: "Permission denied." },
  VALIDATION_ERROR: { zh: "请求参数不合法", en: "Invalid request parameters." },
  NOT_FOUND: { zh: "资源不存在", en: "Resource not found." },
  SPECIES_NOT_FOUND: { zh: "物种不存在", en: "Species not found." },
  PACK_NOT_FOUND: { zh: "卡包不存在或已下架", en: "Pack not found or inactive." },
  ITEM_NOT_FOUND: { zh: "道具不存在", en: "Item not found." },
  TOKEN_NOT_FOUND: { zh: "艾比凭证不存在", en: "Aibi token not found." },
  TOKEN_NOT_OWNED: { zh: "该艾比不属于你", en: "You do not own this aibi." },
  TOKEN_NOT_MINTED: { zh: "该艾比已销毁或不可用", en: "Aibi is burned or unavailable." },
  INSUFFICIENT_POINTS: { zh: "积分不足", en: "Insufficient points." },
  INSUFFICIENT_ITEM: { zh: "背包中数量不足", en: "Not enough items in bag." },
  NOT_ENOUGH_ENERGY: { zh: "艾比精力不足，先喂点吃的吧", en: "Aibi is too tired. Feed it first." },
  FUSION_INVALID: { zh: "融合需要至少 2 只属于你的可用艾比", en: "Fusion needs at least 2 available aibis you own." },
  BURN_COOLDOWN: { zh: "销毁冷却中，请稍后再试", en: "Burn is on cooldown. Please try again later." },
  PAYMENT_NOT_CONFIGURED: { zh: "支付通道未配置，请稍后再试", en: "Payment provider is not configured yet." },
  SIGNATURE_INVALID: { zh: "Webhook 签名校验失败", en: "Webhook signature verification failed." },
  DOMESTIC_PAYMENT_PENDING: { zh: "国内支付通道接入中，敬请期待", en: "Domestic payment channel is coming soon." },
  INTERNAL_ERROR: { zh: "服务器内部错误", en: "Internal server error." },
};

export function aibiLocale(req: Request): "zh" | "en" {
  return resolveLocale(req) === "en" ? "en" : "zh";
}

/** 成功返回：{ data } */
export function aibiOk(data: unknown) {
  return NextResponse.json({ data });
}

/** 失败返回：{ code, message }（+ 可选 details 供前端定位字段错误） */
export function aibiFail(code: string, status: number, req: Request, details?: unknown) {
  const locale = aibiLocale(req);
  const message = MESSAGES[code]?.[locale] ?? MESSAGES.INTERNAL_ERROR[locale];
  return NextResponse.json({ code, message, ...(details ? { details } : {}) }, { status });
}

/** zod 校验请求体；失败抛 AibiError(VALIDATION_ERROR, 400)（details 由路由捕获后透传）。 */
export async function parseBody<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const err = new AibiError("VALIDATION_ERROR", 400);
    err.details = z.flattenError(parsed.error).fieldErrors;
    throw err;
  }
  return parsed.data;
}

/** 路由统一异常出口：AibiError → {code,message}；未知错误 → 500。 */
export function aibiCatch(err: unknown, req: Request) {
  if (err instanceof AibiError) {
    return aibiFail(err.code, err.status, req, (err as AibiError & { details?: unknown }).details);
  }
  console.error("[aibi-api] unexpected error:", err);
  return aibiFail("INTERNAL_ERROR", 500, req);
}
