import crypto from "crypto";
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

function secretKey(): Uint8Array {
  return new TextEncoder().encode(AUTH_SECRET);
}

/** 密码哈希：scrypt，格式 `salt:hash`（salt 16 字节 hex，hash 64 字节 hex）。 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

/** 校验密码是否匹配存储的哈希。 */
export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
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
