// 全站隐私改造验收（登录名去邮箱化 + 排行榜/公开页脱敏 + opt-out + 日志掩码）：
//  - 1-3：privacy 工具纯函数单测（昵称校验 / 日志掩码 / 公开投影）
//  - 4-13：源码契约（注册必填 username、登录双通道、排行榜脱敏+opt-out、前端无邮箱展示、i18n 齐备）
//  - 14：全局扫描（公开 src 代码无邮箱展示字段残留；admin 授权后台豁免）
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  validateUsername,
  maskEmail,
  maskIp,
  redactSensitive,
  toPublicOwner,
} from "../src/lib/privacy.ts";

const ROOT = process.cwd();
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const readJson = (p) => JSON.parse(read(p));

// ---------- 1. 昵称校验：注册必填 + 不允许使用邮箱作为登录名 ----------
test("username: required / email-like / length / charset / reserved", () => {
  assert.equal(validateUsername("").reason, "required");
  assert.equal(validateUsername(null).reason, "required");
  assert.equal(validateUsername(undefined).reason, "required");
  assert.equal(validateUsername("   ").reason, "required");
  assert.equal(validateUsername("a@b.com").reason, "emailLike", "邮箱不允许当昵称/登录名");
  assert.equal(validateUsername("x").reason, "tooShort");
  assert.equal(validateUsername("a".repeat(25)).reason, "tooLong");
  assert.equal(validateUsername("has space").reason, "invalidChars");
  assert.equal(validateUsername("emoji🦊").reason, "invalidChars");
  assert.equal(validateUsername("user_0001").reason, "reserved", "系统回填格式保留");
  assert.equal(validateUsername("USER_42").reason, "reserved");
});

test("username: valid names pass (zh/en/digit/_/-), boundaries ok", () => {
  assert.ok(validateUsername("抱抱狐01").ok);
  assert.ok(validateUsername("ab_c-d9").ok);
  assert.ok(validateUsername("用户甲").ok);
  assert.ok(validateUsername("ab").ok, "min=2");
  assert.ok(validateUsername("a".repeat(24)).ok, "max=24");
  assert.ok(validateUsername("user_abc").ok, "仅 user_+纯数字 保留");
});

// ---------- 2. 日志脱敏：邮箱 / IP 掩码 ----------
test("maskEmail / maskIp / redactSensitive", () => {
  assert.equal(maskEmail("user@gmail.com"), "u***@gmail.com");
  assert.equal(maskEmail("a@x.io"), "a***@x.io");
  assert.equal(maskEmail("no-at"), "***");
  assert.equal(maskIp("203.0.113.9"), "203.0.*.*");
  assert.equal(maskIp("2001:db8::1"), "2001:***");
  assert.equal(maskIp("unknown"), "***");
  const s = redactSensitive('duplicate key value violates unique constraint "users_email_key" (email)=(alice@gmail.com), client 10.1.2.3');
  assert.ok(!s.includes("alice@gmail.com"), "完整邮箱不得出现在日志");
  assert.ok(s.includes("a***@gmail.com"));
  assert.ok(!s.includes("10.1.2.3"), "完整 IP 不得出现在日志");
});

// ---------- 3. 公开投影：排行榜 DTO 只含昵称 ----------
test("toPublicOwner: only ownerId + ownerName, never sensitive fields", () => {
  const row = { ownerId: "u1", username: "狐小仙", email: "leak@x.com", created_at: "2026-01-01", ip: "1.2.3.4" };
  const dto = toPublicOwner(row);
  assert.deepEqual(Object.keys(dto).sort(), ["ownerId", "ownerName"]);
  assert.equal(dto.ownerName, "狐小仙");
  const json = JSON.stringify(dto);
  assert.ok(!json.includes("leak@x.com") && !json.includes("created_at") && !json.includes("1.2.3.4"));
  assert.equal(toPublicOwner({ ownerId: "u2", username: null }, "匿名").ownerName, "匿名");
  assert.equal(toPublicOwner({ ownerId: "u3", username: "  " }, "Anonymous").ownerName, "Anonymous");
});

