import { NextResponse } from "next/server";

import { ensureDbSchemaOnce } from "@/db/client";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { findSoulCardByTokenId } from "@/server/repositories/soul-card-repository";
import { buildTokenMetadata } from "@/server/services/soul-card-service";

export const runtime = "nodejs";

/**
 * GET /api/chain/metadata/[tokenId]（公开读）
 * Controller：ERC-721 tokenURI 元数据端点 —— 合约 baseURI 指向本路径，
 * Sepolia 浏览器 / OpenSea / 钱包按 tokenId 拉取 JSON 展示卡片。
 * 响应与 mint 时写入账本 payload 的 metadata 同构（growth_stage 取当前成长
 * 阶段，体现「AI 动态角色卡」）；未铸造的 tokenId 返回 404。
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ tokenId: string }> },
) {
  const locale = resolveLocale(req);
  const { tokenId: raw } = await params;
  const tokenId = Number(raw);
  if (!Number.isInteger(tokenId) || tokenId < 1) {
    return NextResponse.json(
      { ok: false, code: "BAD_REQUEST", error: apiError(locale, "soulCardNotFound") },
      { status: 400 },
    );
  }

  try {
    await ensureDbSchemaOnce();
    const card = await findSoulCardByTokenId(tokenId);
    if (!card) {
      return NextResponse.json(
        { ok: false, code: "CARD_NOT_FOUND", error: apiError(locale, "soulCardNotFound") },
        { status: 404 },
      );
    }
    const personality =
      typeof (card.aiPersonality as { personality?: unknown } | null)
        ?.personality === "string"
        ? (card.aiPersonality as { personality: string }).personality
        : null;
    const metadata = buildTokenMetadata({
      cardName: card.name,
      imageUrl: card.petImageUrl,
      speciesId: card.speciesId,
      rarity: card.rarity,
      element: card.element,
      habitat: card.habitat,
      personality,
      certificateNo: card.certificateNo,
      growthStage: card.growthStage,
    });
    return NextResponse.json(metadata, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=300" },
    });
  } catch (err) {
    console.error("[/api/chain/metadata GET] failed:", err);
    return NextResponse.json(
      { ok: false, code: "SERVER_ERROR", error: apiError(locale, "soulCardLoadFailed") },
      { status: 500 },
    );
  }
}
