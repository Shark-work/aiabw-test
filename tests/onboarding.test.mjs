/**
 * P1 故事外显 · 新手引导「唤醒仪式」契约测试（2026-10-14；Phase 2 五步化 2026-10-16）
 *
 * 覆盖（改动一验收口径 + Phase 2 新手引导优化）：
 *  1) 数据层：users.onboarding_completed（drizzle/0031 + SCHEMA_ALTERS + SCHEMA_VERSION=16 + schema.ts）；
 *  2) GET /api/onboarding：鉴权 401 + completed/hasPet 聚合 + candidates 可领养口径（与 /api/pets/claim 一致，LIMIT 3 视觉化卡片）；
 *  3) POST /api/onboarding：完成标记置 true（false→true RETURNING 幂等）+ 首次完成 +10 积分（事务 points_log）；
 *  4) POST /api/onboarding/name：归属行内校验 + 24 字上限 + soul_cards 卡名同步；
 *  5) /onboarding 页面：noindex + OnboardingWizard 挂载；
 *  6) wizard 五步流：候选卡片 / claim 复用 / 410 重拉 / AI 建议名 / 奖励步 / 双目的地；
 *  7) 叙事约束：引导全程无「铸造 / mint / 链上」表述（组件 + i18n 双语扫描）；
 *  8) 首页沉睡 banner：挂载 + 数据源 + 展示条件（!completed && !hasPet）；
 *  9) 注册默认跳转 /onboarding（显式 redirect 参数优先）；
 * 10) i18n：onboarding 命名空间 zh/en 关键 key 对齐（含 naming/reward 新子空间）+ api 3 个新错误码；
 * 11) POST /api/onboarding/name-suggestions：AI 建议名（getModel 单点 + 预设池降级 + 鉴权）；
 * 12) 埋点（gtag/_hmt 步骤漏斗）+ 引导 CSS 动画（ob-card-in/ob-card-glow/ob-reward-pop/born-pop）。
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
  // candidates 可领养口径与 /api/pets/claim 一致（visible + 无 owner/guest_owner）
  assert.ok(c.includes("p.visible = true"), "candidates visible only");
  assert.ok(c.includes("p.owner_id IS NULL"), "candidates unowned");
  assert.ok(c.includes("p.guest_owner IS NULL"), "candidates not guest-held");
  // Phase 2：视觉化物种卡片选择 —— 至多 3 只随机候选（前端卡片网格挑选）
  assert.ok(/ORDER BY random\(\)\s+LIMIT 3/.test(c), "up to 3 random candidates");
  assert.ok(c.includes("candidates"), "candidates array in response");
  assert.ok(c.includes("rows.map("), "rows mapped to candidate cards");
  // 老用户短路：completed || hasPet 时不查 candidates
  assert.ok(c.includes("if (!completed && !hasPet)"), "candidates gated by !completed && !hasPet");
});

// === 3) POST /api/onboarding：完成标记幂等 + 首次完成奖励（Phase 2） ===
test("onboarding api: POST marks completed idempotently + first-time reward", () => {
  const c = read("src/app/api/onboarding/route.ts");
  // 幂等门控：仅 false → true 翻转成功才算首次完成（并发/重复调用不重复发奖）
  assert.ok(
    c.includes("WHERE id = $1 AND onboarding_completed = false"),
    "flip-guard: only false → true counts as first completion",
  );
  assert.ok(c.includes("RETURNING id"), "RETURNING detects actual flip");
  assert.ok(c.includes("completed: true"), "response confirms completed");
  // Phase 2 完成奖励：+10 积分，事务内 users.points + points_log
  assert.ok(
    c.includes("ONBOARDING_REWARD_POINTS = 10"),
    "reward = 10 points (constant)",
  );
  assert.ok(c.includes("BEGIN") && c.includes("COMMIT"), "transactional");
  assert.ok(
    c.includes("UPDATE users SET points = points + $2 WHERE id = $1"),
    "points credited in same tx",
  );
  assert.ok(
    c.includes("INSERT INTO points_log (user_id, amount, reason) VALUES ($1, $2, 'onboarding_reward')"),
    "points_log audit trail",
  );
  assert.ok(c.includes("reward"), "reward echoed in response");
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

// === 6) wizard 五步流（Phase 2）：候选卡片 / claim 复用 / 410 重拉 / AI 建议名 / 奖励步 ===
test("onboarding wizard: 5-step flow with candidate cards, AI names, reward step", () => {
  const w = read("src/components/onboarding/onboarding-wizard.tsx");
  // 五步相态（awaken 为 claim 过渡态，awakened/naming/journey/reward 对应 Step 2-5）
  for (const phase of [
    '"meet"',
    '"awaken"',
    '"awakened"',
    '"naming"',
    '"journey"',
    '"reward"',
  ]) {
    assert.ok(w.includes(phase), `phase ${phase}`);
  }
  // 五步指示器
  assert.ok(w.includes("[1, 2, 3, 4, 5].map"), "5-dot step indicator");
  // Step1 视觉化物种卡片：候选数组渲染 + 选择态
  assert.ok(w.includes("candidates.map("), "candidate cards rendered");
  assert.ok(w.includes("selectedPetId"), "selection state");
  assert.ok(w.includes("aria-pressed"), "card a11y pressed state");
  // Step2 唤醒复用 P0 claim 链路（领养 + 自动生成灵魂凭证）
  assert.ok(w.includes('fetch("/api/pets/claim"'), "awaken via /api/pets/claim");
  assert.ok(w.includes("body: JSON.stringify({ petId: target.petId })"), "claim selected petId");
  // 410（被抢先唤醒）→ 重新拉候选回到 Step1
  assert.ok(w.includes("res.status === 410"), "410 branch");
  assert.ok(/410[\s\S]{0,400}?bootstrap\(\)/.test(w), "410 refetches candidates");
  // 编号展示（全球唯一编号）
  assert.ok(w.includes("certificateNo"), "shows certificate number");
  // Step3 AI 建议名
  assert.ok(w.includes('fetch("/api/onboarding/name-suggestions"'), "AI name suggestions");
  assert.ok(w.includes("suggestions.map("), "suggestion chips rendered");
  // Step4/5：起名提交 + 完成标记（首次发奖）+ 双目的地（对话 / 探索）
  assert.ok(w.includes('fetch("/api/onboarding/name"'), "name submit");
  assert.ok(
    /fetch\("\/api\/onboarding",\s*\{\s*method: "POST"/.test(w),
    "completion marker POST",
  );
  assert.ok(w.includes('setPhase("reward")'), "enters reward step before redirect");
  assert.ok(w.includes("`/chat?thread=${claim.threadId}&adopt=${claim.adoptionId}`"), "chat dest");
  assert.ok(w.includes('"/explore-v2"'), "explore dest");
  // 奖励积分展示（首次发放 / 已领取 两态）
  assert.ok(w.includes("reward.points"), "reward points displayed");
  assert.ok(w.includes('t("reward.noReward")'), "already-claimed state");
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
    for (const ns of [
      "meet",
      "awaken",
      "awakened",
      "naming",
      "journey",
      "reward",
      "banner",
      "empty",
    ]) {
      assert.ok(dict.onboarding[ns], `onboarding.${ns}`);
    }
    assert.ok(dict.onboarding.metaTitle, "metaTitle");
    assert.ok(dict.onboarding.stepOf.includes("{step}"), "stepOf interpolation");
    assert.ok(dict.onboarding.journey.choiceHint.includes("{name}"), "choiceHint interpolation");
    assert.ok(
      dict.onboarding.reward.desc.includes("{name}") &&
        dict.onboarding.reward.pointsLabel.includes("{points}"),
      "reward interpolations",
    );
    // Phase 2 新 key：AI 建议名 / 预设话题 / 探索奖励预览
    for (const k of ["aiCta", "aiWorking", "aiFailed", "suggestionHint"]) {
      assert.ok(dict.onboarding.naming[k], `onboarding.naming.${k}`);
    }
    for (const k of ["topic1", "topic2", "rewardsTitle", "rewardPoints", "rewardItem", "rewardPostcard"]) {
      assert.ok(dict.onboarding.journey[k], `onboarding.journey.${k}`);
    }
    // api 新错误码
    for (const k of ["petNameInvalid", "adoptionNotFound", "onboardingFailed"]) {
      assert.ok(dict.api[k], `api.${k}`);
    }
  }
  // 五步标题存在且语义对齐
  assert.ok(zh.onboarding.stepOf.includes("5"), "zh stepOf total 5");
  assert.ok(en.onboarding.stepOf.includes("5"), "en stepOf total 5");
  assert.ok(zh.onboarding.meet.title.includes("遇"), "zh step1 meet");
  assert.ok(zh.onboarding.journey.title.includes("启"), "zh step4 journey");
  assert.ok(zh.onboarding.reward.pointsLabel.includes("+{points}"), "zh reward points");
  assert.equal(en.onboarding.awakened.certLabel, "Globally unique ID", "en cert label");
});

// === 11) POST /api/onboarding/name-suggestions：AI 建议名（LLM 单点 + 预设池降级） ===
test("onboarding name-suggestions api: getModel single-point + fallback pool + auth", () => {
  const p = "src/app/api/onboarding/name-suggestions/route.ts";
  assert.ok(exists(p), "route exists");
  const c = read(p);
  assert.ok(c.includes("export async function POST"), "POST handler");
  assert.ok(c.includes("getUserFromRequest(req)"), "auth via bearer");
  assert.ok(c.includes("{ status: 401 }"), "unauthenticated 401");
  // LLM 链复用全站单点（Vercel AI SDK generateText + getModel）
  assert.ok(c.includes('import { generateText } from "ai"'), "AI SDK generateText");
  assert.ok(c.includes('import { getModel } from "@/lib/get-model"'), "single-point model");
  assert.ok(c.includes("maxOutputTokens"), "cost-capped tokens");
  // 降级：LLM 失败/解析不足 3 个 → 本地预设池随机 3 个（流程不被 AI 故障阻断）
  assert.ok(c.includes("FALLBACK_NAMES"), "local fallback pool");
  assert.ok(c.includes('source: "fallback"'), "fallback source flagged");
  assert.ok(c.includes('source: "ai"'), "ai source flagged");
  // 响应形态：{ ok, names, source }；解析容错（去序号/引号 + 长度过滤）
  assert.ok(c.includes("names"), "names array in response");
  assert.ok(c.includes("parseNames"), "robust name parsing");
});

// === 12) 埋点（各步骤完成率）+ 引导 CSS 动画 ===
test("onboarding: step tracking (gtag/_hmt) + CSS animations wired", () => {
  const w = read("src/components/onboarding/onboarding-wizard.tsx");
  // 埋点：GA gtag + 百度 _hmt 双通道，防御性调用（统计脚本未加载静默跳过）
  assert.ok(w.includes("trackStep"), "trackStep helper");
  assert.ok(w.includes('"onboarding_step"'), "gtag onboarding_step event");
  assert.ok(w.includes('"_trackEvent"'), "baidu _hmt trackEvent");
  assert.ok(
    /useEffect\(\(\) => \{\s*if \(stepNo > 0\) trackStep\(stepNo\);\s*\}, \[stepNo\]\)/.test(w),
    "tracks on every step enter",
  );
  // 动画：卡片入场 / 选中柔光 / 奖励弹出（keyframes 定义在 globals.css，组件引用）
  const css = read("src/app/globals.css");
  for (const kf of ["ob-card-in", "ob-card-glow", "ob-reward-pop"]) {
    assert.ok(css.includes(`@keyframes ${kf}`), `globals.css @keyframes ${kf}`);
    assert.ok(w.includes(kf), `wizard uses ${kf}`);
  }
  assert.ok(w.includes("born-pop"), "awakened card born-pop animation");
});

