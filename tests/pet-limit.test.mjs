import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPetLimitBody,
  evaluatePetLimit,
  FREE_PET_LIMIT,
  PET_LIMIT_MESSAGE,
} from "../src/lib/pet-limit.ts";

test("free user with 0 pets is allowed to adopt", () => {
  const d = evaluatePetLimit({ petCount: 0, unlockedPetCount: 0, limit: FREE_PET_LIMIT });
  assert.equal(d.allowed, true);
  assert.equal(d.reason, "ok");
});

test("free user with 1 pet is blocked (single-pet rule)", () => {
  const d = evaluatePetLimit({ petCount: 1, unlockedPetCount: 0, limit: FREE_PET_LIMIT });
  assert.equal(d.allowed, false);
  assert.equal(d.reason, "limit_reached");
  assert.equal(d.hasUnlocked, false);
});

test("paid user (any unlocked pet) is not blocked even with many pets", () => {
  const d = evaluatePetLimit({ petCount: 5, unlockedPetCount: 1, limit: FREE_PET_LIMIT });
  assert.equal(d.allowed, true);
  assert.equal(d.hasUnlocked, true);
});

test("limit boundary is exclusive: petCount < limit allowed", () => {
  assert.equal(evaluatePetLimit({ petCount: 0, unlockedPetCount: 0, limit: 2 }).allowed, true);
  assert.equal(evaluatePetLimit({ petCount: 1, unlockedPetCount: 0, limit: 2 }).allowed, true);
  assert.equal(evaluatePetLimit({ petCount: 2, unlockedPetCount: 0, limit: 2 }).allowed, false);
});

test("buildPetLimitBody carries payment hint fields", () => {
  const d = evaluatePetLimit({ petCount: 1, unlockedPetCount: 0, limit: FREE_PET_LIMIT });
  const body = buildPetLimitBody(d, "adopt-123");
  assert.equal(body.ok, false);
  assert.equal(body.code, "PET_LIMIT_REACHED");
  assert.equal(body.needPayment, true);
  assert.equal(body.unlockAdoptionId, "adopt-123");
  assert.equal(body.petCount, 1);
  assert.match(body.error, /解锁/);
  assert.ok(body.error.length > 0);
  assert.ok(PET_LIMIT_MESSAGE.length > 0);
});
