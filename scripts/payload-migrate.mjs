/**
 * Payload 数据迁移脚本（Commit 5/6 migration）：现有硬编码数据 → CMS，幂等 upsert。
 *
 * 用法：pnpm cms:migrate（scripts 封装 node --experimental-loader + 本文件）；
 * 环境：.env.local 需 PAYLOAD_SECRET；生产填 TURSO_DATABASE_URL/TURSO_AUTH_TOKEN，
 *       本地缺省 file:payload.db（与 payload.config.ts 同口径）。
 *
 * 迁移映射（与 Collections/Globals 注释声明一一对应）：
 *  1) Users：首个管理员（仅 PAYLOAD_ADMIN_EMAIL/PAYLOAD_ADMIN_PASSWORD 双 env 齐备时；
 *     已存在则跳过——红线：迁移永不重置已有管理员密码）；
 *  2) Species ← SPECIES_VISUALS 注册表 + 角色展示层（personality/greeting）；
 *  3) PetAnimations ← MOOD_ACTION_MAP 七条全局默认（species=null）；
 *  4) Stories ← worldview-data 五表（8 区域 + 3 形态 + 5 信条 + 6 词条 + 3 古灵 = 25 条）；
 *  5) Products ← AIBI_ITEMS 道具目录；
 *  6) TokenRules ← 代码散落额度常量（签到/连签/分享/免费句数/徽章×8/裂变）；
 *  7) Globals：SiteSettings（联系渠道实值）/ HomeHero（messages/*.json home.*）/
 *     PointsEconomy（注册 +20 / 签到期望 3 / 连签 7 / 汇率 ≈17）；
 *  Pages/Banners 不虚构——留空由运营自建（「不虚构折扣/活动」红线延续）。
 *
 * 幂等：按键 find → 有则 update（全量覆盖，重跑即同步最新硬编码）/ 无则 create；
 * 重复执行/多环境执行结果一致。失败即非零退出（CI 可感知）。
 */
import { readFileSync } from "node:fs";
import { getPayload } from "payload";

// .env.local 加载（Node 20.12+；缺文件不炸）
try {
  process.loadEnvFile?.(".env.local");
} catch {
  /* 无 .env.local 时靠进程 env */
}

const { AIBI_ITEMS } = await import("../src/lib/aibi-catalog.ts");
const { PET_CHARACTERS } = await import("../src/lib/pets/characters.ts");
const { MOOD_ACTION_MAP } = await import("../src/lib/pets/sm-contract.ts");
const { SPECIES_VISUALS } = await import("../src/lib/pets/species-visuals.ts");
const { WORLD_ANCIENTS, WORLD_GLOSSARY, WORLD_LIFE_FORMS, WORLD_REGIONS, WORLD_VALUES } =
  await import("../src/lib/worldview-data.ts");

const zh = JSON.parse(readFileSync("messages/zh.json", "utf8"));
const en = JSON.parse(readFileSync("messages/en.json", "utf8"));

const { default: configPromise } = await import("../payload.config.ts");
const payload = await getPayload({ config: await configPromise });

const stats = { create: 0, update: 0, skip: 0 };
const log = (msg) => console.log(`[payload-migrate] ${msg}`);

/** 幂等 upsert：按键 find → update（全量覆盖）/ create。 */
async function upsert(collection, where, data, label) {
  const found = await payload.find({ collection, where, limit: 1, overrideAccess: true });
  if (found.docs[0]) {
    await payload.update({ collection, id: found.docs[0].id, data, overrideAccess: true });
    stats.update += 1;
    return;
  }
  await payload.create({ collection, data, overrideAccess: true });
  stats.create += 1;
  log(`  + ${label ?? collection}`);
}

// ─────────────────────── 1) 首个管理员 ───────────────────────
async function migrateAdmin() {
  const email = process.env.PAYLOAD_ADMIN_EMAIL;
  const password = process.env.PAYLOAD_ADMIN_PASSWORD;
  if (!email || !password) {
    log("1) 跳过管理员（PAYLOAD_ADMIN_EMAIL/PAYLOAD_ADMIN_PASSWORD 未配置）");
    stats.skip += 1;
    return;
  }
  const found = await payload.find({
    collection: "users", where: { email: { equals: email } }, limit: 1, overrideAccess: true,
  });
  if (found.docs[0]) {
    log("1) 管理员已存在，跳过（红线：不重置已有密码）");
    stats.skip += 1;
    return;
  }
  await payload.create({
    collection: "users", data: { email, password, role: "admin" }, overrideAccess: true,
  });
  stats.create += 1;
  log(`1) 管理员已创建：${email}`);
}

