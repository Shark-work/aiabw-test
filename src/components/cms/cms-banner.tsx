import { Link } from "@/i18n/navigation";
import { getBannersByPlacement, type CmsBanner as CmsBannerData } from "@/lib/cms/loaders";

/** Lexical JSON → 纯文本（横幅说明用；递归收集 text 节点，段落间空格连接）。 */
function lexicalToText(node: unknown): string {
  if (node == null || typeof node !== "object") return "";
  const n = node as { type?: string; text?: string; children?: unknown[] };
  if (n.type === "text" && typeof n.text === "string") return n.text;
  if (Array.isArray(n.children)) {
    return n.children.map(lexicalToText).filter(Boolean).join(" ");
  }
  return "";
}

function bannerBody(b: CmsBannerData): string {
  const root = (b.content ?? null) as { root?: unknown } | null;
  const text = lexicalToText(root?.root);
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

/**
 * CMS 运营横幅（RSC，2026-10-18 ui-wiring）：placement 命中的启用横幅按 priority 渲染。
 * 空表 / 时间窗外 / CMS 未配置 → 渲染 null（零占位 DOM——「无真实活动不虚构」红线）。
 * 富文本 content 提取纯文本摘要（完整 Lexical 渲染器后续按需引入）。
 */
export async function CmsBanner({ placement, locale }: { placement: string; locale: string }) {
  const banners = await getBannersByPlacement(placement);
  if (banners.length === 0) return null;
  const en = locale === "en";

  return (
    <div className="space-y-2">
      {banners.map((b) => {
        const title = en ? b.titleEn : b.titleZh;
        const ctaText = en ? b.ctaTextEn : b.ctaTextZh;
        const body = bannerBody(b);
        const card = (
          <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 px-4 py-3 shadow-sm">
            {b.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={b.imageUrl} alt="" className="h-10 w-10 rounded-xl object-cover" aria-hidden />
            ) : (
              <span className="text-xl" aria-hidden>📣</span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-amber-900">{title}</p>
              {body ? <p className="mt-0.5 line-clamp-2 text-xs text-amber-700">{body}</p> : null}
            </div>
            {ctaText ? (
              <span className="shrink-0 rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-white">
                {ctaText} →
              </span>
            ) : null}
          </div>
        );
        if (!b.ctaUrl) return <div key={b.slug}>{card}</div>;
        return b.ctaUrl.startsWith("http") ? (
          <a key={b.slug} href={b.ctaUrl} target="_blank" rel="noopener noreferrer" className="block">
            {card}
          </a>
        ) : (
          <Link key={b.slug} href={b.ctaUrl} className="block">
            {card}
          </Link>
        );
      })}
    </div>
  );
}
