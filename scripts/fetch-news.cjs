// 手动抓取动物新闻头条（本地开发用）：
// Usage: node scripts/fetch-news.cjs [baseUrl=http://localhost:3100]
const BASE = process.argv[2] || "http://localhost:3100";

(async () => {
  console.log("fetching news from", BASE + "/api/news/refresh");
  const res = await fetch(BASE + "/api/news/refresh").then((r) => r.json());
  console.log("result:", JSON.stringify(res));
  if (res?.ok) {
    const hot = await fetch(BASE + "/api/news/hot").then((r) => r.json());
    console.log("top news:", (hot.news || []).map((n) => `${n.title} [${n.source}] hot=${n.hot.toFixed(1)}`).join("\n  "));
  }
})().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
