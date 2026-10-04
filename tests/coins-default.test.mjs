// 探险商城死表清理（2026-10-09）：users.coins 默认值 200→0 契约测试
//  1) drizzle schema：coins default(0) 且不再出现 default(200)；
//  2) client.ts DDL：ADD COLUMN 默认 0 + 存量库幂等纠偏 SET DEFAULT 0 + SCHEMA_VERSION ≥ 14；
//  3) 注册链路不显式插入 coins（走列默认值，新用户即 0）；
//  4) 无隐蔽发币路径：业务代码不存在 coins 充值/赠送写路径（仅购买扣减）。
// 运行：node --experimental-loader ./tests/_paths-loader.mjs --test tests/coins-default.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, rel), "utf8");

test("coins(1): drizzle schema coins default(0)，coins 行无 default(200) 残留", () => {
  const schema = read("../src/db/schema.ts");
  assert.match(schema, /coins: integer\('coins'\)\.notNull\(\)\.default\(0\)/);
  // 行级断言（aibi_items.price_points default(200) 是合法定价，不能全文件禁 200）
  assert.ok(!/coins:.*default\(200\)/.test(schema), "coins 行不得残留 default(200)");
});

test("coins(2): client.ts DDL 默认 0 + 存量库幂等纠偏 + SCHEMA_VERSION ≥ 14", () => {
  const client = read("../src/db/client.ts");
  assert.match(client, /ADD COLUMN IF NOT EXISTS "coins" integer DEFAULT 0 NOT NULL/);
  // ADD COLUMN IF NOT EXISTS 不更新已存在列的 DEFAULT → 需幂等 SET DEFAULT 纠偏存量库
  assert.match(client, /ALTER TABLE "users" ALTER COLUMN "coins" SET DEFAULT 0/);
  assert.ok(!/ADD COLUMN IF NOT EXISTS "coins" integer DEFAULT 200/.test(client), "DDL 不得残留 DEFAULT 200");
  const ver = client.match(/const SCHEMA_VERSION = (\d+);/);
  assert.ok(ver && Number(ver[1]) >= 14, "SCHEMA_VERSION 必须 ≥ 14（coins 默认值迁移）");
});

test("coins(3): 注册链路不显式插入 coins（新用户走列默认值 = 0）", () => {
  const register = read("../src/app/api/auth/register/route.ts");
  const values = register.match(/\.values\(\{[^}]+\}\)/s);
  assert.ok(values, "register 应存在 drizzle .values({...}) 插入");
  assert.ok(!values[0].includes("coins"), "注册不得显式插入 coins（走列默认值）");
});

test("coins(4): 无隐蔽发币写路径（SET coins = coins + 只应出现在购买退款式语境之外）", () => {
  // 全仓 src 扫描：coins 的写操作只应出现为「扣减」（购买）或「校验余额」，
  // 不允许存在给用户增加 coins 的业务写路径（死表语义：无获取渠道）。
  const srcRoot = join(here, "../src");
  const files = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name)) files.push(p);
    }
  })(srcRoot);
  const creditPattern = /coins\s*=\s*coins\s*\+|coins:\s*[^,}]*\+\s*\d|increment.*coins/i;
  const offenders = [];
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    if (creditPattern.test(text)) offenders.push(f);
  }
  assert.deepEqual(offenders, [], `发现 coins 增发写路径：${offenders.join(", ")}`);
});
