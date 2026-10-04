import crypto from "crypto";

/**
 * 裂变邀请 - 纯逻辑层（无 DB / 无 Next 依赖，便于单元测试）。
 */

/** 邀请返利 VIP 天数（P0 概念收敛 2026-10-14，替代原 +50 积分）：
 *  被邀请人活跃验证（注册 24h 内首次领养）通过后，邀请人与被邀请人各得该天数的
 *  VIP 体验卡（plan=trial3d，见 referral-reward.ts grantVipDays）。 */
export const INVITE_REWARD_VIP_DAYS = 3;
/** 被邀请人新手礼包积分（注册即发放） */
export const WELCOME_BONUS_POINTS = 20;
/** 同 IP / 设备指纹 24h 内最多发放次数（防刷） */
export const INVITE_DAILY_LIMIT = 3;
/** 被邀请人活跃验证窗口：注册后 24h 内完成首次领养才发放 */
export const INVITE_ACTIVITY_WINDOW_MS = 24 * 60 * 60 * 1000;

const INVITE_CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** 生成唯一邀请码（6 位大写字母+数字）。 */
export function generateInviteCode(length = 6): string {
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
