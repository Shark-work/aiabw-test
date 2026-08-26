import { test } from "node:test";
import assert from "node:assert/strict";
import { executeBlindboxDraw } from "../src/lib/blindbox-draw.ts";

// mock 事务客户端：幂等分支/池校验/正常执行（覆盖 mintCollectible 内部 SQL）
function makeClient(overrides = {}) {
  return {
    query: async (sql, params = []) => {
      if (sql.startsWith("SELECT 1 FROM blindbox_logs")) {
        return overrides.dup
          ? { rows: [{ exists: 1 }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.includes("FOR UPDATE") && sql.includes("blindbox_pools")) {
        return overrides.poolEmpty
          ? { rows: [], rowCount: 0 }
          : {
              rows: [
                {
                  id: "p1",
                  probabilities: { common: 1 },
                  speciesIds: [],
                  isActive: true,
                },
              ],
              rowCount: 1,
            };
      }
      if (sql.startsWith("SELECT d.id")) {
        return {
          rows: [
            { id: "sp1", nameZh: "测试兽", nameEn: "Test", category: "beast", habitat: "forest", imageUrl: "" },
          ],
          rowCount: 1,
        };
      }
      if (sql.startsWith("SELECT id FROM pet_dictionary")) {
        return { rows: [{ id: "sp1" }], rowCount: 1 };
      }
      if (sql.includes("FOR UPDATE") && sql.includes("digital_collectibles")) {
        return { rows: [{ total_supply: 0, minted: 0 }], rowCount: 1 };
      }
      if (sql.startsWith("INSERT INTO user_collectibles")) {
        return {
          rows: [
            {
              id: "uc1",
              hash_id: "h_abc123",
              locked_until: "2026-01-01T00:00:00Z",
              breed_cooldown_until: "2026-01-08T00:00:00Z",
            },
          ],
          rowCount: 1,
        };
      }
      // digital_collectibles upsert / UPDATE / blindbox_logs INSERT
      return { rows: [], rowCount: 1 };
    },
  };
}

test("blindbox-draw: 幂等 - order_id 已存在 → 返回 null（不重复抽/不铸造）", async () => {
  const client = makeClient({ dup: true });
  const r = await executeBlindboxDraw(client, {
    userId: "u1", poolId: "p1", payMethod: "xorpay", cost: 1, orderId: "dup-order",
  });
  assert.equal(r, null);
});

test("blindbox-draw: 奖池不可用/不存在 → 抛 blindboxUnavailable", async () => {
  const client = makeClient({ poolEmpty: true });
  await assert.rejects(
    executeBlindboxDraw(client, { userId: "u1", poolId: "nope", payMethod: "points", cost: 200 }),
    (err) => err.code === "blindboxUnavailable",
  );
});

test("blindbox-draw: 积分通道正常执行 → 返回稀有度/物种/铸造结果", async () => {
  const client = makeClient({});
  const r = await executeBlindboxDraw(client, {
    userId: "u1", poolId: "p1", payMethod: "points", cost: 200,
  });
  assert.ok(r, "应有结果");
  assert.equal(r.rarity, "common");
  assert.equal(r.isLegendary, false);
  assert.equal(r.speciesId, "sp1");
  assert.equal(r.speciesNameZh, "测试兽");
  assert.ok(r.hashId && r.collectibleId, "应有 hash/collectible id");
});

test("blindbox-draw: XorPay 通道带 order_id（无重复）→ 正常执行并返回结果", async () => {
  const client = makeClient({});
  const r = await executeBlindboxDraw(client, {
    userId: "u1", poolId: "p1", payMethod: "xorpay", cost: 1, orderId: "blindbox-p1-u1-abc",
  });
  assert.ok(r, "应有结果");
  assert.equal(r.rarity, "common");
});
