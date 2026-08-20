// Test POST /api/pets/synthesize against a base URL (local or live).
const BASE = process.argv[2] || "http://localhost:3100";
const EMAIL = process.argv[3] || "qapay_6969222@test.aiabw";

async function req(method, p, body, token) {
  const r = await fetch(BASE + p, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, json: j, text: t };
}

(async () => {
  const login = await req("POST", "/api/auth/login", { email: EMAIL, password: "qapass2026" });
  const token = login.json?.token;
  console.log("login=" + login.status + " token=" + !!token);
  if (!token) return;

  // 无 token -> 401
  const noAuth = await req("POST", "/api/pets/synthesize", {});
  console.log("synthesize no-auth=" + noAuth.status + " (expect 401)");

  const t0 = Date.now();
  const r = await req("POST", "/api/pets/synthesize", {}, token);
  const ms = Date.now() - t0;
  console.log("synthesize=" + r.status + " ms=" + ms + " ownedCount=" + r.json?.ownedCount);
  console.log("pet=" + JSON.stringify(r.json?.pet).slice(0, 320));

  // 二次调用应分配另一只（ownedCount=1）
  const r2 = await req("POST", "/api/pets/synthesize", {}, token);
  console.log("synthesize#2=" + r2.status + " ownedCount=" + r2.json?.ownedCount + " id2=" + r2.json?.pet?.id);
})().catch((e) => { console.error("FATAL: " + e.message); process.exit(2); });
