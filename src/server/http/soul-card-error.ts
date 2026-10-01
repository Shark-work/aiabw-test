/**
 * Controller 支撑 · SoulCardError → HTTP 响应映射（平台升级 Phase 1，2026-09-30）
 * ----------------------------------------------------------------
 * 仅处理「业务错误」（SoulCardError）；未知异常返回 null，
 * 由各 Controller 统一走 500 + 日志。
 */

import { NextResponse } from "next/server";

import { apiError, type Locale } from "@/i18n/api-errors";
import {
  SoulCardError,
  type SoulCardErrorCode,
} from "@/server/services/soul-card-service";

const CODE_MAP: Record<SoulCardErrorCode, { status: number; i18nKey: string }> = {
  PET_NOT_FOUND: { status: 404, i18nKey: "soulCardPetNotFound" },
  PET_NOT_OWNED: { status: 403, i18nKey: "soulCardPetNotYours" },
  PET_NOT_ACTIVE: { status: 409, i18nKey: "soulCardPetInactive" },
  SOUL_CARD_EXISTS: { status: 409, i18nKey: "soulCardExists" },
  SUPPLY_EXHAUSTED: { status: 409, i18nKey: "soulCardSupplyExhausted" },
  CARD_NOT_FOUND: { status: 404, i18nKey: "soulCardNotFound" },
  CARD_NOT_OWNED: { status: 403, i18nKey: "soulCardNotYours" },
  CARD_ALREADY_BURNED: { status: 409, i18nKey: "soulCardBurned" },
};

/** 命中业务错误 → 本地化 JSON 响应；非业务错误 → null。 */
export function soulCardErrorResponse(
  err: unknown,
  locale: Locale,
): NextResponse | null {
  if (err instanceof SoulCardError) {
    const mapped = CODE_MAP[err.code];
    return NextResponse.json(
      { ok: false, code: err.code, error: apiError(locale, mapped.i18nKey) },
      { status: mapped.status },
    );
  }
  return null;
}
