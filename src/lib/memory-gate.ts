/**
 * 宠物长期记忆 · VIP 访问控制（src/lib/memory-gate.ts）
 *
 * hasMemoryAccess(userId) → boolean
 *   查询 user_subscriptions 表，存在 status='active' 且 expires_at > NOW() 的记录则返回 true。
 *   供 chat 路由、记忆管理 API、记忆管理页面统一判断。
 *
 * 设计：复用 getActiveSubscription() 的判定语义（与聊天额度/导航栏 VIP 徽标一致），
 *       不在此处直接 SELECT 订阅表，避免与 subscription-config 出现多套真相源。
 */
import { getActiveSubscription } from "@/lib/subscription-config";

/** 当前用户是否拥有「宠物长期记忆」能力（仅 VIP 有效） */
export async function hasMemoryAccess(
  userId: string | null | undefined,
): Promise<boolean> {
  if (!userId) return false;
  const sub = await getActiveSubscription(userId);
  return sub !== null;
}