// ─────────────────────── 2) Species ───────────────────────
/** 物种名（物种≠角色：角色人设进 personality/greeting，物种名另录）。 */
const SPECIES_NAMES = { persian: ["波斯猫", "Persian Cat"] };

async function migrateSpecies() {
  for (const [speciesId, v] of Object.entries(SPECIES_VISUALS)) {
    const character = PET_CHARACTERS.find((c) => c.species.includes(speciesId));
    const [nameZh, nameEn] = SPECIES_NAMES[speciesId] ?? [speciesId, speciesId];
    await upsert(
      "species",
      { speciesId: { equals: speciesId } },
      {
        speciesId, nameZh, nameEn,
        personality: character?.personality ?? null,
        greetingZh: character?.greetingZh ?? null,
        greetingEn: character?.greetingEn ?? null,
        rivePath: v.rivePath ?? null,
        staticImage: v.staticImage || null,
        sceneTheme: v.sceneTheme,
        sortOrder: 0,
      },
      `species:${speciesId}`,
    );
  }
  log("2) Species ← SPECIES_VISUALS 注册表完成");
}


// ─────────────────────── 3) PetAnimations（七条全局默认） ───────────────────────
async function migratePetAnimations() {
  for (const [mood, action] of Object.entries(MOOD_ACTION_MAP)) {
    await upsert(
      "pet-animations",
      { and: [{ species: { exists: false } }, { mood: { equals: mood } }] },
      { species: null, mood, action, riveTrigger: null, intensityDefault: 1, note: "代码契约 MOOD_ACTION_MAP 迁移" },
      `pet-animations:${mood}`,
    );
  }
  log("3) PetAnimations ← MOOD_ACTION_MAP 完成");
}

// ─────────────────────── 4) Stories ← worldview-data 五表 ───────────────────────
const storyRows = [
  ...WORLD_REGIONS.map((r) => ({
    slug: `region:${r.id}`, kind: "region", titleZh: r.nameZh, titleEn: r.nameEn,
    summaryZh: r.descriptionZh, summaryEn: r.descriptionEn, emoji: r.emoji, sortOrder: r.sortOrder,
    extra: {
      typeZh: r.typeZh, typeEn: r.typeEn, elementZh: r.elementZh, elementEn: r.elementEn,
      representativesZh: r.representativesZh, representativesEn: r.representativesEn,
    },
  })),
  ...WORLD_LIFE_FORMS.map((f) => ({
    slug: `life-form:${f.id}`, kind: "life-form", titleZh: f.nameZh, titleEn: f.nameEn,
    summaryZh: f.descriptionZh, summaryEn: f.descriptionEn, emoji: f.emoji, sortOrder: f.sortOrder,
    extra: { subtitleZh: f.titleZh, subtitleEn: f.titleEn, examplesZh: f.examplesZh, examplesEn: f.examplesEn },
  })),
  ...WORLD_VALUES.map((v) => ({
    slug: `creed:${v.id}`, kind: "creed", titleZh: v.nameZh, titleEn: v.nameEn,
    summaryZh: v.featureZh, summaryEn: v.featureEn, emoji: v.emoji, sortOrder: v.sortOrder,
    extra: { sloganZh: v.sloganZh, sloganEn: v.sloganEn },
  })),
  ...WORLD_GLOSSARY.map((g) => ({
    slug: `glossary:${g.id}`, kind: "glossary", titleZh: g.termZh, titleEn: g.termEn,
    summaryZh: g.definitionZh, summaryEn: g.definitionEn, emoji: g.emoji, sortOrder: g.sortOrder,
  })),
  ...WORLD_ANCIENTS.map((a) => ({
    slug: `ancient:${a.id}`, kind: "ancient-legend", titleZh: a.nameZh, titleEn: a.nameEn,
    summaryZh: a.titleZh, summaryEn: a.titleEn, emoji: a.emoji, sortOrder: 0,
  })),
];

