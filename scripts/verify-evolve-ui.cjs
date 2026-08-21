// Browser E2E for the evolution UI on the dictionary page + my-pets banner.
// 1) assign 3 unowned same-species/same-rarity pets to qapay_6969222 via SQL
// 2) /zh/my-pets: check evolve banner
// 3) /zh/pets?mine=1: check "可进化" badge, click -> picker modal -> click evolve
// 4) fusion animation plays (.fuse-l) then result panel with upgraded rarity
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");
const { Pool } = require("@neondatabase/serverless");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = process.argv[2] || "http://localhost:3100";
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
const url = (env.match(/^DATABASE_URL=(.*)$/m) || [])[1]?.trim();
const pool = new Pool({ connectionString: url, max: 2 });

(async () => {
  // 1) 优先复用 qapay 已有的同组宠物；没有则分配 3 只未领养同组
  let { rows: trio } = await pool.query(
    `SELECT p.id, p.species_id, p.traits->>'rarity' AS rarity
       FROM pets p WHERE p.owner_id=(SELECT id FROM users WHERE email=$1)
        AND p.status='active'
      GROUP BY p.id, p.species_id, p.traits
      HAVING (SELECT count(*) FROM pets p2 WHERE p2.species_id=p.species_id
                AND p2.traits->>'rarity'=p.traits->>'rarity'
                AND p2.owner_id=(SELECT id FROM users WHERE email=$1)
                AND p2.status='active') >= 3
      LIMIT 3`,
    ["qapay_6969222@test.aiabw"],
  );
  if (trio.length < 3) {
    const { rows: fresh } = await pool.query(
      `SELECT p.id, p.species_id, p.traits->>'rarity' AS rarity
         FROM pets p WHERE p.owner_id IS NULL AND p.status='active'
        GROUP BY p.id, p.species_id, p.traits
        ORDER BY (SELECT count(*) FROM pets p2 WHERE p2.species_id=p.species_id
                  AND p2.traits->>'rarity'=p.traits->>'rarity' AND p2.owner_id IS NULL) DESC
        LIMIT 3`,
    );
    trio = fresh;
    if (trio.length < 3) { console.log("no trio available"); process.exit(2); }
    await pool.query(
      `UPDATE pets SET owner_id=(SELECT id FROM users WHERE email=$1), adopted_at=now()
        WHERE id = ANY($2)`,
      ["qapay_6969222@test.aiabw", trio.map((t) => t.id)],
    );
  }
  console.log("trio:", trio.map((t) => t.id).join(","), trio[0].species_id, trio[0].rarity);

  const login = await fetch(BASE + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "qapay_6969222@test.aiabw", password: "qapass2026" }),
  }).then((r) => r.json());
  if (!login?.token) { console.log("login failed"); process.exit(2); }

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  let crashed = false;

  // 2) my-pets 横幅
  const mp = await browser.newPage();
  await mp.setViewport({ width: 1440, height: 900 });
  mp.on("pageerror", () => { crashed = true; });
  await mp.goto(BASE + "/zh", { waitUntil: "domcontentloaded", timeout: 30000 });
  await mp.evaluate((tk) => localStorage.setItem("aiabw_token", tk), login.token);
  await mp.goto(BASE + "/zh/my-pets", { waitUntil: "domcontentloaded", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2500));
  const banner = await mp.evaluate(() => document.body.innerText.includes("融合进化") || document.body.innerText.includes("fusing"));
  console.log("my-pets evolve banner:", banner);
  await mp.close();

  // 3) 图鉴 mine 视图
  const pg = await browser.newPage();
  await pg.setViewport({ width: 1440, height: 900 });
  pg.on("pageerror", () => { crashed = true; });
  await pg.goto(BASE + "/zh", { waitUntil: "domcontentloaded", timeout: 30000 });
  await pg.evaluate((tk) => localStorage.setItem("aiabw_token", tk), login.token);
  await pg.goto(BASE + "/zh/pets?mine=1", { waitUntil: "domcontentloaded", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 6000));

  const badge = await pg.evaluate(() => {
    const t = document.body.innerText;
    const b = Array.from(document.querySelectorAll("button")).find((x) => x.innerText.includes("可进化"));
    if (b) { b.click(); return { ok: true }; }
    return {
      ok: false,
      hasText: t.includes("可进化"),
      hasGolden: t.includes("#2F0D16"),
      btnCount: document.querySelectorAll("button").length,
      textHead: t.slice(0, 120),
    };
  });
  console.log("badge:", JSON.stringify(badge));
  await new Promise((r) => setTimeout(r, 800));
  const picker = await pg.evaluate(() => {
    const txt = document.body.innerText;
    return { hasPicker: txt.includes("选择") || txt.includes("将消耗"), selected: (txt.match(/✓/g) || []).length };
  });
  console.log("evolve badge:", badge, "picker:", JSON.stringify(picker));

  // 4) 点融合 → 动画 → 结果
  const clicked = await pg.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((x) => x.innerText.trim() === "融合进化");
    if (!btn) return false;
    btn.click();
    return true;
  });
  await new Promise((r) => setTimeout(r, 800));
  const anim = await pg.evaluate(() => ({
    fuseClass: !!document.querySelector(".fuse-l, .fuse-m, .fuse-r"),
    evolvingText: document.body.innerText.includes("融合中"),
  }));
  console.log("fusion anim:", JSON.stringify(anim));

  await new Promise((r) => setTimeout(r, 3500));
  const result = await pg.evaluate(() => {
    const txt = document.body.innerText;
    const newPet = (txt.match(/#[0-9A-F]{6}/g) || []).slice(-1)[0];
    return { success: txt.includes("进化成功"), rare: /稀有|rare/i.test(txt), newId: newPet ?? null };
  });
  console.log("result:", JSON.stringify(result));

  console.log("crashed:", crashed);
  const pass = banner && badge && picker.hasPicker && anim.fuseClass && anim.evolvingText && result.success;
  console.log("RESULT: " + (pass ? "PASS ✅" : "FAIL ❌"));
  await browser.close();
  await pool.end();
  process.exit(pass ? 0 : 2);
})().catch((e) => { console.error("FATAL: " + (e && e.stack || e.message)); process.exit(2); });
