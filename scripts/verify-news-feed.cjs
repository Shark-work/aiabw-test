// 侧边栏新闻排行榜 E2E（本地 dev server）：
// 验证 /api/news/animal-feed 返回 Top N 且按热度降序，limit 参数生效
// Usage: node scripts/verify-news-feed.cjs http://localhost:3000
let pass = 0;
let fail = 0;
function out(s) { console.log(s); }
function assert(cond, label, extra = "") {
  out((cond ? "  PASS " : "  FAIL ") + label + (extra ? "  " + extra : ""));
  if (cond) pass++;
  else fail++;
}

(async () => {
  const BASE = process.argv[2] || "http://localhost:3000";
  const res = await fetch(BASE + "/api/news/animal-feed");
  const data = await res.json();
  assert(data?.ok && Array.isArray(data.news), "接口返回 ok + news 数组");
  assert(data.news.length >= 1 && data.news.length <= 10, "默认 Top ≤10 条", "n=" + data.news.length);

  const sorted = [...data.news].sort((a, b) => b.hot - a.hot);
  const isSorted = data.news.every((n, i) => Math.abs(n.hot - sorted[i].hot) < 1e-9);
  assert(isSorted, "按热度分降序");

  const first = data.news[0];
  assert(first && typeof first.title === "string" && first.title.length > 0, "条目含标题");
  assert(first && typeof first.source === "string" && first.source.length > 0, "条目含来源标识");
  assert(first && typeof first.hot === "number" && Number.isFinite(first.hot), "条目含热度数值");

  // limit 参数生效
  const res3 = await fetch(BASE + "/api/news/animal-feed?limit=3");
  const data3 = await res3.json();
  assert(data3?.ok && data3.news.length === 3, "limit=3 生效", "n=" + data3.news.length);

  // 输出预览
  out("--- /api/news/animal-feed (top5) ---");
  for (const n of data.news.slice(0, 5)) {
    out(`  ${n.title.slice(0, 40)}… [${n.source}] hot=${n.hot.toFixed(1)}`);
  }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed ${fail === 0 ? "ALL PASS" : "FAILED"}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(2);
});
