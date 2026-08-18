// Final real-money verification: create a persistent test user + pet + 0.01 CNY order.
// The user scans the QR / opens the payUrl to complete the payment, then we re-check
// users.is_unlocked in the DB to confirm the REAL XorPay callback closed the loop.
const fs = require("fs");
const path = require("path");
const { Pool } = require("@neondatabase/serverless");

const BASE = "https://www.aiabw.com";
const env = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
const m = env.match(/^DATABASE_URL=(.*)$/m);
const DATABASE_URL = m ? m[1].trim() : "";

async function req(method, apiPath, body, token) {
  const res = await fetch(BASE + apiPath, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

(async () => {
  const ts = Date.now().toString().slice(-7);
  const email = `realpay_${ts}@test.aiabw`;
  const pool = new Pool({ connectionString: DATABASE_URL });

  let r = await req("POST", "/api/auth/register", { email, password: "realpaypass123" });
  const token = r.json?.token;
  console.log("TEST USER   :", email);
  console.log("register    :", r.status, r.json?.ok === true ? "OK" : "FAILED");

  r = await req("POST", "/api/adopt", { petType: "fox" }, token);
  const adoptionId = r.json?.adoption?.id;
  console.log("adopt #1    :", r.status, "adoptionId=" + adoptionId);

  r = await req("POST", "/api/pay/create", { adoptionId, amount: 0.01 }, token);
  console.log("pay/create  :", r.status, r.json?.ok === true ? "OK" : JSON.stringify(r.json));
  console.log("orderId     :", r.json?.orderId);
  console.log("payType     :", r.json?.payType);
  console.log("PAY URL     :", r.json?.payUrl);
  console.log("QR content  :", r.json?.qr);
  console.log("-------------------------------------");
  console.log("=> OPEN the PAY URL (or scan the QR with WeChat) and pay 0.01 CNY.");
  console.log("=> After payment, run:  node final-check.js " + email);
  await pool.end();
})().catch((e) => { console.error("FATAL:", e.message); process.exit(2); });
