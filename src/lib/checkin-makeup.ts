/**
 * 断签补签（XorPay kind=checkin_makeup）服务端常量与订单号工具（单一数据源）。
 *
 * 业务语义（/api/user/checkin P0-2 落地）：
 *  - 断签（last_checkin_date < 昨天 且 checkin_streak > 0）用户可付 ¥1 补签「昨天」；
 *  - 支付回调只回填 last_checkin_date=昨天（幂等、只前进），streak 不在回调中修改——
 *    签到逻辑只看 last_checkin_date 是否昨天，用户当天再签到时自然 streak+1 延续；
 *  - 价格/补签日期只信服务端（下单时计算并固化进订单号），客户端不传金额（防改价）。
 *
 * 改动本文件常量 = 价格变更，无需 bump SCHEMA_VERSION（纯代码常量）。
 */

/** 补签价格：¥1（checkin 路由 P0-2 定价） */
export const CHECKIN_MAKEUP_PRICE_CNY = 1;

/** 本地时区日期串 YYYY-MM-DD（与 /api/user/checkin 的 dateStr 规则一致；字典序即日期序）。 */
export function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 补签订单号：checkin-makeup-<userId>-<yyyy-mm-dd>-<nonce>（notify 从中解析固化的补签日期）。 */
export function makeupOrderId(userId: string, date: string, nonce: string): string {
  return `checkin-makeup-${userId}-${date}-${nonce}`;
}

/** /api/pay/notify 解析用：捕获 userId（uuid）与补签日期（yyyy-mm-dd）。 */
export const MAKEUP_ORDER_RE =
  /^checkin-makeup-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(\d{4}-\d{2}-\d{2})-/i;
