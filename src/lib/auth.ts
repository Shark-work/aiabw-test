import crypto from "crypto";
import { promisify } from "util";
import { SignJWT, jwtVerify } from "jose";

/**
 * 账号认证工具：
 *  - 密码：node crypto 的 scrypt（无需额外依赖，安全）。
 *  - Token：JWT（HS256），通过 jose 生成/校验。
 *
 * 环境变量：
 *   - AUTH_SECRET  JWT 签名密钥（务必在生产环境配置一个足够随机的值）。
 */

const AUTH_SECRET = process.env.AUTH_SECRET ?? "dev-insecure-change-me";
const TOKEN_TTL = "30d";

/**
 * scrypt 成本参数。
 *  - 旧哈希（无前缀）：N=16384（Node scryptSync 默认），保持可校验。
 *  - 新哈希（v2$ 前缀）：N=8192。理由：Vercel Lambda CPU 上 N=16384 的
 *    scrypt 耗时约 60ms，是 login/register 的主要耗时；N=8192 约 30ms。
 *    对小型应用属于可接受的平衡（如需更高安全性可改回 16384/32768）。
 */
const SCRYPT_N_V2 = 8192;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const V2_PREFIX = "v2$";

/** 异步 scrypt（libuv 线程池执行，避免阻塞 Node 事件循环，提升并发登录/注册体验）。 */
const scryptAsync = promisify(crypto.scrypt) as (
  password: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  keylen: number,
  options: crypto.ScryptOptions,
) => Promise<Buffer>;

function secretKey(): Uint8Array {
  return new TextEncoder().encode(AUTH_SECRET);
}

/** 密码哈希：scrypt，格式 `[v2$]salt:hash`（salt 16 字节 hex，hash 64 字节 hex）。 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await scryptAsync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N_V2,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `${V2_PREFIX}${salt}:${hash.toString("hex")}`;
}

/** 校验密码是否匹配存储的哈希（兼容 v2 与旧格式）。 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const isV2 = stored.startsWith(V2_PREFIX);
  const body = isV2 ? stored.slice(V2_PREFIX.length) : stored;
  const [salt, hash] = body.split(":");
  if (!salt || !hash) return false;
  const cost = isV2 ? SCRYPT_N_V2 : 16384; // 旧哈希用默认 16384
  const candidate = await scryptAsync(password, salt, SCRYPT_KEYLEN, {
    N: cost,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  const expected = Buffer.from(hash, "hex");
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(
    new Uint8Array(candidate),
    new Uint8Array(expected),
  );
}

export type AuthUser = { id: string; email: string };

/** 签发 JWT。 */
export async function signToken(user: AuthUser): Promise<string> {
  return new SignJWT({ email: user.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(secretKey());
}

/** 校验 JWT；无效/过期返回 null。 */
export async function verifyToken(token: string): Promise<AuthUser | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (typeof payload.sub !== "string") return null;
    return {
      id: payload.sub,
      email: typeof payload.email === "string" ? payload.email : "",
    };
  } catch {
    return null;
  }
}

/** 从请求的 Authorization: Bearer <token> 头解析当前登录用户。 */
export async function getUserFromRequest(req: Request): Promise<AuthUser | null> {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return verifyToken(token);
}
