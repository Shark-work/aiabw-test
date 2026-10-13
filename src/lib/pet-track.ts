/**
 * 宠物模块埋点（需求八）：GA gtag + 百度 _hmt 双通道，统计脚本缺席/异常静默跳过
 *（与 onboarding-wizard 的 trackStep 同模式；零第三方依赖新增）。
 *
 * 五关键事件：页面访问 / 发送对话 / 点击喂食 / 购买道具 / 退出页面——
 * 用于留存与转化漏斗分析（进入→对话→喂食→购买→离开）。
 */
export type PetTrackEvent =
  | "pet_page_view"
  | "pet_chat_send"
  | "pet_feed_click"
  | "pet_item_buy"
  | "pet_page_exit";

/** 发送单条宠物埋点（防御性：隐私插件/离线导致统计脚本未加载时静默）。 */
export function trackPet(event: PetTrackEvent, params?: Record<string, string | number>): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as {
    gtag?: (...args: unknown[]) => void;
    _hmt?: { push: (args: unknown[]) => void };
  };
  try {
    w.gtag?.("event", event, params ?? {});
    w._hmt?.push(["_trackEvent", "pet", event, params ? JSON.stringify(params) : ""]);
  } catch {
    /* 统计脚本异常不影响互动 */
  }
}

/**
 * 页面退出埋点（pet_page_exit 只发一次）：
 * visibilitychange 切隐藏（移动端主路径）+ beforeunload（桌面关闭/刷新）双保险；
 * 返回清理函数（React useEffect cleanup）。
 */
export function trackPetExitOnce(page: string): () => void {
  let sent = false;
  const send = () => {
    if (sent) return;
    sent = true;
    trackPet("pet_page_exit", { page });
  };
  const onVis = () => {
    if (document.visibilityState === "hidden") send();
  };
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("beforeunload", send);
  return () => {
    document.removeEventListener("visibilitychange", onVis);
    window.removeEventListener("beforeunload", send);
  };
}
