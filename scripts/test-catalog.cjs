// Test catalog + synthesize + description PATCH against a base URL.
const BASE = process.argv[2] || "http://localhost:3100";

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
  console.log("login=" + login.status);

  // catalog all
  const cat = await req("GET", "/api/pets/catalog?limit=5", null, token);
  console.log("catalog=" + cat.status + " count=" + cat.json?.count + " categories=" + JSON.stringify(cat.json?.categories));
  console.log("  sample=" + JSON.stringify(cat.json?.pets?.[0]).slice(0, 200));

  // category filter
  const catF = await req("GET", "/api/pets/catalog?category=" + encodeURIComponent("猫科") + "&limit=3", null, token);
  console.log("catalog[猫科]=" + catF.status + " count=" + catF.json?.count + " allCat=" + catF.json?.pets?.every((p) => p.category === "猫科"));

  // rarity filter (GIN)
  const rar = await req("GET", "/api/pets/catalog?rarity=legendary&limit=3", null, token);
  console.log("catalog[rarity=legendary]=" + rar.status + " count=" + rar.json?.count + " allRare=" + rar.json?.pets?.every((p) => p.traits?.rarity === "legendary"));

  // synthesize a pet
  const syn = await req("POST", "/api/pets/synthesize", {}, token);
  const petId = syn.json?.pet?.id;
  console.log("synthesize=" + syn.status + " petId=" + petId + " desc=" + JSON.stringify(syn.json?.pet?.defaultDescription).slice(0, 60));

  // PATCH description（id 含 #，URL 需编码）
  const enc = encodeURIComponent(petId);
  const patch1 = await req("PATCH", `/api/pets/${enc}/description`, { description: "我家的高冷雪豹大人" }, token);
  console.log("PATCH set=" + patch1.status + " custom=" + JSON.stringify(patch1.json?.customDescription) + " restored=" + patch1.json?.restoredDefault);

  // PATCH empty -> restore default
  const patch2 = await req("PATCH", `/api/pets/${enc}/description`, { description: "   " }, token);
  console.log("PATCH clear=" + patch2.status + " custom=" + JSON.stringify(patch2.json?.customDescription) + " restored=" + patch2.json?.restoredDefault + " default=" + JSON.stringify(patch2.json?.defaultDescription).slice(0, 50));

  // PATCH over 50 chars -> 400
  const patch3 = await req("PATCH", `/api/pets/${enc}/description`, { description: "x".repeat(60) }, token);
  console.log("PATCH 60chars=" + patch3.status + " (expect 400)");

  // PATCH other user's pet -> 403
  const loginB = await req("POST", "/api/auth/login", { email: "reg_b_8623424@test.aiabw", password: "perfpass123" });
  const patch4 = await req("PATCH", `/api/pets/${enc}/description`, { description: "hijack" }, loginB.json?.token);
  console.log("PATCH other-user=" + patch4.status + " (expect 403)");
})().catch((e) => { console.error("FATAL: " + e.message); process.exit(2); });
