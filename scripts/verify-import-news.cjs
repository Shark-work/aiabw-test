// 后台投喂接口 E2E：鉴权（401/403）→ admin 导入 → 去重幂等 → DB 落库
// Usage: node scripts/verify-import-news.cjs http://localhost:3000
const fs = require("fs");
const path = require("path");
const { Pool } = require("@neondatabase/serverless");

const BASE = process.argv[2] || "http://localhost:3000";
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
const DATABASE_URL = (env.match(/^DATABASE_URL=(.*)$/m) || [])[1]?.trim();
const pool = new Pool({ connectionString: DATABASE_URL, max: 2, connectionTimeoutMillis: 8000 });

let pass = 0;
let fail = 0;
function out(s) { fs.writeSync(1, s + "\n"); }
function assert(cond, label, extra = "") {
  out((cond ? "  PASS " : "  FAIL ") + label + (extra ? "  " + extra : ""));
  if (cond) pass++;
  else fail++;
}
async function req(method, apiPath, body, token) {
  const res = await fetch(BASE + apiPath, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

const ITEMS = [
  { title: `运营投喂测试：大熊猫基地开放夜间参观${Date.now().toString().slice(-4)}`, desc: "夜间灯光下的滚滚更添神秘感。", url: "https://example.com/panda-night", source: "公众号·熊猫观察" },
  { title: `运营投喂测试：城市流浪猫TNR计划成效显著${Date.now().toString().slice(-4)}`, desc: "绝育放归让社区猫群数量趋于稳定。", url: "https://example.com/tnr", source: "小红书·喵事记" },
  { title: `运营投喂测试：《山海经》神兽插画展亮相博物馆${Date.now().toString().slice(-4)}`, desc: "古籍中的奇异生物跃然纸上。", url: "https://example.com/beasts", source: "微博·文博热" },
];

(async () => {
  const ts = Date.now().toString().slice(-6);
  const email = `imp_${ts}@test.aiabw`;
  const reg = await req("POST", "/api/auth/register", { email, password: "imppass123" });
  const token = reg.json?.token;
  const uid = (await pool.query("SELECT id FROM users WHERE email=$1", [email])).rows[0]?.id;

  // 1) 未登录 → 401
  const anon = await req("POST", "/api/admin/import-news", ITEMS);
  assert(anon.status === 401, "未登录 → 401");

  // 2) 普通用户 → 403
  const normal = await req("POST", "/api/admin/import-news", ITEMS, token);
  assert(normal.status === 403, "普通用户 → 403", "status=" + normal.status);

  // 3) 提升 admin → 导入成功
  await pool.query("UPDATE users SET role='admin' WHERE id=$1", [uid]);
  const admin = await req("POST", "/api/admin/import-news", ITEMS, token);
  assert(admin.status === 200 && admin.json?.ok, "admin 导入成功", "status=" + admin.status);
  assert(admin.json?.inserted === 3, "插入 3 条", "inserted=" + admin.json?.inserted);

  // 4) DB 校验：locale=zh + is_domestic=true
  const db = await pool.query(
    "SELECT count(*)::int AS n FROM hotnews WHERE locale='zh' AND is_domestic=true AND title LIKE $1",
    ["%运营投喂测试%"],
  );
  assert(db.rows[0].n === 3, "DB 落库 3 条（zh + is_domestic=true）", "n=" + db.rows[0].n);

  // 5) 重复投喂 → 去重跳过（Jaccard/唯一索引）
  const again = await req("POST", "/api/admin/import-news", ITEMS, token);
  assert(again.json?.inserted === 0, "重复投喂被去重（inserted=0）", "inserted=" + again.json?.inserted);

  // 6) 非法入参
  const bad = await req("POST", "/api/admin/import-news", [{ noTitle: 1 }], token);
  assert(bad.status === 400, "非法入参 → 400");
  const badEmpty = await req("POST", "/api/admin/import-news", [], token);
  assert(badEmpty.status === 400, "空数组 → 400");

  // 清理
  await pool.query("DELETE FROM hotnews WHERE title LIKE '%运营投喂测试%'");
  await pool.query("DELETE FROM points_log WHERE user_id=$1", [uid]);
  await pool.end();
  console.log(`\nRESULT: ${pass} passed, ${fail} failed ${fail === 0 ? "ALL PASS" : "FAILED"}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(2);
});
