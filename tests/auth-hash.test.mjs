import crypto from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../src/lib/auth.ts";

test("v2 password hash roundtrip works", async () => {
  const hash = await hashPassword("secret123");
  assert.ok(hash.startsWith("v2$"));
  assert.equal(await verifyPassword("secret123", hash), true);
  assert.equal(await verifyPassword("wrong-password", hash), false);
});

test("legacy hash (no prefix, N=16384 default scrypt) still verifies", async () => {
  const salt = crypto.randomBytes(16).toString("hex");
  const legacy = `${salt}:${crypto.scryptSync("secret123", salt, 64).toString("hex")}`;
  assert.equal(await verifyPassword("secret123", legacy), true);
  assert.equal(await verifyPassword("wrong", legacy), false);
});

test("malformed stored hash is rejected", async () => {
  assert.equal(await verifyPassword("x", "garbage"), false);
  assert.equal(await verifyPassword("x", ""), false);
  assert.equal(await verifyPassword("x", "v2$onlysalt"), false);
});

test("two hashes of same password are salted differently", async () => {
  const a = await hashPassword("same-pw");
  const b = await hashPassword("same-pw");
  assert.notEqual(a, b);
});
