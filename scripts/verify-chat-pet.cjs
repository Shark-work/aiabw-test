// 聊天页宠物解析 E2E（本地 dev server）—— 防「领养后聊天页显示默认抱抱狐」回归：
//  1) 游客零摩擦领养 → /chat?thread=X&adopt=Y 渲染真实物种（Lv.1 物种名，非抱抱狐）
//  2) /chat?thread=X（丢 adopt 参数）→ 按线程反查领养记录，仍显示真实物种
//  3) /chat?thread=X&adopt=undefined（非法 UUID 参数）→ 不 500，仍显示真实物种
//  4) /threads/X（旧线程直达页）→ 30x 重定向到 /chat?thread=X，落点显示真实物种
// Usage: node scripts/verify-chat-pet.cjs http://localhost:3000
const fs = require("fs");
const path = require("path");
const { Pool } = require("@neondatabase/serverless");

const BASE = process.argv[2] || "http://localhost:3000";
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
const DATABASE_URL = (env.match(/^DATABASE_URL=(.*)$/m) || [])[1]?.trim();
const pool = new Pool({ connectionString: DATABASE_URL, max: 2 });

let pass = 0;
let fail = 0;
function assert(cond, label, extra = "") {
  if (cond) {
    pass++;
    console.log("  PASS " + label);
  } else {
    fail++;
    console.log("  FAIL " + label + (extra ? "  " + extra : ""));
  }
}

async function req(apiPath, body) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(BASE + apiPath, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      redirect: "follow",
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, json, text };
  } finally {
    clearTimeout(t);
  }
}

// React SSR 会在相邻文本节点间插入 <!-- --> 注释（Lv.1<!-- --> <!-- -->名字），
// 断言前剥离，保证「Lv.1 物种名」可被字符串匹配。
const clean = (s) => s.replace(/<!--[\s\S]*?-->/g, "");

(async () => {
  const anon = "verify-chat-pet-" + Date.now();

  // ---- 0) 图鉴数据源：取 1 只未领养宠物 ----
  const cat = await req("/api/pets/catalog?limit=60");
  assert(cat.status === 200 && cat.json?.ok, "图鉴接口可用", "status=" + cat.status);
  const pet = (cat.json?.pets || []).find((p) => !p.owned);
  assert(!!pet, "图鉴池有未领养宠物");

  // ---- 1) 游客零摩擦领养（与线上用户「点击领养」同一路径）----
  const claim = await req("/api/pets/claim", { petId: pet.id, anonymousId: anon });
  assert(claim.status === 200 && claim.json?.ok, "游客领养成功", "status=" + claim.status);
  const threadId = claim.json?.threadId;
  const adoptionId = claim.json?.adoption?.id;
  const speciesName = claim.json?.pet?.speciesName || "";
  assert(!!threadId && !!adoptionId, "返回 threadId + adoption.id");
  assert(
    /^species:/.test(claim.json?.adoption?.petType || ""),
    "adoption.petType 编码为 species:<id>",
    "petType=" + claim.json?.adoption?.petType,
  );

  // ---- 2) 正常链路：/chat?thread=X&adopt=Y → 显示真实物种 ----
  const ok = await req(`/zh/chat?thread=${threadId}&adopt=${adoptionId}`);
  const okText = clean(ok.text);
  assert(ok.status === 200, "聊天页 200", "status=" + ok.status);
  assert(okText.includes(`Lv.1 ${speciesName}`), `聊天页渲染真实物种「${speciesName}」`);
  assert(!okText.includes("Lv.1 抱抱狐"), "未退回默认抱抱狐");

  // ---- 3) 兜底链路：丢 adopt 参数 → 按线程反查领养记录 ----
  const noAdopt = await req(`/zh/chat?thread=${threadId}`);
  assert(
    noAdopt.status === 200 && clean(noAdopt.text).includes(`Lv.1 ${speciesName}`),
    "丢 adopt 参数仍显示真实物种（线程反查兜底）",
    "status=" + noAdopt.status,
  );

  // ---- 4) 防御链路：非法 UUID 参数不 500 ----
  const bad = await req(`/zh/chat?thread=${threadId}&adopt=undefined`);
  assert(
    bad.status === 200 && clean(bad.text).includes(`Lv.1 ${speciesName}`),
    "非法 adopt 参数不 500 且显示真实物种",
    "status=" + bad.status,
  );

  // ---- 5) 旧线程直达页 → 30x 到 /chat?thread=X ----
  const old = await fetch(`${BASE}/zh/threads/${threadId}`, { redirect: "manual" });
  const loc = old.headers.get("location") || "";
  assert(
    [301, 302, 307, 308].includes(old.status) && loc.includes(`/chat?thread=${threadId}`),
    "旧线程页重定向到 /chat?thread=<id>",
    `status=${old.status} location=${loc}`,
  );
  const oldFollow = await req(`/zh/threads/${threadId}`);
  assert(clean(oldFollow.text).includes(`Lv.1 ${speciesName}`), "重定向落点显示真实物种");

  console.log(`\n结果: ${pass} passed, ${fail} failed`);

  // ---- 清理测试数据（按 anonymous_id 反查）----
  try {
    await pool.query(
      `DELETE FROM messages WHERE thread_id IN (SELECT id FROM threads WHERE anonymous_id = $1)`,
      [anon],
    );
    await pool.query(`DELETE FROM adoptions WHERE anonymous_id = $1`, [anon]);
    await pool.query(`DELETE FROM threads WHERE anonymous_id = $1`, [anon]);
    await pool.query(
      `UPDATE pets SET guest_owner = NULL, adopted_at = NULL, last_interaction_time = NULL WHERE guest_owner = $1`,
      [anon],
    );
    console.log("  清理完成（anonymous_id=" + anon + "）");
  } catch (e) {
    console.log("  清理失败: " + e.message);
  }
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error("E2E 执行异常:", e);
  process.exit(1);
});
