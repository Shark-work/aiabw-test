import crypto from "crypto";

/**
 * 裂变邀请 - 纯逻辑层（无 DB / 无 Next 依赖，便于单元测试）。
 */

/** 邀请人奖励积分 */
export const INVITE_REWARD_POINTS = 50;

const INVITE_CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** 生成唯一邀请码（8 位字母数字）。 */
export function generateInviteCode(length = 8): string {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += INVITE_CODE_ALPHABET[bytes[i] % INVITE_CODE_ALPHABET.length];
  }
  return out;
}

/** 从请求头提取客户端 IP（Vercel 走 x-forwarded-for）。 */
export function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "";
}
