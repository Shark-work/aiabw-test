import { ImageResponse } from "next/og";

/**
 * 全站 OG / Twitter Card 分享图（1200×630）共享渲染器：
 *  - opengraph-image / twitter-image 两个约定文件共用，保证双端卡片一致；
 *  - 中文字体：jsDelivr 拉取 ZCOOL KuaiLe（站酷快乐体，OFL 协议，1.1MB），
 *    备选 Noto Sans SC 可变字重版；模块级缓存避免重复拉取；
 *  - 字体不可达时降级为英文标题（satori 默认字体只覆盖拉丁，绝不渲染豆腐块）；
 *  - 爪印用纯 CSS 图形绘制（不依赖 emoji 字体，渲染确定性 100%）。
 */

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_ALT = "艾比世界 · AI 灵魂养成与数字凭证平台";
export const OG_CONTENT_TYPE = "image/png";

const FONT_URLS = [
  "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/zcoolkuaile/ZCOOLKuaiLe-Regular.ttf",
  "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf",
];

let cachedFont: ArrayBuffer | null | undefined;

/** CJK 字体加载（模块级缓存；P1 灵魂卡分享图 share.png 复用）。 */
export async function loadCjkFont(): Promise<ArrayBuffer | null> {
  if (cachedFont !== undefined) return cachedFont;
  for (const url of FONT_URLS) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        cachedFont = await res.arrayBuffer();
        return cachedFont;
      }
    } catch {
      // 尝试下一个字体源
    }
  }
  cachedFont = null;
  return cachedFont;
}

export async function renderOgShareImage(): Promise<ImageResponse> {
  const fontData = await loadCjkFont();
  // ZCOOL 只有 400 单字重：加载成功时用 CJK 字体 + 400；失败时回退默认拉丁字体 + 700
  const fontFamily = fontData ? "CJK" : undefined;
  const fontWeight = fontData ? 400 : 700;
  const title = fontData
    ? "艾比世界 · AI 灵魂养成与数字凭证平台"
    : "AIABW · AI Soul Raising & Digital Credentials";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundImage: "linear-gradient(135deg, #fff7ed 0%, #ffffff 50%, #fff1f2 100%)",
        }}
      >
        {/* 爪印：三趾 + 主垫（绝对定位圆形拼接） */}
        <div style={{ display: "flex", position: "relative", width: 220, height: 200, marginBottom: 48 }}>
          <div style={{ position: "absolute", left: 84, top: 0, width: 52, height: 64, borderRadius: "50%", backgroundColor: "#fb923c" }} />
          <div style={{ position: "absolute", left: 26, top: 42, width: 52, height: 64, borderRadius: "50%", backgroundColor: "#fb923c" }} />
          <div style={{ position: "absolute", left: 142, top: 42, width: 52, height: 64, borderRadius: "50%", backgroundColor: "#fb923c" }} />
          <div style={{ position: "absolute", left: 50, top: 96, width: 120, height: 92, borderRadius: "50%", backgroundColor: "#f97316" }} />
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 56,
            fontWeight,
            fontFamily,
            color: "#1c1917",
            maxWidth: 1060,
            textAlign: "center",
            lineHeight: 1.35,
          }}
        >
          {title}
        </div>
        <div style={{ display: "flex", marginTop: 40, fontSize: 30, fontFamily, color: "#a8a29e" }}>
          aiabw.com
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: fontData
        ? [{ name: "CJK", data: fontData, weight: 400 as const, style: "normal" as const }]
        : [],
    },
  );
}
