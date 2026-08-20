// Probe pay/create with amount 9.9 vs 0.01 to see the XorPay error.
const BASE = "https://www.aiabw.com";
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
  const login = await req("POST", "/api/auth/login", { email: "qapay_6969222@test.aiabw", password: "qapass2026" });
  const token = login.json?.token;
  console.log("login status=" + login.status + " ok=" + !!token);
  if (!token) return;
  const adopt = await req("POST", "/api/adopt", { petType: "dog" }, token);
  console.log("adopt status=" + adopt.status + " needPayment=" + adopt.json?.needPayment + " unlockId=" + adopt.json?.unlockAdoptionId);
  const uid = adopt.json?.unlockAdoptionId;
  if (!uid) return;
  for (const amount of [9.9, 0.01, 1]) {
    const pay = await req("POST", "/api/pay/create", { adoptionId: uid, amount }, token);
    console.log("pay amount=" + amount + " status=" + pay.status + " body=" + JSON.stringify(pay.json || pay.text).slice(0, 220));
  }
})().catch((e) => { console.error("FATAL: " + e.message); process.exit(2); });
