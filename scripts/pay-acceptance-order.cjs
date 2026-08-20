// Global-launch final acceptance - REAL money payment path against production.
// Step 1: create a fresh test user, adopt pet #1, then pet #2 must hit 402 (PET_LIMIT_REACHED).
// Step 2: create a REAL XorPay 0.01 CNY order and print the cashier URL + QR content.
// Step 3 (manual): open the PAY URL / scan the QR, complete the 0.01 payment.
// Step 4: node scripts/pay-acceptance-check.cjs <email>  -> verify notify callback unlocked everything.
// Usage: node scripts/pay-acceptance-order.cjs
const fs = require("fs");
const path = require("path");
const { Pool } = require("@neondatabase/serverless");

const BASE = "https://www.aiabw.com";
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
const m = env.match(/^DATABASE_URL=(.*)$/m);
const DATABASE_URL = m ? m[1].trim() : "";
const pool = new Pool({ connectionString: DATABASE_URL });

async function req(method, apiPath, body, token) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 45000);
  try {
    const res = await fetch(BASE + apiPath, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, text };
  } finally { clearTimeout(t); }
}

(async () => {
  const ts = Date.now().toString().slice(-7);
  const email = `realpay_${ts}@test.aiabw`;
  const password = "realpaypass123";
  console.log("==========================================");
  console.log("STEP 1/2 · REAL PAYMENT ACCEPTANCE ORDER");
  console.log("BASE     : " + BASE);
  console.log("ACCOUNT  : " + email);
  console.log("PASSWORD : " + password);
  console.log("==========================================");

  let r = await req("POST", "/api/auth/register", { email, password });
  if (r.status !== 200 || !r.json?.ok) { console.log("FAIL register: " + r.status + " " + JSON.stringify(r.json || r.text).slice(0, 200)); process.exit(1); }
  const token = r.json.token;
  console.log("1. register            : OK");

  r = await req("POST", "/api/adopt", { petType: "fox" }, token);
  if (!r.json?.ok) { console.log("FAIL adopt#1: " + JSON.stringify(r.json)); process.exit(1); }
  const pet1Id = r.json.adoption.id;
  console.log("2. adopt#1 fox         : OK  adoptionId=" + pet1Id);

  r = await req("POST", "/api/adopt", { petType: "dog" }, token);
  console.log("3. adopt#2 dog         : status=" + r.status + " code=" + r.json?.code + " needPayment=" + r.json?.needPayment);
  if (r.status !== 402 || r.json?.code !== "PET_LIMIT_REACHED" || !r.json?.needPayment) {
    console.log("FAIL: 402 precondition not met: " + JSON.stringify(r.json || r.text).slice(0, 200));
    process.exit(1);
  }
  const unlockId = r.json.unlockAdoptionId;
  console.log("   unlockAdoptionId    : " + unlockId);

  // 校验 unlockAdoptionId 就是第 1 只宠物（支付目标是已有宠物）
  const { rows: urows } = await pool.query(
    `SELECT id, pet_type, pet_name FROM adoptions WHERE id = $1`, [unlockId],
  );
  console.log("   unlock target pet   : " + (urows[0]?.pet_type ?? "?") + " / " + (urows[0]?.pet_name ?? "?") + " (expect the pet above)");

  r = await req("POST", "/api/pay/create", { adoptionId: unlockId, amount: 0.01 }, token);
  console.log("4. pay/create 0.01     : status=" + r.status + " ok=" + r.json?.ok);
  if (r.status !== 200 || !r.json?.qr) {
    console.log("FAIL pay/create: " + JSON.stringify(r.json || r.text).slice(0, 300));
    process.exit(1);
  }
  console.log("   orderId             : " + r.json.orderId);
  console.log("   payType             : " + r.json.payType);
  console.log("   amount              : " + r.json.amount);
  fs.writeFileSync(path.join(__dirname, "_realpay.qr.txt"), r.json.qr, "utf8");
  fs.writeFileSync(path.join(__dirname, "_realpay.order.txt"), JSON.stringify({ email, orderId: r.json.orderId, payUrl: r.json.payUrl, qr: r.json.qr }, null, 2), "utf8");
  console.log("==========================================");
  console.log("PAY URL  : " + (r.json.payUrl ?? "(none - scan QR)"));
  console.log("QR TEXT  : " + r.json.qr);
  console.log("------------------------------------------");
  console.log("=> Open the PAY URL in a browser (or scan the QR with 支付宝/微信), pay 0.01 CNY.");
  console.log("=> After paying, run:  node scripts/pay-acceptance-check.cjs " + email);
  console.log("==========================================");
  await pool.end();
})().catch((e) => { console.error("FATAL: " + e.message); process.exit(2); });
