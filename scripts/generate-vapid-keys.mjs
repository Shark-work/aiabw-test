#!/usr/bin/env node
/**
 * 生成 Web Push VAPID 密钥对（P-256）：
 *   node scripts/generate-vapid-keys.mjs
 * 输出可直接写入 .env.local / Vercel 环境变量的两行配置。
 */
import crypto from "node:crypto";

const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", {
  namedCurve: "P-256",
});

// 公钥：未压缩点（65 字节：0x04 || X || Y）→ base64url
// SPKI DER 尾部 = BIT STRING{ 0x00 || point }，取最后 65 字节即为 point
const spki = publicKey.export({ type: "spki", format: "der" });
const point = spki.subarray(spki.length - 65);
if (point[0] !== 0x04) {
  throw new Error("Unexpected EC point encoding");
}

// 私钥：JWK 的 d 标量（32 字节）→ base64url
const jwk = privateKey.export({ format: "jwk" });

console.log("# 复制到 .env.local（或 Vercel 项目环境变量）：");
console.log(`VAPID_PUBLIC_KEY=${point.toString("base64url")}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);
console.log("# 建议再设置 VAPID_SUBJECT=mailto:你的邮箱");
