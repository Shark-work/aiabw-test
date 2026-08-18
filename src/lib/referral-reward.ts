import { and, eq, sql } from "drizzle-orm";

import { db, ensureDbSchemaOnce } from "@/db/client";
import { inviteRewards, pointsLog, users } from "@/db/schema";
import { INVITE_REWARD_POINTS } from "@/lib/referral";

/**
 * 裂变邀请 - DB 层（奖励发放 + 邀请人查找）。
 */

/** 按邀请码查找邀请人；不存在返回 null。 */
export async function findUserByInviteCode(code: string) {
  await ensureDbSchemaOnce();
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.inviteCode, code))
    .limit(1);
  return row ?? null;
}

/**
 * 给邀请人发放邀请奖励（+50 积分，写入 points_log 与 invite_rewards）。
 * 防刷：同一 IP 或同一设备指纹（deviceId）最多触发一次；缺少指纹时拒绝发放。
 */
export async function creditInviteReward(opts: {
  inviterId: string;
  invitedUserId: string;
  ip: string;
  deviceId: string;
}): Promise<{ credited: boolean; reason: string }> {
  await ensureDbSchemaOnce();
  const ip = opts.ip?.trim() || "";
  const deviceId = opts.deviceId?.trim() || "";

  const conds = [];
  if (ip) conds.push(eq(inviteRewards.ip, ip));
  if (deviceId) conds.push(eq(inviteRewards.deviceId, deviceId));
  if (conds.length === 0) {
    return { credited: false, reason: "missing ip/device fingerprint" };
  }

  // 防刷检查：同 IP 或同设备指纹已发过奖励则不再发放
  const existing = await db
    .select({ id: inviteRewards.id })
    .from(inviteRewards)
    .where(and(...conds))
    .limit(1);
  if (existing.length > 0) {
    return { credited: false, reason: "anti-abuse: ip/device already rewarded" };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ points: sql`${users.points} + ${INVITE_REWARD_POINTS}` })
      .where(eq(users.id, opts.inviterId));
    await tx
      .insert(pointsLog)
      .values({ userId: opts.inviterId, amount: INVITE_REWARD_POINTS, reason: "invite_reward" });
    await tx
      .insert(inviteRewards)
      .values({
        inviterId: opts.inviterId,
        invitedUserId: opts.invitedUserId,
        ip: ip || null,
        deviceId: deviceId || null,
        amount: INVITE_REWARD_POINTS,
      });
  });
  return { credited: true, reason: "ok" };
}
