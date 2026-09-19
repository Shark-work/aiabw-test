// 临时调试脚本：/api/chat 全链路复现（注册→领养→发消息→读流式回复）
// 分阶段执行以适配 30s 命令窗口（Neon 冷启动慢）：
//   node scripts/debug-chat-e2e.cjs prepare   → 注册+领养，状态存 scripts/.debug-chat-state.json
//   node scripts/debug-chat-e2e.cjs chat      → 复用状态，只调 /api/chat 并聚合流式回复
//   node scripts/debug-chat-e2e.cjs all       → 一条龙（本地无超时限制时用）
const fs = require("fs");
const path = require("path");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const STATE = path.join(__dirname, ".debug-chat-state.json");

async function req(apiPath, { method = "GET", token, body } = {}) {
  const res = await fetch(BASE + apiPath, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text: text.slice(0, 600) };
}

async function prepare() {
  const stamp = Date.now();
  const email = `debug-chat-${stamp}@example.com`;
  const reg = await req("/api/auth/register", { method: "POST", body: { email, password: "debug123456" } });
  console.log("[1] register:", reg.status, reg.json?.ok ? "ok" : reg.text);
  const token = reg.json?.token;
  if (!token) { console.log("FATAL: no token"); process.exit(1); }

  const cat = await req("/api/pets/catalog?limit=60");
  const candidates = (cat.json?.pets || []).filter((p) => !p.owned).slice(0, 10);
  console.log("[2] catalog:", cat.status, `candidates=${candidates.length}`);
  if (!candidates.length) process.exit(1);

  let adoptionId = null, petType = null;
  for (const pet of candidates) {
    const claim = await req("/api/pets/claim", { method: "POST", token, body: { petId: pet.id } });
    if (claim.status === 200 && claim.json?.ok) {
      adoptionId = claim.json?.adoption?.id;
      petType = claim.json?.adoption?.petType;
      console.log("[3] claim: 200 ok pet=" + pet.id);
      break;
    }
    console.log("[3] claim:", claim.status, "pet=" + pet.id, "(taken, next)");
  }
  if (!adoptionId) { console.log("FATAL: no adoptionId after all candidates"); process.exit(1); }

  fs.writeFileSync(STATE, JSON.stringify({ token, adoptionId, petType }, null, 2));
  console.log("    state saved:", STATE);
}

async function chat() {
  const { token, adoptionId, petType } = JSON.parse(fs.readFileSync(STATE, "utf8"));
  console.log("[4] POST /api/chat ...");
  const t0 = Date.now();
  const chatRes = await fetch(BASE + "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "你好呀，介绍一下你自己" }] }],
      petType,
      adoptionId,
    }),
  });
  console.log("    status:", chatRes.status, `(${Date.now() - t0}ms)`);
  console.log("    content-type:", chatRes.headers.get("content-type"));
  if (!chatRes.ok) {
    console.log("    ERROR BODY:", (await chatRes.text()).slice(0, 1000));
    process.exit(1);
  }
  const raw = await chatRes.text();
  let reply = "";
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const evt = JSON.parse(payload);
      if (evt.type === "text-delta" && typeof evt.delta === "string") reply += evt.delta;
      if (evt.type === "error") console.log("    STREAM ERROR EVENT:", JSON.stringify(evt).slice(0, 500));
    } catch {}
  }
  console.log("[5] AI reply length:", reply.length, `(${Date.now() - t0}ms total)`);
  console.log("    AI reply preview:", reply.slice(0, 300) || "(EMPTY!)");
  process.exit(reply ? 0 : 2);
}

const mode = process.argv[2] || "all";
(async () => {
  if (mode === "prepare") return await prepare();
  if (mode === "chat") return await chat();
  await prepare();
  await chat();
})().catch((e) => { console.error("E2E exception:", e); process.exit(1); });