async function migrateStories() {
  for (const row of storyRows) {
    await upsert("stories", { slug: { equals: row.slug } }, { ...row, published: true }, row.slug);
  }
  log(`4) Stories ← 世界观五表完成（${storyRows.length} 条）`);
}

// ─────────────────────── 5) Products ← AIBI_ITEMS ───────────────────────
async function migrateProducts() {
  for (const i of AIBI_ITEMS) {
    await upsert(
      "products",
      { productId: { equals: i.id } },
      {
        productId: i.id, kind: i.itemType, nameZh: i.nameZh, nameEn: i.nameEn,
        descriptionZh: i.effect, descriptionEn: i.effectEn,
        effectPayload: i.effectPayload ?? null,
        pricePoints: i.pricePoints, priceCny: null, rarity: null, enabled: true, sortOrder: 0,
      },
      `products:${i.id}`,
    );
  }
  log("5) Products ← AIBI_ITEMS 完成");
}

// ─────────────────────── 6) TokenRules ← 代码额度常量（值与代码一致，注释标注出处） ───────────────────────
const TOKEN_RULES = [
  { ruleKey: "checkin.daily", nameZh: "每日签到", nameEn: "Daily Check-in", points: 0, dailyLimit: 1,
    descriptionZh: "加权随机 1-10（权重 50/30/15/5，src/lib/checkin-points.ts）；月卡 ×2。", descriptionEn: "Weighted random 1-10 (src/lib/checkin-points.ts); premium ×2." },
  { ruleKey: "checkin.streak-bonus", nameZh: "连签周期奖励", nameEn: "Streak Bonus", points: 100, dailyLimit: 0,
    descriptionZh: "连签每满 7 天额外 +100（月卡 ×2）+ 心情盲盒道具（api/user/checkin）。", descriptionEn: "+100 every 7-day streak (api/user/checkin)." },
  { ruleKey: "postcard.share", nameZh: "明信片墙分享", nameEn: "Postcard Share", points: 5, dailyLimit: 1,
    descriptionZh: "每日首次分享 +5（api/postcard-wall/share-reward，points_log.ref 幂等）。", descriptionEn: "First share of the day +5." },
  { ruleKey: "pet.chat.free-quota", nameZh: "宠物每日免费对话", nameEn: "Pet Chat Free Quota", points: 0, dailyLimit: 5,
    descriptionZh: "每日免费 5 句（kind='chat' 行数口径）；AI 全挂自动退款不占次。", descriptionEn: "5 free pet chats per day." },
  { ruleKey: "referral.inviter", nameZh: "裂变邀请人奖励", nameEn: "Referral Inviter", points: 50, dailyLimit: 0,
    descriptionZh: "被邀请人领养后邀请人 +50（verify-growth 口径）。", descriptionEn: "Inviter +50 after invitee adopts." },
  // 成就徽章 ×8（achievements-config.ts rewardPoints）
  { ruleKey: "achievement.first-explore", nameZh: "徽章·初出茅庐", nameEn: "Badge: First Explore", points: 5, dailyLimit: 0, descriptionZh: "完成首次探索。", descriptionEn: "First exploration." },
  { ruleKey: "achievement.explorer-10", nameZh: "徽章·探险新手", nameEn: "Badge: Explorer", points: 10, dailyLimit: 0, descriptionZh: "累计探索 10 次。", descriptionEn: "10 explorations." },
  { ruleKey: "achievement.all-common-events", nameZh: "徽章·足迹遍布", nameEn: "Badge: All Common", points: 20, dailyLimit: 0, descriptionZh: "触发全部普通事件。", descriptionEn: "All common events." },
  { ruleKey: "achievement.all-rare-events", nameZh: "徽章·奇遇猎人", nameEn: "Badge: Rare Hunter", points: 30, dailyLimit: 0, descriptionZh: "触发全部稀有事件。", descriptionEn: "All rare events." },
  { ruleKey: "achievement.wiki-collector", nameZh: "徽章·百科达人", nameEn: "Badge: Wiki Master", points: 15, dailyLimit: 0, descriptionZh: "解锁 5 种宠物百科。", descriptionEn: "5 wiki entries." },
  { ruleKey: "achievement.bond-max", nameZh: "徽章·亲密无间", nameEn: "Badge: Bond Max", points: 25, dailyLimit: 0, descriptionZh: "任意宠物亲密度满级。", descriptionEn: "Max happiness." },
  { ruleKey: "achievement.checkin-7", nameZh: "徽章·全勤奖", nameEn: "Badge: 7-Day Streak", points: 35, dailyLimit: 0, descriptionZh: "连续登录 7 天。", descriptionEn: "7-day streak." },
  { ruleKey: "achievement.master", nameZh: "徽章·艾比大师", nameEn: "Badge: Aibi Master", points: 100, dailyLimit: 0, descriptionZh: "解锁全部徽章。", descriptionEn: "All badges." },
];