// ---------- 4. 注册：username 必填 + 响应不含邮箱 ----------
test("register route: username required+validated, response drops email", () => {
  const src = read("src/app/api/auth/register/route.ts");
  assert.match(src, /validateUsername\(username\)/);
  assert.match(src, /"usernameRequired"/, "缺失时 400 usernameRequired");
  assert.match(src, /"usernameTaken"/, "撞名时 409 usernameTaken");
  assert.match(src, /\.values\(\{ email, username, passwordHash, inviteCode \}\)/, "落库含 username");
  assert.ok(!/user: \{ id: user\.id, email/.test(src), "注册响应不得暴露 email");
});

// ---------- 5. 登录：username/email 双通道 + 响应不含邮箱 ----------
test("login route: dual-channel identifier, response drops email", () => {
  const src = read("src/app/api/auth/login/route.ts");
  assert.match(src, /body\?\.identifier \?\? body\?\.email \?\? body\?\.username/, "identifier 兼容旧字段");
  assert.match(src, /identifier\.includes\("@"\)/, "@ → 邮箱通道（仅后端匹配）");
  assert.match(src, /eq\(users\.username, identifier\)/, "否则按 username 匹配");
  assert.ok(!/user: \{ id: user\.id, email/.test(src), "登录响应不得暴露 email");
});

// ---------- 7. 排行榜：DTO 脱敏 + opt-out 过滤生效 ----------
test("leaderboard: no email/phone/ip/created_at, opt-out honored on both boards", () => {
  const src = read("src/app/api/leaderboard/route.ts");
  assert.ok(!/ownerEmail/.test(src), "DTO 不得含 ownerEmail");
  assert.ok(!/u\.email/.test(src), "SQL 不得查询 email");
  assert.ok(!/phone|ip_address|created_at/.test(src), "DTO 不得含手机号/IP/注册时间");
  const optOuts = src.match(/show_in_leaderboard = true/g) ?? [];
  assert.ok(optOuts.length >= 2, `积分榜+繁育榜都要过滤 opt-out，命中 ${optOuts.length} 处`);
  assert.match(src, /toPublicOwner/, "经公开投影输出");
  assert.match(src, /ownerName/, "仅展示昵称");
});

// ---------- 8. 其余公开 API：无邮箱泄露 ----------
test("public APIs sanitized: pets/daily, creator/pets, achievements", () => {
  const daily = read("src/app/api/pets/daily/route.ts");
  assert.ok(!/owner_email|u\.email|maskOwner/.test(daily), "daily 不得再用邮箱（含前缀脱敏）");
  assert.match(daily, /u\.username AS owner_name/);
  const creator = read("src/app/api/creator/pets/route.ts");
  assert.ok(!/creatorEmail|users\.email/.test(creator), "UGC 列表不得下发创作者邮箱");
  assert.match(creator, /creatorName: users\.username/);
  const ach = read("src/app/api/achievements/route.ts");
  assert.ok(!/email/i.test(ach), "成就接口不涉及邮箱");
});

// ---------- 9. 个人资料 API：GET/PATCH 存在、校验昵称、不触邮箱 ----------
test("user/profile: GET+PATCH with username validation, no email column access", () => {
  const src = read("src/app/api/user/profile/route.ts");
  assert.match(src, /export async function GET/);
  assert.match(src, /export async function PATCH/);
  assert.match(src, /validateUsername/);
  assert.match(src, /showInLeaderboard/);
  assert.match(src, /"usernameTaken"/);
  assert.ok(!/users\.email/.test(src), "profile 接口不读邮箱列");
});

// ---------- 10. 数据层：username 唯一非空 + user_0001 回填 + opt-out 列 + 版本闸门 ----------
test("schema + client DDL: username unique not-null, backfill, opt-out, version bumped", () => {
  const schema = read("src/db/schema.ts");
  assert.match(schema, /username: text\('username'\)\.notNull\(\)\.unique\(\)/);
  assert.match(schema, /showInLeaderboard: boolean\('show_in_leaderboard'\)\.notNull\(\)\.default\(true\)/, "默认参与排行榜");
  const client = read("src/db/client.ts");
  assert.match(client, /ADD COLUMN IF NOT EXISTS "username" text/);
  assert.match(client, /ADD COLUMN IF NOT EXISTS "show_in_leaderboard" boolean DEFAULT true NOT NULL/);
  assert.match(client, /'user_' \|\| lpad\(nextval/, "存量按 user_0001 格式回填");
  assert.match(client, /CREATE UNIQUE INDEX IF NOT EXISTS "users_username_key"/);
  assert.match(client, /ALTER COLUMN "username" SET NOT NULL/);
  const v = Number(client.match(/SCHEMA_VERSION = (\d+)/)?.[1]);
  assert.ok(v >= 4, `SCHEMA_VERSION 需 >=4，实际 ${v}`);
});

// ---------- 11. 前端：所有展示位从邮箱切换为昵称 ----------
test("frontend: email display replaced by username everywhere", () => {
  const header = read("src/components/layout/SiteHeader.tsx");
  assert.ok(!/me\.email/.test(header), "导航不再展示邮箱");
  assert.match(header, /me\.username/);
  assert.match(header, /href="\/settings"/, "导航提供设置入口");
  const home = read("src/app/[locale]/page.tsx");
  assert.ok(!/user\.email/.test(home), "首页不再展示邮箱");
  assert.match(home, /user\.username/);
  const panel = read("src/components/leaderboard-panel.tsx");
  assert.ok(!/ownerEmail/.test(panel), "排行榜组件不渲染邮箱");
  assert.match(panel, /ownerName/);
  const market = read("src/app/[locale]/marketplace/page.tsx");
  assert.ok(!/creatorEmail/.test(market), "广场不渲染创作者邮箱");
  const login = read("src/app/[locale]/login/page.tsx");
  assert.match(login, /\{ identifier, password \}/, "登录提交 identifier 双通道");
  const reg = read("src/app/[locale]/register/page.tsx");
  assert.match(reg, /\{ username, email, password \}/, "注册提交 username");
});

// ---------- 12. 设置页：改昵称 + 排行榜 opt-out 开关 ----------
test("settings page: username editor + leaderboard opt-out switch wired", () => {
  const src = read("src/app/[locale]/settings/page.tsx");
  assert.match(src, /\/api\/user\/profile/);
  assert.match(src, /showInLeaderboard: next/, "开关 PATCH opt-out");
  assert.match(src, /role="switch"/);
});

// ---------- 13. i18n：双语文案齐备且无 {email} 插值残留 ----------
test("i18n: owner/creatorLabel use {name}; new keys present in both locales", () => {
  const zh = readJson("messages/zh.json");
  const en = readJson("messages/en.json");
  for (const m of [zh, en]) {
    assert.ok(m.leaderboard.owner.includes("{name}") && !m.leaderboard.owner.includes("{email}"), "leaderboard.owner 用 {name}");
    assert.ok(m.marketplace.creatorLabel.includes("{name}") && !m.marketplace.creatorLabel.includes("{email}"), "creatorLabel 用 {name}");
    for (const k of ["usernameRequired", "usernameInvalid", "usernameTaken", "invalidPrivacySetting", "profileNothingToUpdate", "profileFailed"]) {
      assert.equal(typeof m.api[k], "string", `api.${k} 缺失`);
    }
    assert.equal(typeof m.nav.settings, "string", "nav.settings 缺失");
    assert.equal(typeof m.login.identifier, "string", "login.identifier 缺失");
    assert.equal(typeof m.register.username, "string", "register.username 缺失");
    assert.equal(typeof m.settings.leaderboardLabel, "string", "settings 命名空间缺失");
  }
});

// ---------- 14. 全局扫描：公开 src 代码无邮箱展示字段残留（admin 授权后台豁免） ----------
test("global audit: no ownerEmail/creatorEmail/owner_email leftovers outside admin", () => {
  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name === "admin") continue; // admin 为 role 鉴权的内部后台，邮箱展示属授权用途
        walk(p);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(name)) continue;
      const src = readFileSync(p, "utf8");
      if (/ownerEmail|creatorEmail|owner_email/.test(src)) offenders.push(p);
    }
  };
  walk(join(ROOT, "src/app/api"));
  walk(join(ROOT, "src/components"));
  walk(join(ROOT, "src/app/[locale]"));
  assert.deepEqual(offenders, [], `残留邮箱展示字段: ${offenders.join(", ")}`);
});


// ---------- 6. /api/auth/me：返回 username + 隐私开关，不含邮箱 ----------
test("me route: username + showInLeaderboard, no email in response", () => {
  const src = read("src/app/api/auth/me/route.ts");
  assert.match(src, /username: users\.username/);
  assert.match(src, /showInLeaderboard: users\.showInLeaderboard/);
  assert.ok(!/email: user\.email/.test(src), "me 响应不得包含 email");
});
