import { and, eq, gte, sql } from "drizzle-orm";

import { db, ensureDbSchemaOnce } from "@/db/client";
import { inviteRewards, users } from "@/db/schema";
import {
  INVITE_REWARD_VIP_DAYS,
  INVITE_DAILY_LIMIT,
  INVITE_ACTIVITY_WINDOW_MS,
} from "@/lib/referral";

/**
 * 裂变邀请 - DB 层。
 * 奖励状态机：注册带 ref → 插入 pending（冻结，防刷校验通过后）→
 * 被邀请人注册后 24h 内完成首次领养（releaseInviteReward）→ 发放 +50（credited）；
 * 超时未活跃 → 作废（expired）。
 */

/** 按邀请码查找邀请人（大小写不敏感，兼容新旧 6/8 位码）；不存在返回 null。 */
export async function findUserByInviteCode(code: string) {
  await ensureDbSchemaOnce();
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`upper(${users.inviteCode}) = ${code.trim().toUpperCase()}`)
    .limit(1);
  return row ?? null;
}

/** 24h 窗口内某条件（IP / 设备指纹）的已奖励次数。 */
async function countRecentRewards(column: "ip" | "deviceId", value: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(inviteRewards)
    .where(
      and(
        column === "ip" ? eq(inviteRewards.ip, value) : eq(inviteRewards.deviceId, value),
        gte(inviteRewards.createdAt, since),
      ),
    );
  return Number(rows[0]?.c ?? 0);
}

/**
 * 注册/绑定时创建「冻结」的邀请奖励（pending）。
 * 防刷：同一被邀请人不可重复绑定；同 IP 或同设备指纹 24h 内 ≤ INVITE_DAILY_LIMIT 次。
 */
export async function createPendingInviteReward(opts: {
  inviterId: string;
  invitedUserId: string;
  ip: string;
  deviceId: string;
}): Promise<{ ok: boolean; reason: string }> {
  await ensureDbSchemaOnce();
  const ip = opts.ip?.trim() || "";
  const deviceId = opts.deviceId?.trim() || "";

  // 同一被邀请人只允许一次绑定关系
  const dup = await db
    .select({ id: inviteRewards.id })
    .from(inviteRewards)
    .where(eq(inviteRewards.invitedUserId, opts.invitedUserId))
    .limit(1);
  if (dup.length > 0) {
    return { ok: false, reason: "already-bound" };
  }

  // 防刷：同 IP 24h 内 ≤3 次
  if (ip) {
    const n = await countRecentRewards("ip", ip);
    if (n >= INVITE_DAILY_LIMIT) {
      return { ok: false, reason: "ip-limit" };
    }
  }
  // 防刷：同设备指纹 24h 内 ≤3 次
  if (deviceId) {
    const n = await countRecentRewards("deviceId", deviceId);
    if (n >= INVITE_DAILY_LIMIT) {
      return { ok: false, reason: "device-limit" };
    }
  }

  await db.insert(inviteRewards).values({
    inviterId: opts.inviterId,
    invitedUserId: opts.invitedUserId,
    ip: ip || null,
    deviceId: deviceId || null,
    // amount 语义（P0 概念收敛起）：奖励面值 = 双方各得的 VIP 天数（原积分值废弃）
    amount: INVITE_REWARD_VIP_DAYS,
    status: "pending",
  });
  return { ok: true, reason: "pending" };
}

/** drizzle db 或事务句柄（execute 子集）。 */
type SqlExecutor = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> };

/**
 * 发放 VIP 天数（plan=trial3d，幂等）：
 *  - 确定性订阅 id + ON CONFLICT (id) DO NOTHING → 同一奖励来源重复执行/重试不叠加；
 *  - expires_at = GREATEST(now(), 现有 active 订阅最晚到期) + days → 未到期向后顺延，
 *    与 pay/notify 的 VIP 发放顺延口径一致；多笔体验卡可叠加。
 */
export async function grantVipDays(
  userId: string,
  days: number,
  subscriptionId: string,
  tx?: SqlExecutor,
): Promise<void> {
  const executor: SqlExecutor = tx ?? (db as unknown as SqlExecutor);
  await executor.execute(sql`
    INSERT INTO user_subscriptions (id, user_id, plan_id, status, started_at, expires_at, auto_renew)
    VALUES (
      ${subscriptionId}, ${userId}::uuid, 'trial3d', 'active', now(),
      GREATEST(now(), COALESCE((
        SELECT max(expires_at) FROM user_subscriptions
         WHERE user_id = ${userId}::uuid AND status = 'active'
      ), now())) + (${String(days)} || ' days')::interval,
      false
    )
    ON CONFLICT (id) DO NOTHING
  `);
}

/**
 * 被邀请人完成首次领养后调用：释放冻结奖励。
 *  - 注册后 24h 内 → 邀请人与被邀请人各得 INVITE_REWARD_VIP_DAYS 天 VIP（trial3d），
 *    奖励置 credited（P0 概念收敛：替代原邀请人单方 +50 积分）；
 *  - 超过 24h → 置 expired（不发放）。
 * 并发安全：先原子抢占 status='pending'→'credited'，抢到者才发放；
 * VIP 发放本身幂等（确定性订阅 id），事务重试不叠加。
 */
export async function releaseInviteReward(invitedUserId: string): Promise<{
  released: boolean;
  reason: string;
  inviterId?: string;
  vipDays?: number;
}> {
  await ensureDbSchemaOnce();
  const [row] = await db
    .select()
    .from(inviteRewards)
    .where(eq(inviteRewards.invitedUserId, invitedUserId))
    .limit(1);
  if (!row) return { released: false, reason: "no-pending" };
  if (row.status !== "pending") {
    return { released: false, reason: row.status };
  }

  const withinWindow = Date.now() - row.createdAt.getTime() <= INVITE_ACTIVITY_WINDOW_MS;
  if (!withinWindow) {
    await db
      .update(inviteRewards)
      .set({ status: "expired" })
      .where(eq(inviteRewards.id, row.id));
    return { released: false, reason: "expired" };
  }

  // 原子抢占：仅当仍为 pending 时置为 credited（防并发双发）
  const claimed = await db
    .update(inviteRewards)
    .set({ status: "credited", claimedAt: new Date() })
    .where(and(eq(inviteRewards.id, row.id), eq(inviteRewards.status, "pending")));
  if (claimed.rowCount === 0) {
    return { released: false, reason: "already-claimed" };
  }

  await db.transaction(async (tx) => {
    const executor = tx as unknown as SqlExecutor;
    await grantVipDays(
      row.inviterId,
      INVITE_REWARD_VIP_DAYS,
      `referral-${row.id}-inviter`,
      executor,
    );
    await grantVipDays(
      row.invitedUserId,
      INVITE_REWARD_VIP_DAYS,
      `referral-${row.id}-invited`,
      executor,
    );
  });

  return { released: true, inviterId: row.inviterId, vipDays: INVITE_REWARD_VIP_DAYS, reason: "credited" };
}

