import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPetLimitBody,
  evaluatePetLimit,
  FREE_PET_LIMIT,
  PET_LIMIT_MESSAGE,
} from "../src/lib/pet-limit.ts";

test("free user with 0 pets is allowed to adopt", () => {
  const d = evaluatePetLimit({ petCount: 0, isUnlocked: false, limit: FREE_PET_LIMIT });
  assert.equal(d.allowed, true);
  assert.equal(d.reason, "ok");
});

test("free user with 1 pet is blocked (single-pet rule)", () => {
  const d = evaluatePetLimit({ petCount: 1, isUnlocked: false, limit: FREE_PET_LIMIT });
  assert.equal(d.allowed, false);
  assert.equal(d.reason, "limit_reached");
});

test("globally unlocked user (paid once) is never blocked", () => {
  const d = evaluatePetLimit({ petCount: 10, isUnlocked: true, limit: FREE_PET_LIMIT });
  assert.equal(d.allowed, true);
  assert.equal(d.reason, "ok");
});

test("limit boundary is exclusive: petCount < limit allowed", () => {
  assert.equal(evaluatePetLimit({ petCount: 0, isUnlocked: false, limit: 2 }).allowed, true);
  assert.equal(evaluatePetLimit({ petCount: 1, isUnlocked: false, limit: 2 }).allowed, true);
  assert.equal(evaluatePetLimit({ petCount: 2, isUnlocked: false, limit: 2 }).allowed, false);
});

test("buildPetLimitBody carries payment hint fields", () => {
  const d = evaluatePetLimit({ petCount: 1, isUnlocked: false, limit: FREE_PET_LIMIT });
  const body = buildPetLimitBody(d, "adopt-123");
  assert.equal(body.ok, false);
  assert.equal(body.code, "PET_LIMIT_REACHED");
  assert.equal(body.needPayment, true);
  assert.equal(body.unlockAdoptionId, "adopt-123");
  assert.equal(body.petCount, 1);
  assert.equal(body.isUnlocked, false);
  assert.match(body.error, /解锁/);
  assert.ok(body.error.length > 0);
  assert.ok(PET_LIMIT_MESSAGE.length > 0);
});

