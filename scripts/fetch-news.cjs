// 手动抓取动物新闻头条（本地开发用）：
// Usage: node scripts/fetch-news.cjs [baseUrl=http://localhost:3100]
// 生产已启用 CRON_SECRET 鉴权：本脚本自动读 .env.local 的 CRON_SECRET 并携带
// Authorization: Bearer 头；未配置则保持原裸调行为（本地 dev 通常未启用鉴权）。
const fs = require("fs");
const path = require("path");

const BASE = process.argv[2] || "http://localhost:3100";

function loadCronSecret() {
  try {
    const env = fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
    return (env.match(/^CRON_SECRET=(.*)$/m) || [])[1]?.trim() || "";
  } catch {
    return "";
  }
}

(async () => {
  const secret = loadCronSecret();
  const headers = secret ? { Authorization: `Bearer ${secret}` } : {};
  console.log("fetching news from", BASE + "/api/news/refresh", secret ? "(with CRON_SECRET)" : "(no auth)");
  const res = await fetch(BASE + "/api/news/refresh", { headers }).then((r) => r.json());
  console.log("result:", JSON.stringify(res));
  if (res?.ok) {
    const hot = await fetch(BASE + "/api/news/hot").then((r) => r.json());
    console.log("top news:", (hot.news || []).map((n) => `${n.title} [${n.source}] hot=${n.hot.toFixed(1)}`).join("\n  "));
  }
})().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
