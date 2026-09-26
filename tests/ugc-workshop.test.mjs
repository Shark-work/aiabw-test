// UGC 内容创作工坊 · P0 契约测试
// 覆盖：
//   1) lib 纯函数：10 种写真风格 / prompt 构建 / 照片校验 / 响应解析 / 心情映射 / 主题与常量
//   2) DB 契约：drizzle/0023 幂等 DDL + schema.ts 导出 + client.ts 注入 + SCHEMA_VERSION>=5
//   3) 写真 API 静态契约：鉴权 / 风格与照片校验 / VIP 分流 / 免费日限 / 入库 / 水印标记 / 成本
//   4) 前端静态契约：日记卡片 Canvas 合成 / 保存分享 / 写真页上传+风格网格+进度+配额
//   5) 聚合页 / 导航 / i18n 双语 parity
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const lib = await import("../src/lib/ugc-workshop.ts");

// === 1) lib · 写真风格与 prompt ==============================================
test("workshop lib: 10 portrait styles, unique ids, required presets present", () => {
  assert.equal(lib.PORTRAIT_STYLES.length, 10, "必须恰好 10 种风格");
  const ids = lib.PORTRAIT_STYLES.map((s) => s.id);
  assert.equal(new Set(ids).size, 10, "风格 id 必须唯一");
  for (const required of ["hanfu", "wedding", "japanese", "hk-retro"]) {
    assert.ok(ids.includes(required), `缺少需求指定风格: ${required}`);
  }
  for (const s of lib.PORTRAIT_STYLES) {
    assert.ok(s.emoji.length > 0, `${s.id} 缺 emoji`);
    assert.ok(s.promptHint.length > 10, `${s.id} 缺 promptHint`);
    assert.ok(!/[一-龥]/.test(s.promptHint), `${s.id} promptHint 应为英文（模型侧稳定）`);
  }
});

test("workshop lib: isPortraitStyle gate", () => {
  assert.ok(lib.isPortraitStyle("hanfu"));
  assert.ok(lib.isPortraitStyle("plush"));
  assert.ok(!lib.isPortraitStyle("evil'; DROP TABLE--"));
  assert.ok(!lib.isPortraitStyle(""));
  assert.ok(!lib.isPortraitStyle(undefined));
  assert.ok(!lib.isPortraitStyle(123));
});

test("workshop lib: buildPortraitPrompt assembles subject + style + quality", () => {
  const p = lib.buildPortraitPrompt("hanfu", "雪球");
  assert.match(p, /hanfu/i, "含风格关键词");
  assert.match(p, /雪球/, "含宠物名");
  assert.match(p, /best quality/, "含质量词");
  const noName = lib.buildPortraitPrompt("cyberpunk");
  assert.match(noName, /the pet in the photo/, "无名字时回退通用主体");
  assert.match(noName, /cyberpunk/i);
});

// === 2) lib · 照片校验 / 响应解析 / 心情 / 主题 ===============================
test("workshop lib: isValidPhotoInput accepts data-url & http(s), rejects others", () => {
  assert.ok(lib.isValidPhotoInput("data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="));
  assert.ok(lib.isValidPhotoInput("data:image/jpeg;base64,/9j/4AAQSkZJRg=="));
  assert.ok(lib.isValidPhotoInput("data:image/webp;base64,UklGRhYAAABXRUJQ=="));
  assert.ok(lib.isValidPhotoInput("https://example.com/cat.jpg"));
  assert.ok(!lib.isValidPhotoInput("data:image/gif;base64,R0lGODlh"), "gif 不允许");
  assert.ok(!lib.isValidPhotoInput("data:text/html;base64,PGI+"), "非图片 MIME 拒绝");
  assert.ok(!lib.isValidPhotoInput(""));
  assert.ok(!lib.isValidPhotoInput("not-a-url"));
  assert.ok(!lib.isValidPhotoInput("ftp://x/y.png"));
  assert.ok(!lib.isValidPhotoInput(null));
  // 超长 base64 拒绝（> MAX_PHOTO_BASE64_LEN）
  const huge = "data:image/png;base64," + "A".repeat(lib.MAX_PHOTO_BASE64_LEN);
  assert.ok(!lib.isValidPhotoInput(huge), "超长 base64 必须拒绝");
});

