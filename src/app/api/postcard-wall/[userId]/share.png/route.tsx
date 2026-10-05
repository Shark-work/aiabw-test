import { ImageResponse } from "next/og";

import { ensureDbSchemaOnce } from "@/db/client";
import { resolveLocale } from "@/i18n/api-errors";
import { loadCjkFont } from "@/lib/og-share-image";
import { POSTCARD_SETS } from "@/lib/postcard-config";
import { SITE_URL } from "@/lib/site";
import { getPublicPostcardWall } from "@/server/queries/postcard-wall-queries";

export const runtime = "nodejs";

/**
 * GET /api/postcard-wall/[userId]/share.png — 明信片墙汇总分享图（P2 社交传播 · 改动二）
 * 1200×630 横版 OG：用户名 + 五系列收集进度条 + 集齐金标 + 明信片总数 + 域名水印。
 * 隐私门与公开页一致：未开启 postcard_wall_public → 404。
 * 图形约束：satori 无 emoji 字体 → 系列标识用纯 CSS 色点，文本仅名称/数字/域名。
 */

/** 五系列配色（纯展示色，satori hex）。 */
const SET_COLORS: Record<string, string> = {
  cat: "#f472b6",
  fox: "#fb923c",
  dog: "#facc15",
  rabbit: "#a78bfa",
  bird: "#38bdf8",
};

export async function GET(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const locale = resolveLocale(req);
  const isEn = locale === "en";
  try {
    await ensureDbSchemaOnce();
    const { userId } = await params;
    const wall = await getPublicPostcardWall(userId);
    if (!wall) return new Response("Not Found", { status: 404 });

    const fontData = await loadCjkFont();
    const fontFamily = fontData ? "CJK" : undefined;
    const fontWeight = fontData ? 400 : 700;
    const siteHost = new URL(SITE_URL).host;
    const byCategory = new Map(wall.collections.map((c) => [c.category, c]));
    const completeCount = wall.collections.filter((c) => c.complete).length;

    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            backgroundImage: "linear-gradient(150deg, #7c3aed 0%, #db2777 100%)",
            padding: 56,
          }}
        >
          {/* 标题行 */}
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              fontSize: 44,
              fontWeight,
              fontFamily,
              color: "#ffffff",
            }}
          >
            {isEn
              ? `${wall.owner.username}'s Postcard Wall`
              : `${wall.owner.username} 的明信片墙`}
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 10,
              fontSize: 24,
              fontFamily,
              color: "rgba(255,255,255,0.85)",
            }}
          >
            {isEn
              ? `${wall.cards.length} postcards · ${completeCount}/${POSTCARD_SETS.length} sets complete`
              : `共收集 ${wall.cards.length} 张明信片 · ${completeCount}/${POSTCARD_SETS.length} 个系列已集齐`}
          </div>


          {/* 五系列进度（白卡） */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 18,
              marginTop: 36,
              backgroundColor: "rgba(255,255,255,0.94)",
              borderRadius: 28,
              padding: "32px 40px",
              flex: 1,
            }}
          >
            {POSTCARD_SETS.map((set) => {
              const col = byCategory.get(set.category);
              const owned = col?.owned ?? 0;
              const total = col?.total ?? 0;
              const complete = !!col?.complete;
              const pct = total > 0 ? Math.min(100, Math.round((owned / total) * 100)) : 0;
              return (
                <div key={set.category} style={{ display: "flex", alignItems: "center" }}>
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 9999,
                      backgroundColor: SET_COLORS[set.category] ?? "#a1a1aa",
                      marginRight: 16,
                    }}
                  />
                  <div
                    style={{
                      display: "flex",
                      width: 220,
                      fontSize: 26,
                      fontWeight,
                      fontFamily,
                      color: "#3f3f46",
                    }}
                  >
                    {isEn ? set.labelEn : set.labelZh}
                  </div>
                  {/* 进度条（CSS） */}
                  <div
                    style={{
                      display: "flex",
                      flex: 1,
                      height: 16,
                      borderRadius: 9999,
                      backgroundColor: "#e4e4e7",
                      overflow: "hidden",
                      marginRight: 18,
                    }}
                  >
                    <div
                      style={{
                        width: `${pct}%`,
                        height: "100%",
                        backgroundColor: complete
                          ? "#f59e0b"
                          : (SET_COLORS[set.category] ?? "#a1a1aa"),
                      }}
                    />
                  </div>
                  <div
                    style={{
                      display: "flex",
                      width: 120,
                      justifyContent: "flex-end",
                      fontSize: 26,
                      fontFamily,
                      fontWeight,
                      color: complete ? "#b45309" : "#71717a",
                    }}
                  >
                    {complete ? (isEn ? "DONE" : "已集齐") : `${owned}/${total}`}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 域名水印 */}
          <div
            style={{
              display: "flex",
              marginTop: 24,
              fontSize: 22,
              fontFamily,
              color: "rgba(255,255,255,0.9)",
            }}
          >
            {siteHost}
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 630,
        fonts: fontData
          ? [{ name: "CJK", data: fontData, weight: 400 as const, style: "normal" as const }]
          : [],
      },
    );
  } catch (err) {
    console.error("[/api/postcard-wall/[userId]/share.png] failed:", err);
    return new Response("Internal Error", { status: 500 });
  }
}
