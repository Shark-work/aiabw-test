import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { pool } from "@/db/client";
import { PetAvatar } from "@/components/PetAvatar";
import { Link } from "@/i18n/navigation";
import { renderPetDescription, type DictionarySpecies } from "@/lib/pet-dictionary";
import { SITE_URL } from "@/lib/site";

type Props = { params: Promise<{ locale: string; id: string }> };

/**
 * 宠物（物种）详情页 — SEO 落地页：
 *  - 动态 generateMetadata：查 pet_dictionary 生成物种专属标题/描述/OG；
 *  - 内容为服务端渲染（利于收录），带返回图鉴 + 领养 CTA 内链；
 *  - URL 已纳入 sitemap.xml（/zh|en/pets/<speciesId>）。
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, id } = await params;
  const t = await getTranslations("seo");
  try {
    const { rows } = await pool.query(
      `SELECT d.name_zh AS "nameZh", d.name_en AS "nameEn", d.category, d.habitat,
              d.default_description_zh AS "descZh", d.default_description_en AS "descEn"
         FROM pet_dictionary d WHERE d.id = $1 LIMIT 1`,
      [id],
    );
    const s = rows[0];
    if (!s) return {};
    const name = locale === "en" ? String(s.nameEn) : String(s.nameZh);
    const title = t("petDetailTitle", { name });
    const description = t("petDetailDesc", {
      name,
      category: String(s.category),
      habitat: s.habitat ? String(s.habitat) : "—",
    }).slice(0, 160);
    return {
      title,
      description,
      openGraph: { title, description, type: "website", url: `${SITE_URL}/${locale}/pets/${id}` },
    };
  } catch {
    return {};
  }
}

export default async function PetSpeciesPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("seo");

  const { rows } = await pool.query(
    `SELECT d.id, d.name_zh AS "nameZh", d.name_en AS "nameEn", d.category, d.habitat,
            d.default_description_zh AS "descZh", d.default_description_en AS "descEn",
            (SELECT image_url FROM pets WHERE species_id = d.id AND image_url IS NOT NULL LIMIT 1) AS "imageUrl"
       FROM pet_dictionary d WHERE d.id = $1 LIMIT 1`,
    [id],
  );
  const s = rows[0];
  if (!s) notFound();

  const species: DictionarySpecies = {
    id: String(s.id),
    nameZh: String(s.nameZh),
    nameEn: String(s.nameEn),
    category: String(s.category),
    habitat: s.habitat ? String(s.habitat) : null,
    defaultDescriptionZh: String(s.descZh),
    defaultDescriptionEn: String(s.descEn),
  };
  const name = locale === "en" ? species.nameEn : species.nameZh;
  const desc = renderPetDescription(species, null, locale);

  return (
    <main className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-rose-50 p-4 sm:p-6">
      {/* Product 结构化数据（SEO：搜索结果展示名称/图片/价格） */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Product",
            name: `${species.nameZh}｜${species.nameEn} - 艾比世界 AI 虚拟宠物`,
            image: s.imageUrl ? String(s.imageUrl) : `${SITE_URL}/icon.svg`,
            description: desc.slice(0, 200),
            brand: { "@type": "Brand", name: "艾比世界" },
            category: "虚拟宠物",
            offers: {
              "@type": "Offer",
              price: "0",
              priceCurrency: "CNY",
              availability: "https://schema.org/InStock",
              url: `${SITE_URL}/${locale}/pets/${species.id}`,
            },
          }),
        }}
      />
      <div className="mx-auto max-w-3xl">
        <Link href="/pets" className="text-xs text-zinc-500 transition hover:text-orange-600">
          {t("petBack")}
        </Link>

        <div className="mt-3 rounded-2xl border border-zinc-200 bg-white/90 p-6 shadow-sm backdrop-blur">
          <div className="flex items-center gap-4">
            <PetAvatar
              src={s.imageUrl ? String(s.imageUrl) : ""}
              alt={name}
              className="h-24 w-24 shrink-0 rounded-2xl border-2 border-orange-200 bg-orange-50 object-cover"
            />
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-zinc-900">{name}</h1>
              <p className="mt-0.5 text-xs text-zinc-400">
                {species.nameZh}｜{species.nameEn}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                <span className="rounded-full bg-orange-50 px-2 py-0.5 font-medium text-orange-600">
                  {species.category}
                </span>
                {species.habitat && (
                  <span className="rounded-full bg-sky-50 px-2 py-0.5 font-medium text-sky-600">
                    🏞️ {species.habitat}
                  </span>
                )}
              </div>
            </div>
          </div>

          <p className="mt-4 border-t border-zinc-100 pt-3 text-sm leading-relaxed text-zinc-600">{desc}</p>

          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              href={`/pets?species=${species.id}`}
              className="flex-1 rounded-full bg-orange-500 px-4 py-2 text-center text-sm font-semibold text-white shadow transition hover:bg-orange-600"
            >
              {t("petAdopt", { name })}
            </Link>
            <Link
              href="/blindbox"
              className="rounded-full border border-orange-300 px-4 py-2 text-sm font-medium text-orange-600 transition hover:bg-orange-50"
            >
              {t("blindboxCta")}
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
