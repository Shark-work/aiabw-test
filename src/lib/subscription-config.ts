/**
 * 宠物旅行日记 · VIP 订阅档位元信息（前端展示 / 校验用）
 *
 * 数据库为真源（subscription_plans 表 + drizzle/0018_subscription.sql 种子）。
 * 本文件提供：
 *  - SUBSCRIPTION_FEATURES：VIP 权益键 → i18n 文案键
 *  - helpers：daysUntilExpiry() 等纯函数（无 DB 依赖）
 *  - getActiveSubscription / expireStaleSubscriptions：DB 依赖（动态 import 兼容 Node test）
 *
 * 服务端校验：所有价格/天数都从 DB 读取，禁止前端传金额。
 */

/** VIP 权益键（subscription_plans.features 数组里的元素；与 messages.{zh,en}.json 的 vipFeatures.* 对齐） */
export const SUBSCRIPTION_FEATURES = [
  "unlimitedChat",
  "memoryAccess",
  "rareEquipment",
  "exploreBoost",
  "rareEventBoost",
  "adFree",
  "vipBadge",
  "prioritySupport",
] as const;

export type SubscriptionFeature = (typeof SUBSCRIPTION_FEATURES)[number];

/** 档位 id（与 DB subscription_plans.id 一致） */
export const SUBSCRIPTION_PLAN_IDS = ["monthly", "quarterly", "yearly"] as const;
export type SubscriptionPlanId = (typeof SUBSCRIPTION_PLAN_IDS)[number];

/**
 * 距离到期剩余天数（向下取整；负数表示已过期）
 */
export function daysUntilExpiry(expiresAt: Date | string, now: Date = new Date()): number {
  const t = typeof expiresAt === "string" ? new Date(expiresAt).getTime() : expiresAt.getTime();
  const diff = t - now.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

/**
 * 格式化价格为 "¥19.9"（订阅页用）
 *  - priceRmb: 单位 = 分
 */
export function formatPrice(priceRmb: number, locale: "zh" | "en" = "zh"): string {
  const yuan = priceRmb / 100;
  if (locale === "en") {
    return `¥${yuan.toFixed(0)}`;
  }
  return `¥${yuan.toFixed(1)}`;
}

// ─────────────────────────────────────────────────────────────
// 以下函数依赖 drizzle/DB 客户端，仅在 Node 运行时（不在 .mjs 单测中）动态 import，
// 避免 Node 解析不了 "@/" 路径别名（tsconfig 的 paths 只在 next 编译期生效）。
// ─────────────────────────────────────────────────────────────

export type ActiveSubscription = {
  id: string;
  planId: string;
  status: string;
  startedAt: Date;
  expiresAt: Date;
  autoRenew: boolean;
  paymentId: string | null;
};

/**
 * 查询当前用户 active 订阅（expires_at > now），无则返回 null。
 *  - 不论 auto_renew，只要未到期都算 active
 *  - 多条 active（理论上不会出现）取 expires_at 最晚的一条
 */
export async function getActiveSubscription(
  userId: string | null | undefined,
): Promise<ActiveSubscription | null> {
  if (!userId || userId === "anonymous") return null;
  // 动态 import：避开 Node 直接 require ts/ESM "@/db" 路径
  const [{ db }, schema, drizzle] = await Promise.all([
    import("@/db/client"),
    import("@/db/schema"),
    import("drizzle-orm"),
  ]);
  try {
    const [row] = await db
      .select()
      .from(schema.userSubscriptions)
      .where(
        drizzle.and(
          drizzle.eq(schema.userSubscriptions.userId, userId),
          drizzle.eq(schema.userSubscriptions.status, "active"),
          drizzle.gt(schema.userSubscriptions.expiresAt, drizzle.sql`now()`),
        ),
      )
      .orderBy(drizzle.desc(schema.userSubscriptions.expiresAt))
      .limit(1);
    if (!row) return null;
    return {
      id: row.id,
      planId: row.planId,
      status: row.status,
      startedAt: row.startedAt,
      expiresAt: row.expiresAt,
      autoRenew: row.autoRenew,
      paymentId: row.paymentId,
    };
  } catch (err) {
    console.error("[subscription] getActiveSubscription failed:", err);
    return null;
  }
}

/**
 * 简便判断：是否有 active VIP
 */
export async function isVip(userId: string | null | undefined): Promise<boolean> {
  const sub = await getActiveSubscription(userId);
  return sub !== null;
}

/**
 * 软 SQL：把用户所有过期订阅标记为 expired（清理任务调用）
 *  - 返回受影响行数
 */
export async function expireStaleSubscriptions(userId?: string): Promise<number> {
  const { pool } = await import("@/db/client");
  const params: unknown[] = [];
  let where = `status = 'active' AND expires_at <= now()`;
  if (userId) {
    params.push(userId);
    where += ` AND user_id = $${params.length}::uuid`;
  }
  const { rowCount } = await pool.query(
    `UPDATE user_subscriptions SET status = 'expired' WHERE ${where}`,
    params,
  );
  return rowCount ?? 0;
}
