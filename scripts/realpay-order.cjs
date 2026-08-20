// QA Step 1 - real 0.01 CNY XorPay order (user scans & pays). Test rows are NOT cleaned (user pays after).
// Usage: node scripts/realpay-order.cjs
const fs = require("fs");
const path = require("path");
const BASE = "https://www.aiabw.com";

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
  const email = "qapay_" + ts + "@test.aiabw";
  const password = "qapass2026";
  console.log("TEST_ACCOUNT_EMAIL=" + email);
  console.log("TEST_ACCOUNT_PASSWORD=" + password);

  let r = await req("POST", "/api/auth/register", { email, password });
  if (r.status !== 200 || !r.json?.ok) { console.log("FAIL register: " + r.status + " " + JSON.stringify(r.json || r.text)); process.exit(1); }
  const token = r.json.token;

  r = await req("POST", "/api/adopt", { petType: "fox" }, token);
  console.log("adopt#1: " + r.status + (r.json?.ok ? " OK" : " " + JSON.stringify(r.json)));
  if (!r.json?.ok) process.exit(1);

  r = await req("POST", "/api/adopt", { petType: "dog" }, token);
  console.log("adopt#2(expect 402): " + r.status + " code=" + r.json?.code + " needPayment=" + r.json?.needPayment + " unlockAdoptionId=" + r.json?.unlockAdoptionId);
  if (r.status !== 402 || !r.json?.needPayment) { console.log("FAIL: 402 precondition not met"); process.exit(1); }

  r = await req("POST", "/api/pay/create", { adoptionId: r.json.unlockAdoptionId, amount: 0.01 }, token);
  console.log("pay/create: " + r.status + " ok=" + r.json?.ok + " orderId=" + r.json?.orderId + " payType=" + r.json?.payType);
  if (r.status !== 200 || !r.json?.qr) { console.log("FAIL pay/create: " + JSON.stringify(r.json || r.text).slice(0, 300)); process.exit(1); }
  fs.writeFileSync(path.join(__dirname, "_realpay.qr.txt"), r.json.qr);
  console.log("QR_CONTENT=" + r.json.qr);
  console.log("saved QR content to scripts/_realpay.qr.txt");
})().catch((e) => { console.error("FATAL: " + e.message); process.exit(2); });
