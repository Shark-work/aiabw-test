// 探索成就系统 · 契约测试（roadmap 任务二，2026-09-23）
// 覆盖：徽章配置（8 枚/奖励/目标值）+ 纯函数评估器 + drizzle/0021 迁移 +
//      schema 导出 + client.ts 注入（SCHEMA_CREATES/INDEXES/VERSION≥2）+
//      服务端聚合（V1 折算口径）+ API 路由 + i18n 双语 + 前端组件接线
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  ACHIEVEMENTS,
  ACHIEVEMENT_MAP,
  BADGE_I18N_KEYS,
  REWARD_NOTE_BADGES,
  MASTER_TARGET,
  HAPPINESS_MAX,
  getBadgeProgress,
  isBadgeUnlocked,
} from "../src/lib/achievements-config.ts";

import { achievements } from "../src/db/schema.ts";

const ROOT = join(import.meta.dirname ?? __dirname, "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

// === 1) 徽章配置与 roadmap §二规格一致 ===
test("achievements: 8 badges in roadmap order with exact ids/rewards/targets", () => {
  assert.equal(ACHIEVEMENTS.length, 8, "should define exactly 8 badges");
  const spec = [
    ["first-explore", 5, 1], // 初出茅庐：首次探索 → 5 积分
    ["explorer-10", 10, 10], // 探险新手：累计 10 次 → 10 积分
    ["all-common-events", 20, 20], // 足迹遍布：全部普通事件 → 20 积分
    ["all-rare-events", 30, 20], // 奇遇猎人：全部稀有事件 → 30 积分
    ["wiki-collector", 15, 5], // 百科达人：5 种百科 → 15 积分
    ["bond-max", 25, 100], // 亲密无间：亲密度满值 → 25 积分
    ["checkin-7", 35, 7], // 全勤奖：连续签到 7 天 → 35 积分
    ["master", 100, 7], // 艾比大师：其它全部解锁 → 100 积分
  ];
  spec.forEach(([id, reward, target], i) => {
    const def = ACHIEVEMENTS[i];
    assert.equal(def.id, id, `badge #${i} id`);
    assert.equal(def.rewardPoints, reward, `${id} reward`);
    assert.equal(def.target, target, `${id} target`);
    assert.equal(def.order, i + 1, `${id} order`);
    assert.ok(def.emoji.length > 0, `${id} emoji`);
  });
  const ids = new Set(ACHIEVEMENTS.map((d) => d.id));
  assert.equal(ids.size, 8, "badge ids unique");
  assert.equal(MASTER_TARGET, 7, "master target = 7 non-master badges");
  assert.equal(HAPPINESS_MAX, 100, "bond-max uses happiness 上限 100");
  assert.equal(ACHIEVEMENT_MAP["bond-max"].target, HAPPINESS_MAX);
});

// === 2) i18n key 映射完备 ===
test("achievements: BADGE_I18N_KEYS covers all badges; REWARD_NOTE subset", () => {
  const keys = new Set(Object.values(BADGE_I18N_KEYS));
  for (const def of ACHIEVEMENTS) {
    assert.ok(BADGE_I18N_KEYS[def.id], `missing i18n key for ${def.id}`);
  }
  assert.equal(keys.size, 8, "i18n keys unique");
  // 特殊奖励（宠物解锁资格/称号/头像框）：恰好 4 枚且在徽章集合内
  assert.equal(REWARD_NOTE_BADGES.size, 4);
  for (const id of REWARD_NOTE_BADGES) {
    assert.ok(ACHIEVEMENT_MAP[id], `reward-note badge ${id} not in ACHIEVEMENTS`);
  }
});

// === 3) 纯函数评估器 ===
test("achievements: getBadgeProgress clamps to target; isBadgeUnlocked edges", () => {
  const zero = {
    totalExplorations: 0,
    commonEventCount: 0,
    rareEventCount: 0,
    wikiSpeciesCount: 0,
    maxHappiness: 0,
    checkinStreak: 0,
    unlockedBadgeCount: 0,
  };
  assert.equal(getBadgeProgress("first-explore", zero), 0);
  assert.ok(!isBadgeUnlocked("first-explore", zero));
  // V1 老用户口径已折算进 totalExplorations（service 层）：≥1 即达成首次探索
  const legacy = { ...zero, totalExplorations: 3 };
  assert.ok(isBadgeUnlocked("first-explore", legacy));
  assert.equal(getBadgeProgress("first-explore", legacy), 1, "clamp to target 1");
  // explorer-10 边界：9 未达成 / 10 达成 / 99 clamp
  assert.ok(!isBadgeUnlocked("explorer-10", { ...zero, totalExplorations: 9 }));
  assert.ok(isBadgeUnlocked("explorer-10", { ...zero, totalExplorations: 10 }));
  assert.equal(getBadgeProgress("explorer-10", { ...zero, totalExplorations: 99 }), 10);
  // 事件覆盖
  assert.ok(isBadgeUnlocked("all-common-events", { ...zero, commonEventCount: 20 }));
  assert.ok(!isBadgeUnlocked("all-rare-events", { ...zero, rareEventCount: 19 }));
  // 百科 / 亲密度 / 连签
  assert.ok(isBadgeUnlocked("wiki-collector", { ...zero, wikiSpeciesCount: 5 }));
  assert.ok(isBadgeUnlocked("bond-max", { ...zero, maxHappiness: 100 }));
  assert.ok(!isBadgeUnlocked("bond-max", { ...zero, maxHappiness: 99 }));
  assert.ok(isBadgeUnlocked("checkin-7", { ...zero, checkinStreak: 7 }));
  // master：仅由已解锁的非 master 徽章数驱动
  assert.ok(!isBadgeUnlocked("master", { ...zero, unlockedBadgeCount: 6 }));
  assert.ok(isBadgeUnlocked("master", { ...zero, unlockedBadgeCount: 7 }));
});

// === 4) drizzle/0021 迁移文件 ===
test("achievements: drizzle/0021_achievements.sql idempotent DDL + unique + index", () => {
  const p = join(ROOT, "drizzle/0021_achievements.sql");
  assert.ok(existsSync(p), `missing ${p}`);
  const c = readFileSync(p, "utf8");
  assert.ok(c.includes('CREATE TABLE IF NOT EXISTS "achievements"'));
  assert.ok(c.includes('"user_id"'), "has user_id");
  assert.ok(c.includes('"badge_id"'), "has badge_id");
  assert.ok(c.includes('"unlocked_at"'), "has unlocked_at");
  assert.match(c, /UNIQUE\s*\(\s*"user_id"\s*,\s*"badge_id"\s*\)/, "unique(user_id,badge_id)");
  assert.ok(c.includes('CREATE INDEX IF NOT EXISTS "idx_achievements_user"'), "user index");
});

// === 5) schema.ts 导出 ===
test("achievements: schema exports achievements table with unique constraint", () => {
  assert.equal(typeof achievements, "object");
  const c = read("src/db/schema.ts");
  assert.ok(c.includes("export const achievements = pgTable("), "pgTable def");
  assert.ok(c.includes("achievements_user_badge_unique"), "unique constraint name");
});

// === 6) client.ts 注入 + 版本号提升 ===
test("achievements: client.ts SCHEMA_CREATES/INDEXES include table; SCHEMA_VERSION >= 2", () => {
  const c = read("src/db/client.ts");
  assert.ok(c.includes('CREATE TABLE IF NOT EXISTS "achievements"'), "DDL in SCHEMA_CREATES");
  assert.ok(c.includes('CREATE INDEX IF NOT EXISTS "idx_achievements_user"'), "index in SCHEMA_INDEXES");
  const m = c.match(/SCHEMA_VERSION\s*=\s*(\d+)/);
  assert.ok(m, "SCHEMA_VERSION const exists");
  assert.ok(Number(m[1]) >= 2, `SCHEMA_VERSION must be >= 2 (got ${m[1]})，否则生产库不同步 achievements 表`);
});

// === 7) 服务端聚合服务：导出 + V1 折算口径 + 全数据源 ===
test("achievements: service gathers stats from all sources incl. V1 legacy formula", () => {
  const c = read("src/lib/achievements-service.ts");
  assert.ok(c.includes("export async function gatherAchievementStats"), "gather fn");
  assert.ok(c.includes("export async function syncAchievements"), "sync fn");
  // V1 老数据折算口径（roadmap §三）：postcards 计数 + Σsteps÷100 取 max
  assert.ok(c.includes("user_postcards"), "V1 postcards source");
  assert.ok(c.includes("exploration_steps"), "V1 steps source");
  assert.ok(c.includes("Math.max(Math.floor("), "max(steps/100, postcards) 口径");
  // 其它数据源
  assert.ok(c.includes("exploration_records"), "V2 records");
  assert.ok(c.includes("knowledge_link"), "wiki species via knowledge_link");
  assert.ok(c.includes("checkin_streak"), "checkin streak");
  assert.ok(c.includes("happiness"), "bond via happiness");
  // 事件区间常量驱动（evt-001~020 / evt-021~040）
  assert.ok(c.includes("COMMON_EVENT_ID_MIN"), "common range const");
  assert.ok(c.includes("RARE_EVENT_ID_MAX"), "rare range const");
  // 积分入账：同事务 users.points + points_log（reason='achievement'）
  assert.ok(c.includes('"achievement"'), "points_log reason");
  assert.ok(c.includes("onConflictDoNothing"), "幂等解锁");
  // 回归（2026-09-23 实测 text = uuid 报错）：uuid 列与 adoptions 历史 text 列分用强转
  assert.ok(c.includes("$1::uuid"), "uuid 列参数强转");
  assert.ok(c.includes("$1::text"), "adoptions.user_id 为 text 列 → $1::text");
});

// === 8) /api/achievements 路由 ===
test("achievements: GET /api/achievements with Bearer auth + lazy sync", () => {
  const c = read("src/app/api/achievements/route.ts");
  assert.ok(c.includes("export async function GET"), "GET handler");
  assert.ok(c.includes("getUserFromRequest"), "Bearer auth");
  assert.ok(c.includes("SIGN_IN_REQUIRED"), "401 path");
  assert.ok(c.includes("syncAchievements"), "lazy evaluate + unlock");
  assert.ok(c.includes("ensureDbSchemaOnce"), "schema guard");
  assert.ok(c.includes("achievementsFailed"), "localized 500");
});

// === 9) 探索完成节点集成（start 路由） ===
test("achievements: exploration/start runs sync and returns newlyUnlocked", () => {
  const c = read("src/app/api/exploration/start/route.ts");
  assert.ok(c.includes('import { syncAchievements } from "@/lib/achievements-service"'), "import");
  assert.ok(c.includes("newlyUnlocked"), "response field");
  assert.ok(c.includes("achievements sync failed"), "失败不阻断主流程");
  const e = read("src/lib/exploration-engine.ts");
  assert.ok(e.includes("newlyUnlocked"), "type extended");
});

// === 10) i18n 双语完备 ===
test("achievements: zh/en i18n namespaces complete (8 badges + rewardNote + api error)", () => {
  for (const loc of ["zh", "en"]) {
    const msgs = JSON.parse(read(`messages/${loc}.json`));
    const a = msgs.achievements;
    assert.ok(a, `${loc} achievements namespace`);
    assert.ok(a.title && a.rewardPoints && a.celebrationTitle && a.celebrationPoints && a.celebrationButton, `${loc} ui keys`);
    const expected = {
      firstExplore: false,
      explorer10: true, // 垂耳兔解锁资格
      allCommonEvents: false,
      allRareEvents: true, // 玄凤鹦鹉解锁资格
      wikiCollector: false,
      bondMax: true, // 专属称号
      checkin7: false,
      master: true, // 限定头像框
    };
    for (const def of ACHIEVEMENTS) {
      const key = BADGE_I18N_KEYS[def.id];
      const b = a.badges?.[key];
      assert.ok(b?.name && b?.desc, `${loc} badge ${key} name+desc`);
      if (expected[key]) {
        assert.ok(b.rewardNote, `${loc} badge ${key} rewardNote`);
      }
    }
    assert.equal(Object.keys(a.badges).length, 8, `${loc} exactly 8 badges`);
    assert.ok(msgs.api?.achievementsFailed, `${loc} api.achievementsFailed`);
  }
});

// === 11) 前端组件接线 ===
test("achievements: panel fetches API with Bearer; v2 panel + result modal wired", () => {
  const panel = read("src/components/achievements/achievement-panel.tsx");
  assert.ok(panel.includes('fetch("/api/achievements"'), "fetch endpoint");
  assert.ok(panel.includes("Authorization: `Bearer ${token}`"), "Bearer header");
  assert.ok(panel.includes('data-testid="achievement-panel"'), "panel testid");
  assert.ok(panel.includes('data-testid="achievement-list"'), "list testid");
  assert.ok(panel.includes('data-testid="achievement-celebration"'), "celebration testid");
  assert.ok(panel.includes("refreshKey"), "refresh on exploration");

  const v2 = read("src/components/exploration-v2/explore-v2-panel.tsx");
  assert.ok(v2.includes("<AchievementPanel refreshKey={achvRefreshKey} />"), "panel mounted");
  assert.ok(v2.includes("setAchvRefreshKey"), "refresh signal");

  const modal = read("src/components/exploration-v2/explore-result-modal.tsx");
  assert.ok(modal.includes("newlyUnlocked"), "modal accepts badges");
  assert.ok(modal.includes('data-testid="explore-result-badges"'), "celebration block");

  const btn = read("src/components/exploration-v2/explore-button.tsx");
  assert.ok(btn.includes("newlyUnlocked: data.newlyUnlocked ?? null"), "pass-through");
});
