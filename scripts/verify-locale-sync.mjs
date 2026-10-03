/**
 * verify-locale-sync.mjs — 生产双语内容一致性巡检（2026-10-06 /en 未同步排查固化）。
 *
 * 检查项（对应当日诊断 14 项）：
 *  1) GET / → 307 → /zh（默认）；Accept-Language: en / NEXT_LOCALE=en → /en；
 *  2) /en 与 /zh 均 200 且 X-Matched-Path = /[locale]（middleware 单一路由组）；
 *  3) /en 新文案五件在线（Hero 标题/CTA/社交证明/导航 ×2）+ 旧 Hero 文案零残留；
 *  4) /zh 镜像检查（中文新文案在线 + 旧文案零残留）；
 *  5) /api/pets/daily?locale=en recent id 全部唯一（Just Born 无重复）；
 *  6) 页脚版权行可见渲染仅一处（匹配渲染形态 <p …>© 2025-2026…</p>，
 *     排除 i18n 消息体 / RSC props 序列化中的非可见副本）。
 *
 * 用法：node scripts/verify-locale-sync.mjs [baseUrl]   （默认 https://www.aiabw.com）
 * 退出码：0 全部通过；1 存在失败项。
 */

const BASE = (process.argv[2] ?? "https://www.aiabw.com").replace(/\/$/, "");

let failures = 0;
function check(ok, label, extra = "") {
  console.log(`${ok ? "OK  " : "FAIL"}  ${label}${extra ? ` —— ${extra}` : ""}`);
  if (!ok) failures += 1;
}

async function fetchNoRedirect(url, init = {}) {
  return fetch(url, { redirect: "manual", ...init });
}

// ---- 1) 根路径重定向 ----
const rootZh = await fetchNoRedirect(`${BASE}/`);
check(
  rootZh.status === 307 && (rootZh.headers.get("location") ?? "").endsWith("/zh"),
  "GET / → 307 → /zh（默认中文）",
  `status=${rootZh.status} location=${rootZh.headers.get("location")}`,
);
const rootEn = await fetchNoRedirect(`${BASE}/`, {
  headers: { "Accept-Language": "en-US,en;q=0.9" },
});
check(
  rootEn.status === 307 && (rootEn.headers.get("location") ?? "").endsWith("/en"),
  "GET / (Accept-Language: en) → 307 → /en",
  `location=${rootEn.headers.get("location")}`,
);

// ---- 2) 双语 200 + 单一路由组 ----
const pages = {};
for (const locale of ["en", "zh"]) {
  const res = await fetch(`${BASE}/${locale}`);
  const html = await res.text();
  pages[locale] = html;
  check(
    res.status === 200 && res.headers.get("x-matched-path") === "/[locale]",
    `GET /${locale} → 200 + X-Matched-Path /[locale]`,
    `status=${res.status} matched=${res.headers.get("x-matched-path")} cache=${res.headers.get("x-vercel-cache")}`,
  );
}

// ---- 3) /en 新文案在线 + 旧文案零残留 ----
const enMust = [
  "Adopt Your AI Companion",
  "Adopt Now",
  "Adopt / My Pets",
  "Soul Cards / Collection",
  "Join",
];
for (const kw of enMust) check(pages.en.includes(kw), `/en 含新文案 "${kw}"`);
const enStale = ["Raise your AI being", "mint Aibi credentials", "养育你的 AI 生命体"];
for (const kw of enStale) check(!pages.en.includes(kw), `/en 无旧文案 "${kw}"`);
// 运势语法（en）：fortune 模板不含 "a {sign} day"（文案在 messages/en.json，此处查 SSR 注入的消息体）
check(!pages.en.includes("a {sign} day"), "/en 运势模板无 \"a {sign} day\" 冠词错误");

// ---- 4) /zh 镜像 ----
const zhMust = ["立即领养", "领养/我的宠物", "灵魂卡/收藏", "收藏中心"];
for (const kw of zhMust) check(pages.zh.includes(kw), `/zh 含新文案 "${kw}"`);
check(!pages.zh.includes("养育你的 AI 生命体"), "/zh 无旧 Hero 文案");

// ---- 5) Just Born（recent id 唯一）----
const dailyRes = await fetch(`${BASE}/api/pets/daily?locale=en`);
const daily = await dailyRes.json();
const ids = (daily.recent ?? []).map((r) => r.id);
check(
  daily.ok === true && ids.length === new Set(ids).size,
  "Just Born /api/pets/daily recent id 全部唯一",
  `count=${ids.length} unique=${new Set(ids).size}`,
);

// ---- 6) 页脚版权行可见渲染仅一处 ----
// 可见渲染形态：<p class="…font-semibold…">© 2025-2026 …</p>（FooterCollapsible 主版权行）；
// i18n 消息体 / RSC payload 中的副本带 \" 转义，不匹配此模式。
const visibleCopyright = /<p class="[^"]*font-semibold[^"]*">© 2025-2026/g;
const enCount = (pages.en.match(visibleCopyright) ?? []).length;
const zhCount = (pages.zh.match(visibleCopyright) ?? []).length;
check(enCount === 1, "/en 页脚版权行可见渲染仅一处", `count=${enCount}`);
check(zhCount === 1, "/zh 页脚版权行可见渲染仅一处", `count=${zhCount}`);

console.log(
  failures === 0
    ? "\n=== locale sync: all checks passed ==="
    : `\n=== locale sync: ${failures} check(s) FAILED ===`,
);
process.exit(failures === 0 ? 0 : 1);
