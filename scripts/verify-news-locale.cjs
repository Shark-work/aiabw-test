// 新闻语言隔离 E2E：验证 /api/news/hot 与 /animal-feed 按 locale 严格过滤
// Usage: node scripts/verify-news-locale.cjs http://localhost:3000
const CJK = /[\u4e00-\u9fff]/;
let pass = 0;
let fail = 0;
function assert(cond, label, extra = "") {
  console.log((cond ? "  PASS " : "  FAIL ") + label + (extra ? "  " + extra : ""));
  if (cond) pass++;
  else fail++;
}

async function getNews(base, path, locale) {
  const r = await fetch(`${base}${path}?locale=${locale}`);
  return (await r.json()).news ?? [];
}

(async () => {
  const BASE = process.argv[2] || "http://localhost:3000";

  for (const path of ["/api/news/hot", "/api/news/animal-feed"]) {
    const zh = await getNews(BASE, path, "zh");
    const en = await getNews(BASE, path, "en");
    assert(zh.length >= 1, `${path} zh 返回数据`, "n=" + zh.length);
    const zhAllCjk = zh.every((n) => CJK.test(String(n.title)));
    assert(zhAllCjk, `${path} zh 全部为中文标题（无英文混入）`);
    const enAllNonCjk = en.every((n) => !CJK.test(String(n.title)));
    assert(enAllNonCjk, `${path} en 全部为英文标题（无中文混入）`);
    // 兜底：zh/en 标题不应相同（隔离而非降级）
    const zhTitles = new Set(zh.map((n) => String(n.title)));
    const enTitles = new Set(en.map((n) => String(n.title)));
    const overlap = [...zhTitles].filter((t) => enTitles.has(t)).length;
    assert(overlap === 0, `${path} zh/en 标题零重叠（严格隔离）`, "overlap=" + overlap);
  }

  // 示例输出
  const zhTop = (await getNews(BASE, "/api/news/hot", "zh"))[0];
  console.log("zh 头条示例:", String(zhTop.title).slice(0, 40));
  const enTop = (await getNews(BASE, "/api/news/hot", "en"))[0];
  console.log("en 头条示例:", String(enTop.title).slice(0, 40));

  console.log(`\nRESULT: ${pass} passed, ${fail} failed ${fail === 0 ? "ALL PASS" : "FAILED"}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(2);
});
