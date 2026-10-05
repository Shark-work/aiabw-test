/**
 * P1 故事外显 · 新手引导「唤醒仪式」契约测试（2026-10-14）
 *
 * 覆盖（改动一验收口径）：
 *  1) 数据层：users.onboarding_completed（drizzle/0031 + SCHEMA_ALTERS + SCHEMA_VERSION=16 + schema.ts）；
 *  2) GET /api/onboarding：鉴权 401 + completed/hasPet 聚合 + candidate 可领养口径（与 /api/pets/claim 一致）；
 *  3) POST /api/onboarding：完成标记置 true（幂等 UPDATE）；
 *  4) POST /api/onboarding/name：归属行内校验 + 24 字上限 + soul_cards 卡名同步；
 *  5) /onboarding 页面：noindex + OnboardingWizard 挂载；
 *  6) wizard 三步流：claim 复用 / 410 重拉 / finalize 双目的地 / 完成标记；
 *  7) 叙事约束：引导全程无「铸造 / mint / 链上」表述（组件 + i18n 双语扫描）；
 *  8) 首页沉睡 banner：挂载 + 数据源 + 展示条件（!completed && !hasPet）；
 *  9) 注册默认跳转 /onboarding（显式 redirect 参数优先）；
 * 10) i18n：onboarding 命名空间 zh/en 关键 key 对齐 + api 3 个新错误码。
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const exists = (p) => existsSync(join(ROOT, p));
const zh = JSON.parse(read("messages/zh.json"));
const en = JSON.parse(read("messages/en.json"));

// === 1) 数据层：onboarding_completed 列 ===
test("onboarding: users.onboarding_completed wired (drizzle/0031 + SCHEMA_ALTERS + v16 + schema.ts)", () => {
  const sql = read("drizzle/0031_onboarding.sql");
  assert.ok(exists("drizzle/0031_onboarding.sql"), "migration file exists");
  assert.ok(
    sql.includes(
      'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "onboarding_completed" boolean DEFAULT false NOT NULL',
    ),
    "idempotent ADD COLUMN",
  );

  const client = read("src/db/client.ts");
  // 版本号随后续迭代递增（P2 已至 v17）→ 锁「v16 已引入」而非当前版本值
  assert.match(client, /const SCHEMA_VERSION = (1[6-9]|[2-9]\d)/, "SCHEMA_VERSION >= 16");
  assert.ok(client.includes("v16: P1 故事外显"), "v16 changelog comment");
  assert.ok(
    client.includes(
      'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "onboarding_completed" boolean DEFAULT false NOT NULL',
    ),
    "SCHEMA_ALTERS has column",
  );

  const schema = read("src/db/schema.ts");
  assert.ok(
    schema.includes("onboardingCompleted: boolean('onboarding_completed')"),
    "schema.ts field",
  );
});

// === 2) GET /api/onboarding：状态 + 候选灵宠 ===
test("onboarding api: GET returns completed/hasPet/candidate with claim-compatible availability", () => {
  const c = read("src/app/api/onboarding/route.ts");
  assert.ok(c.includes("export async function GET"), "GET handler");
  assert.ok(c.includes("export async function POST"), "POST handler (complete)");
  assert.ok(c.includes("getUserFromRequest(req)"), "auth via bearer");
  assert.ok(c.includes("{ status: 401 }"), "unauthenticated 401");
  assert.ok(c.includes("u.onboarding_completed"), "reads completed flag");
  assert.ok(
    c.includes("EXISTS(SELECT 1 FROM adoptions a WHERE a.user_id = u.id::text)"),
    "hasPet via adoptions EXISTS（u.id::text cast：adoptions.user_id 为 text 列，混合类型库必须显式 cast，对齐 admin/users 惯例）",
  );
  // candidate 可领养口径与 /api/pets/claim 一致（visible + 无 owner/guest_owner）
  assert.ok(c.includes("p.visible = true"), "candidate visible only");
  assert.ok(c.includes("p.owner_id IS NULL"), "candidate unowned");
  assert.ok(c.includes("p.guest_owner IS NULL"), "candidate not guest-held");
  assert.ok(/ORDER BY random\(\)\s+LIMIT 1/.test(c), "random single candidate");
  // 老用户短路：completed || hasPet 时不查 candidate
  assert.ok(c.includes("if (!completed && !hasPet)"), "candidate gated by !completed && !hasPet");
});

// === 3) POST /api/onboarding：完成标记幂等 ===
test("onboarding api: POST marks completed idempotently", () => {
  const c = read("src/app/api/onboarding/route.ts");
  assert.ok(
    c.includes('UPDATE users SET onboarding_completed = true WHERE id = $1'),
    "idempotent UPDATE (repeat calls converge)",
  );
  assert.ok(c.includes("completed: true"), "response confirms completed");
});

// === 4) POST /api/onboarding/name：起名（归属校验 + 卡名同步） ===
test("onboarding name api: ownership check + 24-char cap + soul card name sync", () => {
  const c = read("src/app/api/onboarding/name/route.ts");
  assert.ok(c.includes("PET_NAME_MAX = 24"), "24-char cap (aligned with soul card mint)");
  assert.ok(
    c.includes("UPDATE adoptions SET pet_name = $3 WHERE id = $1 AND user_id = $2"),
    "ownership enforced in UPDATE",
  );
  assert.ok(c.includes("if (!rowCount)"), "404 when adoption not owned");
  assert.ok(
    c.includes("WHERE pet_id = $1 AND owner_id = $2"),
    "soul card name sync scoped to owner+pet",
  );
  assert.ok(/UPDATE soul_cards SET name/.test(c), "card name follows pet name");
});

// === 5) /onboarding 页面：noindex + wizard 挂载 ===
test("onboarding page: noindex + wizard mounted", () => {
  const p = read("src/app/[locale]/onboarding/page.tsx");
  assert.ok(exists("src/app/[locale]/onboarding/page.tsx"), "page exists");
  assert.ok(p.includes("OnboardingWizard"), "wizard mounted");
  assert.ok(
    p.includes("robots: { index: false, follow: false }"),
    "noindex (flow page not for sharing/SEO)",
  );
});

// === 6) wizard 三步流：claim 复用 / 410 重拉 / 双目的地 / 完成标记 ===
test("onboarding wizard: 3-step flow reuses claim, handles 410, dual destinations", () => {
  const w = read("src/components/onboarding/onboarding-wizard.tsx");
  // 三步相态
  for (const phase of ['"meet"', '"awaken"', '"awakened"', '"journey"']) {
    assert.ok(w.includes(phase), `phase ${phase}`);
  }
  // Step2 唤醒复用 P0 claim 链路（领养 + 自动生成灵魂凭证）
  assert.ok(w.includes('fetch("/api/pets/claim"'), "awaken via /api/pets/claim");
  assert.ok(w.includes("body: JSON.stringify({ petId: candidate.petId })"), "claim by petId");
  // 410（被抢先唤醒）→ 重新拉候选回到 Step1
  assert.ok(w.includes("res.status === 410"), "410 branch");
  assert.ok(/410[\s\S]{0,300}?bootstrap\(\)/.test(w), "410 refetches candidate");
  // 编号展示（全球唯一编号）
  assert.ok(w.includes("certificateNo"), "shows certificate number");
  // Step3：起名 + 完成标记 + 双目的地（对话 / 探索）
  assert.ok(w.includes('fetch("/api/onboarding/name"'), "name submit");
  assert.ok(
    /fetch\("\/api\/onboarding",\s*\{\s*method: "POST"/.test(w),
    "completion marker POST",
  );
  assert.ok(w.includes("`/chat?thread=${claim.threadId}&adopt=${claim.adoptionId}`"), "chat dest");
  assert.ok(w.includes('"/explore-v2"'), "explore dest");
  // 老用户/已完成直达首页；无 token 引导登录回跳
  assert.ok(w.includes('router.replace("/")'), "completed/hasPet → home");
  assert.ok(w.includes('"/login?redirect=/onboarding"'), "guest → login with redirect back");
});

// === 7) 叙事约束：引导全程无「铸造 / mint / 链上」 ===
test("onboarding narrative: no mint/on-chain wording in wizard+banner+i18n", () => {
  const files = [
    "src/components/onboarding/onboarding-wizard.tsx",
    "src/components/onboarding/onboarding-banner.tsx",
    "src/app/[locale]/onboarding/page.tsx",
  ];
  for (const f of files) {
    const c = read(f);
    for (const banned of ["铸造", "mint", "Mint", "MINT", "链上", "blockchain", "Blockchain"]) {
      assert.ok(!c.includes(banned), `${f} must not contain 「${banned}」`);
    }
  }
  // i18n onboarding 命名空间双语扫描
  const zhNs = JSON.stringify(zh.onboarding);
  const enNs = JSON.stringify(en.onboarding);
  for (const banned of ["铸造", "链上"]) {
    assert.ok(!zhNs.includes(banned), `zh.onboarding must not contain 「${banned}」`);
  }
  for (const banned of ["mint", "Mint", "blockchain", "on-chain", "onchain"]) {
    assert.ok(!enNs.includes(banned), `en.onboarding must not contain 「${banned}」`);
  }
  // 叙事正向词存在（唤醒 / 全球唯一编号）
  assert.ok(zhNs.includes("唤醒"), "zh uses 「唤醒」");
  assert.ok(zhNs.includes("全球唯一编号"), "zh uses 「全球唯一编号」");
  assert.ok(enNs.includes("waken") || enNs.includes("wak"), "en uses awaken wording");
});

// === 8) 首页沉睡 banner ===
test("onboarding banner: mounted on home, shows only when !completed && !hasPet", () => {
  const home = read("src/app/[locale]/page.tsx");
  assert.ok(
    home.includes('import { OnboardingBanner } from "@/components/onboarding/onboarding-banner"'),
    "import",
  );
  assert.ok(home.includes("<OnboardingBanner />"), "mounted");

  const b = read("src/components/onboarding/onboarding-banner.tsx");
  assert.ok(b.includes('fetch("/api/onboarding"'), "status source");
  assert.ok(
    b.includes("d?.ok && !d.completed && !d.hasPet"),
    "visible only when ritual unfinished and no pet",
  );
  assert.ok(b.includes('href="/onboarding"'), "tap continues ritual");
  // 未登录不拉取（无 token 直接 return，banner 不渲染）
  assert.ok(b.includes('localStorage.getItem("aiabw_token")'), "token gate");
});

// === 9) 注册默认跳转 /onboarding（显式 redirect 优先） ===
test("register: new users default to /onboarding, explicit redirect wins", () => {
  const r = read("src/app/[locale]/register/page.tsx");
  assert.ok(
    r.includes('get("redirect") ||\n        "/onboarding"'),
    "default redirect → /onboarding",
  );
  assert.ok(r.includes("router.push(redirect)"), "explicit redirect still honored");
});

// === 10) i18n：onboarding 命名空间 + api 新错误码（zh/en 对齐） ===
test("onboarding i18n: namespace + api error keys aligned zh/en", () => {
  for (const dict of [zh, en]) {
    assert.ok(dict.onboarding, "onboarding namespace");
    for (const ns of ["meet", "awaken", "awakened", "journey", "banner", "empty"]) {
      assert.ok(dict.onboarding[ns], `onboarding.${ns}`);
    }
    assert.ok(dict.onboarding.metaTitle, "metaTitle");
    assert.ok(dict.onboarding.stepOf.includes("{step}"), "stepOf interpolation");
    assert.ok(dict.onboarding.journey.choiceHint.includes("{name}"), "choiceHint interpolation");
    // api 新错误码
    for (const k of ["petNameInvalid", "adoptionNotFound", "onboardingFailed"]) {
      assert.ok(dict.api[k], `api.${k}`);
    }
  }
  // 三步标题存在且语义对齐
  assert.ok(zh.onboarding.meet.title.includes("遇"), "zh step1 meet");
  assert.ok(zh.onboarding.journey.title.includes("启"), "zh step3 journey");
  assert.equal(en.onboarding.awakened.certLabel, "Globally unique ID", "en cert label");
});

