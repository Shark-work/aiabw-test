import { pool } from "@/db/client";

/**
 * 登录安全（防暴力破解）：
 *  - IP 频率限制：同一 IP 1 分钟最多 5 次登录，超限 429；
 *  - 验证码：同一 IP 累计失败 10 次 → 要求数学验证码（内存 TTL 5 分钟）；
 *  - 账户锁定：连续 5 次密码错误 → locked_until = now()+30min；
 *  - 审计：每次失败写入 login_attempts（ip, email, attempted_at）。
 * 内存计数器即可（单实例；生产多实例可换 Redis，接口不变）。
 */

const IP_LIMIT_WINDOW_MS = 60_000;
const IP_LIMIT_MAX = 5;
const CAPTCHA_FAIL_THRESHOLD = 10;
const CAPTCHA_TTL_MS = 5 * 60_000;
const LOCK_WINDOW_MINUTES = 30;
const MAX_FAILED_ATTEMPTS = 5;

/** IP 维度登录计数（1 分钟窗口）。 */
const ipAttempts = new Map<string, { count: number; resetTime: number }>();
/** IP 累计失败（达到阈值触发验证码）。 */
const ipFails = new Map<string, { count: number; resetTime: number }>();
/** 验证码：captchaId → { answer, expiresAt }。 */
const captchaStore = new Map<string, { answer: number; expiresAt: number }>();

function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown")
    .split(",")[0]
    .trim();
}

function bump(map: Map<string, { count: number; resetTime: number }>, key: string, windowMs: number) {
  const now = Date.now();
  const e = map.get(key);
  if (!e || now > e.resetTime) {
    map.set(key, { count: 1, resetTime: now + windowMs });
    return 1;
  }
  e.count += 1;
  return e.count;
}

/**
 * 检查 IP 是否超限。返回剩余秒数（>0 表示被限流），0 表示放行。
 */
export function ipRateLimited(req: Request): { limited: boolean; retryAfterSec?: number } {
  const ip = clientIp(req);
  const e = ipAttempts.get(ip);
  const now = Date.now();
  if (e && now <= e.resetTime && e.count >= IP_LIMIT_MAX) {
    return { limited: true, retryAfterSec: Math.ceil((e.resetTime - now) / 1000) };
  }
  return { limited: false };
}

export function recordIpAttempt(req: Request): void {
  bump(ipAttempts, clientIp(req), IP_LIMIT_WINDOW_MS);
}

export function recordIpFail(req: Request): void {
  const ip = clientIp(req);
  const count = bump(ipFails, ip, IP_LIMIT_WINDOW_MS);
  if (count >= CAPTCHA_FAIL_THRESHOLD) {
    // 阈值达成，触发验证码
  }
}

export function captchaRequiredFor(req: Request): boolean {
  const e = ipFails.get(clientIp(req));
  const now = Date.now();
  return !!e && now <= e.resetTime && e.count >= CAPTCHA_FAIL_THRESHOLD;
}

export function resetIpFails(req: Request): void {
  ipFails.delete(clientIp(req));
}

/** 生成数学验证码：返回 { captchaId, question }。 */
export function issueCaptcha(): { captchaId: string; question: string } {
  const a = 1 + Math.floor(Math.random() * 9);
  const b = 1 + Math.floor(Math.random() * 9);
  const id = "cap_" + cryptoRandom();
  captchaStore.set(id, { answer: a + b, expiresAt: Date.now() + CAPTCHA_TTL_MS });
  return { captchaId: id, question: `${a} + ${b} = ?` };
}

function cryptoRandom(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/** 校验验证码答案；正确则删除（一次性）。 */
export function verifyCaptcha(captchaId: string, answer: unknown): boolean {
  const e = captchaStore.get(captchaId);
  if (!e) return false;
  captchaStore.delete(captchaId);
  return Date.now() <= e.expiresAt && Number(answer) === e.answer;
}

/** 连续失败计数（按账号），写入 login_attempts 并判断是否锁定。返回是否触发锁定。 */
export async function recordFailedLogin(req: Request, email: string): Promise<boolean> {
  const ip = clientIp(req);
  await pool
    .query(`INSERT INTO login_attempts (ip, email) VALUES ($1, $2)`, [ip, email || null])
    .catch(() => {});
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM login_attempts
      WHERE email = $1 AND attempted_at >= now() - interval '30 minutes'`,
    [email],
  );
  return (rows[0]?.n ?? 0) >= MAX_FAILED_ATTEMPTS;
}

export async function lockAccount(userId: string): Promise<void> {
  await pool.query(
    `UPDATE users SET locked_until = now() + make_interval(mins => $1) WHERE id = $2::uuid`,
    [LOCK_WINDOW_MINUTES, userId],
  );
}

export async function isAccountLocked(userId: string): Promise<{ locked: boolean; minutesLeft?: number }> {
  const { rows } = await pool.query(
    `SELECT locked_until, round(EXTRACT(EPOCH FROM (locked_until - now())) / 60)::int AS mins
       FROM users WHERE id = $1::uuid`,
    [userId],
  );
  const mins = Number(rows[0]?.mins ?? 0);
  if (rows[0]?.locked_until && mins > 0) {
    return { locked: true, minutesLeft: Math.max(1, mins) };
  }
  return { locked: false };
}

export async function clearLockAndTouchLogin(userId: string): Promise<void> {
  await pool.query(
    `UPDATE users SET locked_until = NULL, last_login_at = now() WHERE id = $1::uuid`,
    [userId],
  );
}
