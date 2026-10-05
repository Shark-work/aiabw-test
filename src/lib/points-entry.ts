/**
 * 积分充值入口强化（产品升级 Phase 4）：全局「积分不足」事件总线。
 *
 * 任何页面捕获到 402 / 积分不足错误 → notifyPointsInsufficient() →
 * SiteHeader 挂载的 PointsRechargeHost 监听事件并弹起充值引导：
 * 未首充用户 → FirstPurchaseModal（首充双倍特惠）；
 * 已首充用户 → PointsInsufficientModal（常规充值引导）。
 */
export const POINTS_INSUFFICIENT_EVENT = "aiabw:points-insufficient";

export type PointsInsufficientDetail = {
  /** 目标操作所需积分（弹窗差额提示用，可选） */
  needed?: number;
};

/** 触发全局「积分不足」充值引导弹窗（SSR 安全：非浏览器环境静默 no-op）。 */
export function notifyPointsInsufficient(detail: PointsInsufficientDetail = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(POINTS_INSUFFICIENT_EVENT, { detail }));
}
