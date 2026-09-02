/**
 * P2 Web Push 召回：零新增依赖实现（jose 签 VAPID JWT + node:crypto 做 RFC 8291 aes128gcm 加密）。
 *
 * 环境变量：
 *  - VAPID_PUBLIC_KEY  base64url 的 P-256 未压缩公钥点（65 字节，0x04 开头）
 *  - VAPID_PRIVATE_KEY base64url 的 P-256 私钥标量（32 字节）
 *  - VAPID_SUBJECT     联系方式（mailto: 或 https: 开头，push 服务要求）
 * 生成命令：node scripts/generate-vapid-keys.mjs
 * 未配置时 isPushConfigured() = false，相关接口优雅降级（前端隐藏推送入口）。
 */
import crypto from "node:crypto";
import { importPKCS8, SignJWT } from "jose";

export type WebPushSubscription = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type WebPushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  icon?: string;
};

export type PushSendResult = "success" | "gone" | "error";

/** base64url → Buffer */
function b64urlToBuf(s: string): Buffer {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64 + "=".repeat((4 - (b64.length % 4)) % 4), "base64");
}

export function getVapidKeys(): { publicKey: string; privateKey: string } | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim() || "";
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim() || "";
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey };
}

export function isPushConfigured(): boolean {
  return getVapidKeys() !== null;
}