test("workshop lib: extractPortraitImageUrl tolerant extraction", () => {
  const url = "https://cdn.example.com/p.png";
  assert.equal(lib.extractPortraitImageUrl({ imageUrl: url }), url);
  assert.equal(lib.extractPortraitImageUrl({ image_url: url }), url);
  assert.equal(lib.extractPortraitImageUrl({ url }), url);
  assert.equal(lib.extractPortraitImageUrl({ data: { imageUrl: url } }), url);
  assert.equal(lib.extractPortraitImageUrl({ result: { url } }), url);
  assert.equal(lib.extractPortraitImageUrl({ output: { images: [url] } }), url);
  assert.equal(lib.extractPortraitImageUrl({ imageUrl: "notaurl" }), null);
  assert.equal(lib.extractPortraitImageUrl({}), null);
  assert.equal(lib.extractPortraitImageUrl(null), null);
});

test("workshop lib: moodEmojiOf thresholds", () => {
  assert.equal(lib.moodEmojiOf(100), "😄");
  assert.equal(lib.moodEmojiOf(80), "😄");
  assert.equal(lib.moodEmojiOf(50), "🙂");
  assert.equal(lib.moodEmojiOf(30), "😐");
  assert.equal(lib.moodEmojiOf(0), "😢");
  assert.equal(lib.moodEmojiOf(null), "🙂");
  assert.equal(lib.moodEmojiOf(undefined), "🙂");
});