async function migrateTokenRules() {
  for (const r of TOKEN_RULES) {
    await upsert("token-rules", { ruleKey: { equals: r.ruleKey } }, { ...r, cooldownMinutes: 0, enabled: true }, r.ruleKey);
  }
  log(`6) TokenRules ← 代码额度常量完成（${TOKEN_RULES.length} 条）`);
}

// ─────────────────────── 7) Globals ───────────────────────
async function migrateGlobals() {
  // SiteSettings：联系渠道实值（messages contact 命名空间口径）
  await payload.updateGlobal({
    slug: "site-settings",
    data: {
      siteNameZh: "艾比世界", siteNameEn: "Aibi World",
      sloganZh: zh.home?.subtitle ?? null, sloganEn: en.home?.subtitle ?? null,
      contactEmail: "aiabw@outlook.com", qqGroup: "1005445619",
      xUrl: "https://x.com/Aiabw_com", icpNumber: null, maintenanceMode: false,
    },
    overrideAccess: true,
  });
  log("7a) site-settings ← contact 口径");

  // HomeHero：messages/*.json home.* 直迁（i18n 单一事实源 → CMS）
  await payload.updateGlobal({
    slug: "home-hero",
    data: {
      titleZh: zh.home?.title ?? null, titleEn: en.home?.title ?? null,
      subtitleZh: zh.home?.subtitle ?? null, subtitleEn: en.home?.subtitle ?? null,
      ctaPrimaryTextZh: zh.home?.heroCta ?? null, ctaPrimaryTextEn: en.home?.heroCta ?? null,
      ctaPrimaryUrl: "/adopt",
      ctaExploreTextZh: zh.home?.heroCtaExplore ?? null, ctaExploreTextEn: en.home?.heroCtaExplore ?? null,
      ctaExploreUrl: "/explore-v2",
      ctaShopTextZh: zh.home?.heroCtaShop ?? null, ctaShopTextEn: en.home?.heroCtaShop ?? null,
      ctaShopUrl: "/shop",
      soulTreeEnabled: true,
    },
    overrideAccess: true,
  });
  log("7b) home-hero ← messages home.*");

  // PointsEconomy：与代码常量一致（注册 +20 api/auth/register；签到期望≈3.4 取 3；
  // 连签周期 7 api/user/checkin；基础档 100分/¥6≈16.7 取 17 src/lib/points-recharge.ts）
  await payload.updateGlobal({
    slug: "points-economy",
    data: { signupBonus: 20, checkinBase: 3, checkinStreakMax: 7, pointsPerCny: 17 },
    overrideAccess: true,
  });
  log("7c) points-economy ← 代码常量（20/3/7/17）");
}

// ─────────────────────── 主流程 ───────────────────────
async function main() {
  log(`开始迁移（db: ${process.env.TURSO_DATABASE_URL ?? "file:payload.db"}）`);
  await migrateAdmin();
  await migrateSpecies();
  await migratePetAnimations();
  await migrateStories();
  await migrateProducts();
  await migrateTokenRules();
  await migrateGlobals();
  log(`Pages/Banners 不虚构，留空由运营自建`);
  log(`完成：create=${stats.create} update=${stats.update} skip=${stats.skip}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[payload-migrate] 失败：", err);
    process.exit(1);
  });