/** 拼接二进制段（规避新版 @types/node 的 Buffer.concat 泛型摩擦） */
function concatBufs(parts: readonly Buffer[]): Buffer {
  const out = Buffer.alloc(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** 32 字节 P-256 私钥标量 → PKCS8 PEM（供 jose importPKCS8 签 ES256 JWT） */
function privateKeyToPkcs8Pem(scalar: Buffer): string {
  // ECPrivateKey(SEC1)：SEQUENCE { INTEGER 1, OCTET STRING(32) }
  const ecPriv = concatBufs([
    Buffer.from([0x02, 0x01, 0x01, 0x04, 0x20]),
    scalar,
  ]);
  const ecPrivSeq = concatBufs([Buffer.from([0x30, ecPriv.length]), ecPriv]);
  // AlgorithmIdentifier：SEQUENCE { OID id-ecPublicKey(1.2.840.10045.2.1), OID prime256v1(1.2.840.10045.3.1.7) }
  const alg = Buffer.from([
    0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
    0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07,
  ]);
  // PrivateKeyInfo(PKCS8)：SEQUENCE { INTEGER 0, alg, OCTET STRING(ecPrivSeq) }
  const body = concatBufs([
    Buffer.from([0x02, 0x01, 0x00]),
    alg,
    Buffer.from([0x04, ecPrivSeq.length]),
    ecPrivSeq,
  ]);
  const der = concatBufs([Buffer.from([0x30, body.length]), body]);
  const b64 = der.toString("base64").replace(/(.{64})/g, "$1\n").trimEnd();
  return `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`;
}

/** 生成 VAPID Authorization 头（RFC 8292，ES256 JWT，aud = push 服务 origin） */
async function vapidAuthorization(endpoint: string): Promise<string> {
  const keys = getVapidKeys();
  if (!keys) throw new Error("VAPID keys not configured");
  const privateKey = b64urlToBuf(keys.privateKey);
  if (privateKey.length !== 32) {
    throw new Error("Invalid VAPID private key length");
  }
  const key = await importPKCS8(privateKeyToPkcs8Pem(privateKey), "ES256");
  const audience = new URL(endpoint).origin;
  const subject =
    process.env.VAPID_SUBJECT?.trim() || "mailto:admin@aiabw.example.com";
  const token = await new SignJWT({ sub: subject })
    .setProtectedHeader({ alg: "ES256", typ: "JWT" })
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(key);
  return `vapid t=${token}, k=${keys.publicKey}`;
}

/** HKDF-Expand（单块输出，长度 ≤ 32 字节） */
function hkdfExpand(prk: Buffer, info: Buffer, length: number): Buffer {
  // 注：传 new Uint8Array(...) 拷贝以兼容旧版 @types/node 与 TS 5.8 泛型数组的类型差异
  const hmac = crypto.createHmac("sha256", new Uint8Array(prk));
  hmac.update(new Uint8Array(info));
  hmac.update(new Uint8Array([1])); // T(1) 计数器
  return hmac.digest().subarray(0, length);
}

/**
 * RFC 8291 aes128gcm 载荷加密（单记录）：
 *   body = salt(16) || rs(4, 4096) || keyid 长度(1=65) || 临时公钥(65) || AES-128-GCM 密文
 */
function encryptPayload(payload: string, p256dh: string, authSecret: string): Buffer {
  const uaPublic = b64urlToBuf(p256dh);
  if (uaPublic.length !== 65 || uaPublic[0] !== 0x04) {
    throw new Error("Invalid subscription p256dh key");
  }
  const auth = b64urlToBuf(authSecret);
  if (auth.length === 0) {
    throw new Error("Invalid subscription auth secret");
  }

  // 临时密钥对（as = application server）
  const eph = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const ephJwk = eph.publicKey.export({ format: "jwk" }) as {
    kty: string;
    crv: string;
    x: string;
    y: string;
  };
  const ephPublic = concatBufs([
    Buffer.from([0x04]),
    b64urlToBuf(ephJwk.x),
    b64urlToBuf(ephJwk.y),
  ]);

  // IKM = ECDH(ua_public, as_private) || as_public || ua_public
  const shared = crypto.diffieHellman({
    privateKey: eph.privateKey,
    publicKey: crypto.createPublicKey({
      key: {
        kty: "EC",
        crv: "P-256",
        x: uaPublic.subarray(1, 33).toString("base64url"),
        y: uaPublic.subarray(33, 65).toString("base64url"),
      },
      format: "jwk",
    }),
  });
  const ikm = concatBufs([shared, ephPublic, uaPublic]);

  // PRK = HKDF-Extract(salt = auth_secret, IKM)
  const prk = crypto
    .createHmac("sha256", new Uint8Array(auth))
    .update(new Uint8Array(ikm))
    .digest();

  // CEK / NONCE = HKDF-Expand(PRK, "WebPush: info" || 0x00 || ua_public || as_public)
  const info = concatBufs([
    Buffer.from("WebPush: info"),
    Buffer.from([0x00]),
    uaPublic,
    ephPublic,
  ]);
  const cek = hkdfExpand(prk, info, 16);
  const nonce = hkdfExpand(prk, info, 12);

  // 单记录明文：payload || 0x02（最后一条记录的分隔符 + 空填充）
  const plaintext = concatBufs([
    Buffer.from(payload, "utf8"),
    Buffer.from([0x02]),
  ]);
  const cipher = crypto.createCipheriv(
    "aes-128-gcm",
    new Uint8Array(cek),
    new Uint8Array(nonce),
  );
  const ciphertext = concatBufs([
    cipher.update(new Uint8Array(plaintext)),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  const salt = crypto.randomBytes(16);
  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(4096);
  return concatBufs([
    salt,
    recordSize,
    Buffer.from([ephPublic.length]), // keyid 长度 = 65
    ephPublic,
    ciphertext,
  ]);
}

/**
 * 给单个订阅发送 Web Push。
 * 返回 "success" | "gone"（404/410，订阅失效应删除）| "error"。
 */
export async function sendWebPush(
  sub: WebPushSubscription,
  payload: WebPushPayload,
  ttlSeconds = 86400,
): Promise<PushSendResult> {
  if (!isPushConfigured()) return "error";
  try {
    const body = encryptPayload(JSON.stringify(payload), sub.p256dh, sub.auth);
    const authorization = await vapidAuthorization(sub.endpoint);
    const res = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Encoding": "aes128gcm",
        TTL: String(ttlSeconds),
        Urgency: "normal",
        Authorization: authorization,
      },
      body: new Uint8Array(body),
    });
    // 200/201 = 已入队；404/410 = 订阅失效；429 = 限流（下个周期再试）
    if (res.ok) return "success";
    if (res.status === 404 || res.status === 410) return "gone";
    return "error";
  } catch (err) {
    console.error("[web-push] send failed:", err);
    return "error";
  }
}