test("workshop lib: 3 diary themes + canvas + constants", () => {
  assert.equal(lib.DIARY_THEMES.length, 3);
  const ids = lib.DIARY_THEMES.map((t) => t.id);
  assert.deepEqual(ids, ["fresh", "vintage", "cute"]);
  for (const t of lib.DIARY_THEMES) {
    for (const k of ["bgFrom", "bgTo", "cardBg", "textMain", "textSub", "accent"]) {
      assert.match(t[k], /^#[0-9A-Fa-f]{6}$/, `${t.id}.${k} 必须是 #RRGGBB`);
    }
  }
  assert.ok(lib.isDiaryTheme("vintage"));
  assert.ok(!lib.isDiaryTheme("neon"));
  assert.equal(lib.DIARY_CARD_WIDTH, 1080);
  assert.equal(lib.DIARY_CARD_HEIGHT, 1350);
  assert.equal(lib.FREE_DAILY_PORTRAIT_LIMIT, 1, "免费用户每日限 1 张");
  assert.equal(lib.PORTRAIT_COST_YUAN, 0.1, "成本透明化标注 0.1 元");
  assert.match(lib.SITE_WATERMARK, /aiabw\.com/, "站点域名水印");
  assert.match(lib.SITE_URL_FOR_QR, /^https:\/\//, "二维码落地页必须 https");
  assert.deepEqual(lib.UGC_CREATION_TYPES, ["portrait", "diary_card", "sticker"]);
});

// === 3) DB 契约：drizzle/0023 + schema.ts + client.ts 注入 =====================
test("workshop db: drizzle/0023 idempotent DDL with CHECK constraints", () => {
  const sql = read("drizzle/0023_ugc_workshop.sql");
  for (const table of ["ugc_creations", "ugc_campaigns", "ugc_submissions"]) {
    assert.ok(
      sql.includes(`CREATE TABLE IF NOT EXISTS "${table}"`),
      `0023 缺 ${table} 幂等建表`,
    );
  }
  assert.match(sql, /CHECK \("type" IN \('portrait', 'diary_card', 'sticker'\)\)/);
  assert.match(sql, /CHECK \("status" IN \('pending', 'approved', 'rejected', 'featured'\)\)/);
  assert.match(sql, /"is_premium" boolean DEFAULT false NOT NULL/);
});

test("workshop db: schema.ts exports three tables with key columns", () => {
  const s = read("src/db/schema.ts");
  assert.match(s, /export const ugcCreations = pgTable\('ugc_creations'/);
  assert.match(s, /export const ugcCampaigns = pgTable\('ugc_campaigns'/);
  assert.match(s, /export const ugcSubmissions = pgTable\('ugc_submissions'/);
  assert.match(s, /enum: \['portrait', 'diary_card', 'sticker'\]/);
  assert.match(s, /isPremium: boolean\('is_premium'\)\.notNull\(\)\.default\(false\)/);
});

test("workshop db: client.ts DDL+indexes injected; SCHEMA_VERSION >= 5", () => {
  const c = read("src/db/client.ts");
  assert.ok(c.includes('CREATE TABLE IF NOT EXISTS "ugc_creations"'), "DDL in SCHEMA_CREATES");
  assert.ok(c.includes('CREATE TABLE IF NOT EXISTS "ugc_campaigns"'));
  assert.ok(c.includes('CREATE TABLE IF NOT EXISTS "ugc_submissions"'));
  assert.ok(c.includes('CREATE INDEX IF NOT EXISTS "idx_ugc_creations_user"'), "index in SCHEMA_INDEXES");
  assert.ok(c.includes('CREATE INDEX IF NOT EXISTS "idx_ugc_submissions_campaign"'));
  const m = c.match(/SCHEMA_VERSION\s*=\s*(\d+)/);
  assert.ok(m, "SCHEMA_VERSION const exists");
  assert.ok(
    Number(m[1]) >= 5,
    `SCHEMA_VERSION must be >= 5 (got ${m[1]})，否则生产库不同步 ugc_* 表`,
  );
});

// === 4) 写真 API 静态契约 =====================================================
test("workshop api: generate-portrait route guards auth/style/photo", () => {
  const r = read("src/app/api/ugc/generate-portrait/route.ts");
  assert.match(r, /getUserFromRequest\(req\)/, "必须鉴权");
  assert.match(r, /status:\s*401/, "未登录 401");
  assert.match(r, /isPortraitStyle\(styleType\)/, "风格白名单校验");
  assert.match(r, /isValidPhotoInput\(body\.photo\)/, "照片入参校验");
  assert.match(r, /status:\s*400/, "非法入参 400");
});

test("workshop api: VIP vs free quota split + daily limit 429", () => {
  const r = read("src/app/api/ugc/generate-portrait/route.ts");
  assert.match(r, /getActiveSubscription\(user\.id\)/, "VIP 判定");
  assert.match(r, /FREE_DAILY_PORTRAIT_LIMIT/, "免费限额常量");
  assert.match(r, /created_at::date\s*=\s*CURRENT_DATE/, "按自然日计数");
  assert.match(r, /status:\s*429/, "超限 429");
  assert.match(r, /code:\s*"DAILY_LIMIT"/, "429 带错误码供前端识别");
  assert.match(r, /dailyLimit:\s*isVip\s*\?\s*-1/, "VIP dailyLimit=-1 无限");
});

test("workshop api: external generation call + watermark split + persistence", () => {
  const r = read("src/app/api/ugc/generate-portrait/route.ts");
  assert.match(r, /process\.env\.UGC_PORTRAIT_API_URL/, "外部生图服务端点 env");
  assert.match(r, /portraitNotConfigured/, "未配置 503");
  assert.match(r, /AbortSignal\.timeout\(/, "上游超时保护");
  assert.match(r, /hd:\s*isVip/, "VIP 高清标记透传");
  assert.match(r, /watermark:\s*!isVip/, "免费低清水印透传");
  assert.match(r, /buildPortraitPrompt\(styleType/, "prompt 构建");
  assert.match(r, /extractPortraitImageUrl\(data\)/, "宽容解析图片 URL");
  // 入库：type='portrait'，is_premium = VIP 标记
  assert.match(r, /\.insert\(ugcCreations\)/, "写 ugc_creations 表");
  assert.match(r, /type:\s*"portrait"/);
  assert.match(r, /isPremium:\s*isVip/, "is_premium 与 VIP 绑定");
  // 响应契约：hd / watermarked / costYuan / remaining
  assert.match(r, /watermarked:\s*!isVip/);
  assert.match(r, /costYuan:\s*PORTRAIT_COST_YUAN/, "返回成本供前端展示");
  assert.match(r, /remaining/, "返回剩余次数");
});


// === 5) 前端静态契约 ==========================================================
test("workshop ui: diary-card client canvas composition pipeline", () => {
  const c = read("src/components/workshop/diary-card-client.tsx");
  assert.match(c, /createLinearGradient/, "背景渐变");
  assert.match(c, /drawImage/, "头像/二维码绘制");
  assert.match(c, /roundRect/, "圆角独白卡片");
  assert.match(c, /drawWrappedText/, "独白自动换行");
  assert.match(c, /QRCodeCanvas/, "站点二维码组件");
  assert.match(c, /SITE_URL_FOR_QR/, "二维码指向站点落地页");
  assert.match(c, /SITE_WATERMARK/, "底部固定域名水印（裂变引流）");
  assert.match(c, /moodEmojiOf\(pet\.happiness\)/, "心情 emoji 来自 happiness");
  assert.match(c, /getFullYear\(\)/, "日期水印");
  assert.match(c, /toDataURL\("image\/png"\)/, "卡片导出 PNG");
  assert.match(c, /navigator\.share/, "Web Share 分享");
  assert.match(c, /canvas\.toBlob|toBlob\(/, "分享文件构造");
  // 数据源：现有宠物列表 + 探索日记 API（零后端改动）
  assert.match(c, /\/api\/pets/);
  assert.match(c, /\/api\/exploration\/history\?limit=30/);
  // 3 主题切换
  assert.match(c, /DIARY_THEMES\.map/, "3 种主题切换");
  // 保存/长按提示
  assert.match(c, /a\.download\s*=\s*`diary-card-/, "保存文件名带日期");
  assert.match(c, /longPressSave/, "长按保存提示（微信兼容）");
});

test("workshop ui: portrait client upload + 10-style grid + progress + quota", () => {
  const c = read("src/components/workshop/portrait-client.tsx");
  assert.match(c, /FileReader/, "上传读取");
  assert.match(c, /readAsDataURL/, "base64 编码");
  assert.match(c, /5 \* 1024 \* 1024/, "前端 5MB 限制");
  assert.match(c, /PORTRAIT_STYLES\.map/, "10 种风格网格");
  assert.match(c, /styles\.\$\{s\.id\}/, "风格名走 i18n");
  assert.match(c, /setProgress/, "生成进度条");
  assert.match(c, /costHint/, "生成按钮旁成本标注");
  assert.match(c, /remainingToday/, "剩余次数展示");
  assert.match(c, /href="\/subscribe"/, "免费用尽 → VIP 升级引导");
  assert.match(c, /GET|\/api\/ugc\/generate-portrait/, "配额查询 + 生成请求同路由");
  assert.match(c, /result\.hd/, "高清/低清结果标记");
});

// === 6) 聚合页 / 导航 / i18n parity ===========================================
test("workshop ui: hub page lists 4 modules with coming-soon gates", () => {
  const p = read("src/app/[locale]/workshop/page.tsx");
  assert.match(p, /"diaryCard"[\s\S]*?"portrait"[\s\S]*?"sticker"[\s\S]*?"campaign"/, "4 个模块");
  assert.match(p, /\/workshop\/diary-card/, "日记卡片入口");
  assert.match(p, /\/workshop\/portrait/, "写真入口");
  assert.match(p, /comingSoon/, "未上线模块 coming soon");
});

test("workshop nav: SiteHeader includes /workshop entry (desktop + mobile share items)", () => {
  const h = read("src/components/layout/SiteHeader.tsx");
  assert.match(h, /\{ href: "\/workshop", label: t\("workshop"\) \}/, "导航工坊入口");
});

test("workshop i18n: zh/en workshop namespace key parity + styles + api keys", () => {
  const zh = JSON.parse(read("messages/zh.json"));
  const en = JSON.parse(read("messages/en.json"));
  const flatten = (obj, prefix = "") =>
    Object.entries(obj).flatMap(([k, v]) =>
      v && typeof v === "object" ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`],
    );
  const zhKeys = flatten(zh.workshop).sort();
  const enKeys = flatten(en.workshop).sort();
  assert.deepEqual(zhKeys, enKeys, "workshop 命名空间双语 key 必须一致");
  // 10 种风格双语齐全
  for (const s of lib.PORTRAIT_STYLES) {
    assert.ok(zh.workshop.portrait.styles[s.id], `zh 缺风格 ${s.id}`);
    assert.ok(en.workshop.portrait.styles[s.id], `en 缺风格 ${s.id}`);
  }
  // 3 主题名双语齐全
  for (const th of lib.DIARY_THEMES) {
    const key = `theme${th.id[0].toUpperCase()}${th.id.slice(1)}`;
    assert.ok(zh.workshop.diary[key], `zh 缺主题 ${key}`);
    assert.ok(en.workshop.diary[key], `en 缺主题 ${key}`);
  }
  // 导航 key 双语
  assert.ok(zh.nav.workshop, "zh nav 缺 workshop");
  assert.ok(en.nav.workshop, "en nav 缺 workshop");
  // api 错误文案双语
  for (const k of ["invalidStyle", "invalidPhoto", "portraitNotConfigured", "ugcGenerateFailed", "dailyPortraitLimit"]) {
    assert.ok(zh.api[k], `zh api 缺 ${k}`);
    assert.ok(en.api[k], `en api 缺 ${k}`);
  }
});

// === 7) 页面壳注册 =============================================================
test("workshop pages: diary-card & portrait shells mount their clients", () => {
  const d = read("src/app/[locale]/workshop/diary-card/page.tsx");
  const p = read("src/app/[locale]/workshop/portrait/page.tsx");
  assert.match(d, /DiaryCardClient/);
  assert.match(p, /PortraitClient/);
  assert.match(d, /setRequestLocale/);
  assert.match(p, /setRequestLocale/);
});

