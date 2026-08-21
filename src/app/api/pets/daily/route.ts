import { NextResponse } from "next/server";

import { pool } from "@/db/client";
import { resolveLocale } from "@/i18n/api-errors";

export const runtime = "nodejs";

/** 西方星座四元素映射（1.20-2.18 水瓶=风 → 按区间判断）。 */
function zodiacElement(date: Date): "fire" | "earth" | "air" | "water" {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  type R = [number, number, number, number, "fire" | "earth" | "air" | "water"];
  const ranges: R[] = [
    [1, 20, 2, 18, "air"], // 水瓶 Aquarius
    [2, 19, 3, 20, "water"], // 双鱼 Pisces
    [3, 21, 4, 19, "fire"], // 白羊 Aries
    [4, 20, 5, 20, "earth"], // 金牛 Taurus
    [5, 21, 6, 20, "air"], // 双子 Gemini
    [6, 21, 7, 22, "water"], // 巨蟹 Cancer
    [7, 23, 8, 22, "fire"], // 狮子 Leo
    [8, 23, 9, 22, "earth"], // 处女 Virgo
    [9, 23, 10, 22, "air"], // 天秤 Libra
    [10, 23, 11, 21, "water"], // 天蝎 Scorpio
    [11, 22, 12, 21, "fire"], // 射手 Sagittarius
    [12, 22, 1, 19, "earth"], // 摩羯 Capricorn
  ];
  for (const [sm, sd, em, ed, el] of ranges) {
    if (sm === em) {
      if (m === sm && d >= sd && d <= ed) return el;
    } else if ((m === sm && d >= sd) || (m === em && d <= ed)) {
      return el;
    }
  }
  return "earth";
}

/** 中文 trait → 英文 trait（EN 运势文案）。 */
function traitEn(zh?: string): string {
  const map: Record<string, string> = {
    勇敢: "brave",
    温柔: "gentle",
    机灵: "clever",
    高傲: "proud",
    慵懒: "lazy",
  };
  return map[zh || ""] || "unique";
}

/** 脱敏 owner 显示名：邮箱前缀截断，避免暴露完整账号。 */
function maskOwner(email: string | null): string {
  if (!email) return "匿名";
  const at = email.indexOf("@");
  const name = at > 0 ? email.slice(0, at) : email;
  return name.length > 10 ? name.slice(0, 8) + "***" : name;
}

/**
 * GET /api/pets/daily — 首页「艾比每日灵感」数据源：
 *  - lucky: 今日幸运宠（按日期确定性选一只【未领养 + 当日星座元素匹配】的预计算宠物；
 *           该元素池为空时回退到任意未领养宠物）；
 *  - recent: 最近 3 只被领养/合成的稀有宠（rare / epic / legendary），附脱敏 owner。
 */
export async function GET(req: Request) {
  const locale = resolveLocale(req);
  const now = new Date();
  const dateKey = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const element = zodiacElement(now);

  // —— 今日幸运宠：确定性（md5(id||date)）但每日变化 ——
  let luckyRows = await pool.query(
    `SELECT p.id, p.species_id, p.image_url, p.traits, p.generation,
            d.name_zh AS "nameZh", d.name_en AS "nameEn", d.category
       FROM pets p
       JOIN pet_dictionary d ON d.id = p.species_id
      WHERE p.owner_id IS NULL AND p.traits->>'element' = $1
      ORDER BY md5(p.id || $2)
      LIMIT 1`,
    [element, dateKey],
  );
  if (!luckyRows.rows.length) {
    luckyRows = await pool.query(
      `SELECT p.id, p.species_id, p.image_url, p.traits, p.generation,
              d.name_zh AS "nameZh", d.name_en AS "nameEn", d.category
         FROM pets p
         JOIN pet_dictionary d ON d.id = p.species_id
        WHERE p.owner_id IS NULL
        ORDER BY md5(p.id || $1)
        LIMIT 1`,
      [dateKey],
    );
  }

  // —— 最新诞生：最近 3 只被领养/合成的稀有宠 ——
  const { rows: recentRows } = await pool.query(
    `SELECT p.id, p.species_id, p.image_url, p.traits, p.adopted_at,
            d.name_zh AS "nameZh", d.name_en AS "nameEn",
            u.email AS owner_email
       FROM pets p
       JOIN pet_dictionary d ON d.id = p.species_id
       LEFT JOIN users u ON u.id = p.owner_id
      WHERE p.owner_id IS NOT NULL
        AND p.status = 'active'
        AND p.traits->>'rarity' IN ('rare', 'epic', 'legendary')
      ORDER BY p.adopted_at DESC NULLS LAST
      LIMIT 3`,
  );

  const luckyRow = luckyRows.rows[0];
  const lucky = luckyRow
    ? {
        id: luckyRow.id,
        speciesId: luckyRow.species_id,
        speciesName: locale === "en" ? luckyRow.nameEn : luckyRow.nameZh,
        category: luckyRow.category,
        imageUrl: luckyRow.image_url,
        traits: luckyRow.traits ?? {},
        trait: luckyRow.traits?.personality ?? "独特",
        traitEn: traitEn(luckyRow.traits?.personality),
        generation: Number(luckyRow.generation),
      }
    : null;

  const recent = recentRows.map((r) => ({
    id: r.id,
    speciesName: locale === "en" ? r.nameEn : r.nameZh,
    rarity: r.traits?.rarity ?? "rare",
    imageUrl: r.image_url,
    ownerLabel: maskOwner(r.owner_email ?? null),
  }));

  const body = {
    ok: true,
    date: dateKey,
    zodiacElement: element,
    lucky,
    recent,
  };
  // 首页模块数据：每日变化，但允许 Vercel CDN 缓存 60s（s-maxage 只作用于 CDN，
  // 浏览器不带 max-age 不缓存，保证「最新诞生」相对实时）。
  const res = NextResponse.json(body);
  res.headers.set(
    "Cache-Control",
    "public, s-maxage=60, stale-while-revalidate=60",
  );
  return res;
}
