import { ImageResponse } from "next/og";

import { pool, ensureDbSchemaOnce } from "@/db/client";
import { resolveLocale } from "@/i18n/api-errors";
import { loadCjkFont } from "@/lib/og-share-image";
import { SITE_URL } from "@/lib/site";
import {
  normalizeRarity,
  stageForLevel,
  type SoulCardRarity,
} from "@/lib/soul-card-config";

export const runtime = "nodejs";

/**
 * GET /api/soul-cards/[id]/share.png — 灵魂卡分享图（P1 故事外显）
 * 600×1000 竖版卡面：稀有度渐变底 + 立绘 + 名称 + 成长阶段 + 全球唯一编号，
 * 用于社交平台传播（详情弹窗「分享卡」按钮打开）。
 *
 * 公开读：与 /api/soul-cards/[id] 公开凭证口径一致（卡面字段即公开凭证内容，
 * 不含任何用户隐私字段）；已销毁卡不出图（404）。
 * 字体：复用 og-share-image 的 CJK 加载（不可达时降级拉丁字体 + 英文阶段标签）。
 * 图形约束：satori 无 emoji 字体 → 装饰一律纯 CSS 图形，文本仅卡名/阶段/编号。
 */

/** 稀有度渐变底（与 RARITY_META.frameClass 同色系，hex 供 satori 使用）。 */
const RARITY_GRADIENT: Record<SoulCardRarity, [string, string]> = {
  common: ["#a1a1aa", "#d4d4d8"],
  uncommon: ["#34d399", "#2dd4bf"],
  rare: ["#38bdf8", "#818cf8"],
  epic: ["#8b5cf6", "#e879f9"],
  legendary: ["#f59e0b", "#fb7185"],
};

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const locale = resolveLocale(req);
  try {
    await ensureDbSchemaOnce();
    const { rows } = await pool.query(
      `SELECT sc.name, sc.rarity, sc.element,
              sc.growth_level AS "growthLevel",
              sc.certificate_no AS "certificateNo",
              p.image_url AS "petImageUrl"
         FROM soul_cards sc
         JOIN pets p ON p.id = sc.pet_id
        WHERE sc.id = $1 AND sc.status = 'active'
        LIMIT 1`,
      [id],
    );
    const card = rows[0];
    if (!card) {
      return new Response("Not Found", { status: 404 });
    }

    const rarity = normalizeRarity(card.rarity);
    const [g0, g1] = RARITY_GRADIENT[rarity];
    const stage = stageForLevel(Number(card.growthLevel));
    const fontData = await loadCjkFont();
    const isEn = locale === "en";
    // CJK 字体不可达时降级英文阶段标签（卡名为数据原文，与 OG 图同风险口径）
    const stageLabel = !fontData || isEn ? stage.labelEn : stage.labelZh;
    const fontFamily = fontData ? "CJK" : undefined;
    const fontWeight = fontData ? 400 : 700;
    const imgUrl = card.petImageUrl
      ? new URL(String(card.petImageUrl), SITE_URL).toString()
      : null;

    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            backgroundImage: `linear-gradient(160deg, ${g0} 0%, ${g1} 100%)`,
            padding: 40,
          }}
        >
          {/* 卡面主体（白卡） */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              backgroundColor: "rgba(255,255,255,0.94)",
              borderRadius: 32,
              padding: 36,
              width: "100%",
              flex: 1,
            }}
          >
            {imgUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imgUrl}
                width={420}
                height={420}
                style={{ borderRadius: 24, objectFit: "cover" }}
                alt=""
              />
            ) : (
              <div
                style={{
                  width: 420,
                  height: 420,
                  borderRadius: 24,
                  backgroundColor: "#e4e4e7",
                  display: "flex",
                }}
              />
            )}
            <div
              style={{
                display: "flex",
                marginTop: 28,
                fontSize: 44,
                fontWeight,
                fontFamily,
                color: "#18181b",
                maxWidth: 460,
                textAlign: "center",
              }}
            >
              {String(card.name)}
            </div>
            <div
              style={{
                display: "flex",
                marginTop: 14,
                fontSize: 26,
                fontFamily,
                color: "#52525b",
              }}
            >
              {`${stageLabel} · Lv.${Number(card.growthLevel)}`}
            </div>
            {/* 全球唯一编号（底部锚定） */}
            <div
              style={{
                display: "flex",
                marginTop: "auto",
                paddingTop: 28,
                fontSize: 26,
                fontFamily,
                fontWeight,
                letterSpacing: 3,
                color: "#7c3aed",
              }}
            >
              {String(card.certificateNo)}
            </div>
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 22,
              fontSize: 20,
              fontFamily,
              color: "rgba(255,255,255,0.92)",
            }}
          >
            aiabw.com
          </div>
        </div>
      ),
      {
        width: 600,
        height: 1000,
        fonts: fontData
          ? [{ name: "CJK", data: fontData, weight: 400 as const, style: "normal" as const }]
          : [],
      },
    );
  } catch (err) {
    console.error("[/api/soul-cards/[id]/share.png] failed:", err);
    return new Response("Internal Error", { status: 500 });
  }
}
