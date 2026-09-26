// 手机端 XorPay 微信支付适配单测
// 背景：微信官方全面禁用「长按识别二维码」→ 手机端按 UA 分流：
//   微信内置浏览器 → pay_type=jsapi（WeixinJSBridge 拉起收银台，需 openid）
//   外部浏览器     → pay_type=native（二维码 + 微信「扫一扫」引导，5 分钟重刷）
// 覆盖：UA 检测、JSAPI 参数组装、Native 二维码返回、支付回调、
//      openid OAuth 双路由、前端桥接契约、i18n 双语。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  isWechatUserAgent,
  isValidOpenid,
  sanitizeReturnPath,
  buildXorpayOpenidUrl,
  extractJsapiParams,
} from "../src/lib/xorpay.ts";

const ROOT = join(import.meta.dirname ?? __dirname, "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

// ───────────── 1) UA 检测逻辑（纯函数） ─────────────
test("isWechatUserAgent: MicroMessenger UA → true，外部浏览器/null → false", () => {
  const wxUa =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 " +
    "(KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.44(0x18002c2d) NetType/WIFI Language/zh_CN";
  assert.equal(isWechatUserAgent(wxUa), true);
  assert.equal(
    isWechatUserAgent("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36"),
    false,
  );
  assert.equal(isWechatUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), false);
  assert.equal(isWechatUserAgent(null), false);
  assert.equal(isWechatUserAgent(undefined), false);
  assert.equal(isWechatUserAgent(""), false);
});

// ───────────── 2) openid 校验 / 回跳路径清洗（纯函数） ─────────────
test("isValidOpenid: 合法 openid 通过，非法/注入串拒绝", () => {
  assert.equal(isValidOpenid("o6_bmjrPTlm6_2sgVt7hMZOPfL2M"), true);
  assert.equal(isValidOpenid("abc-DEF_1234567890xy"), true);
  assert.equal(isValidOpenid("short"), false);
  assert.equal(isValidOpenid("has space in middle openid"), false);
  assert.equal(isValidOpenid('"><script>alert(1)</script>'), false);
  assert.equal(isValidOpenid(""), false);
  assert.equal(isValidOpenid(null), false);
  assert.equal(isValidOpenid(undefined), false);
});

test("sanitizeReturnPath: 仅放行站内相对路径，防开放重定向", () => {
  assert.equal(sanitizeReturnPath("/subscribe"), "/subscribe");
  assert.equal(sanitizeReturnPath("/zh/subscribe?x=1"), "/zh/subscribe?x=1");
  assert.equal(sanitizeReturnPath("https://evil.com/x"), "/subscribe");
  assert.equal(sanitizeReturnPath("//evil.com/x"), "/subscribe");
  assert.equal(sanitizeReturnPath("javascript:alert(1)"), "/subscribe");
  assert.equal(sanitizeReturnPath(""), "/subscribe");
  assert.equal(sanitizeReturnPath(null), "/subscribe");
});

test("buildXorpayOpenidUrl: 指向 XorPay openid 接口且 callback 已编码", () => {
  const callback = "https://www.aiabw.com/api/subscription/wechat-oauth/callback?return=%2Fsubscribe";
  const url = buildXorpayOpenidUrl(callback);
  assert.ok(url.startsWith("https://xorpay.com/api/openid/"), "XorPay openid endpoint");
  assert.ok(url.includes("callback=" + encodeURIComponent(callback)), "callback urlencoded");
});

// ───────────── 3) JSAPI 参数组装（纯函数） ─────────────
test("extractJsapiParams: 完整 info → 六字段齐备；缺字段/非对象 → null", () => {
  const ok = extractJsapiParams({
    status: "ok",
    info: {
      appId: "wx8888888888888888",
      timeStamp: "1716800000",
      nonceStr: "5K8264ILTKCH16CQ2502SI8ZNMTM67VS",
      package: "prepay_id=wx201410272009395522657a690399285100",
      signType: "MD5",
      paySign: "C380BEC2BFD727A4B6845133519F3AD6",
    },
  });
  assert.deepEqual(ok, {
    appId: "wx8888888888888888",
    timeStamp: "1716800000",
    nonceStr: "5K8264ILTKCH16CQ2502SI8ZNMTM67VS",
    package: "prepay_id=wx201410272009395522657a690399285100",
    signType: "MD5",
    paySign: "C380BEC2BFD727A4B6845133519F3AD6",
  });
  assert.equal(
    extractJsapiParams({ info: { appId: "a", timeStamp: "1", nonceStr: "n", package: "p", signType: "MD5" } }),
    null,
    "缺 paySign → null",
  );
  assert.equal(extractJsapiParams({ status: "ok" }), null, "info 缺失 → null");
  assert.equal(extractJsapiParams(null), null, "非对象 → null");
  assert.equal(
    extractJsapiParams({ info: { appId: "", timeStamp: "1", nonceStr: "n", package: "p", signType: "MD5", paySign: "s" } }),
    null,
    "空串字段 → null",
  );
});

// ───────────── 4) xorpay lib 契约：openid 附加提交但不参与签名 ─────────────
test("xorpay lib: createXorpayOrder 支持 openid 附加字段，签名串不含 openid", () => {
  const src = read("src/lib/xorpay.ts");
  assert.match(src, /openid\?: string/, "createXorpayOrder fields 含可选 openid");
  assert.match(src, /form\.set\("openid", fields\.openid\)/, "openid 附加到表单");
  // 官方签名顺序固定为 name+pay_type+price+order_id+notify_url+app_secret，openid 不参与
  const signStart = src.indexOf("export function buildXorpaySign");
  const signEnd = src.search(/\/\*\*\r?\n \* 统一下单/);
  assert.ok(signStart > -1 && signEnd > signStart, "buildXorpaySign 定位");
  const signFn = src.slice(signStart, signEnd);
  assert.ok(!/openid/.test(signFn), "buildXorpaySign 不得引入 openid");
});


// ───────────── 5) 下单路由：UA 分流 + JSAPI 分支 + Native 二维码回归 ─────────────
test("subscription/create: UA 检测 MicroMessenger → jsapi；缺 openid → needOpenid 400", () => {
  const src = read("src/app/api/subscription/create/route.ts");
  assert.match(src, /isWechatUserAgent\(req\.headers\.get\("user-agent"\)\)/, "服务端 UA 检测");
  assert.match(src, /inWechat \? "jsapi" : getXorpayPayType\(\)/, "微信内强制 jsapi，其余保持配置");
  assert.match(src, /needOpenid: true/, "缺 openid 返回结构化 needOpenid");
  assert.match(src, /isValidOpenid/, "openid 格式校验");
});

test("subscription/create: JSAPI 成功 → channel=jsapi + jsapiParams；notify_url 不变", () => {
  const src = read("src/app/api/subscription/create/route.ts");
  assert.match(src, /extractJsapiParams\(data\)/, "提取收银台参数");
  assert.match(src, /channel: "jsapi" as const/, "JSAPI 响应标记 channel");
  assert.match(src, /jsapiParams,/, "透传 jsapiParams");
  assert.match(src, /    openid,\r?\n  \}\);/, "下单携带 openid");
  // notify_url 两种模式共用 resolveNotifyUrl（支付结果仍走异步回调确认）
  assert.match(src, /const notifyUrl = resolveNotifyUrl\(\);/);
  assert.match(src, /notify_url: notifyUrl,/);
});

test("subscription/create: 非微信 UA → channel=native + qr 二维码（回归）", () => {
  const src = read("src/app/api/subscription/create/route.ts");
  assert.match(src, /channel: "native" as const/, "Native 响应标记 channel");
  assert.match(src, /XorPay returned no QR code/, "无二维码兜底 502 保留");
  assert.match(src, /d\.qr \?\? d\.qrcode/, "qr 多字段兼容提取保留");
});

// ───────────── 6) openid OAuth 双路由契约 ─────────────
test("wechat-oauth: 302 → XorPay openid 接口，callback 带回 return，防开放跳转", () => {
  const src = read("src/app/api/subscription/wechat-oauth/route.ts");
  assert.match(src, /export async function GET/);
  assert.match(src, /buildXorpayOpenidUrl\(callback\.toString\(\)\)/, "跳转 XorPay OAuth");
  assert.match(src, /NextResponse\.redirect\([^,]+, 302\)/, "302 重定向");
  assert.match(src, /sanitizeReturnPath\(url\.searchParams\.get\("return"\)\)/, "return 站内校验");
  assert.match(src, /wechat-oauth\/callback/, "callback 指向本站回调路由");
  assert.match(src, /XORPAY_AID/, "aid 缺失时 500 兜底");
});

test("wechat-oauth/callback: 校验 openid 后拼回前端页；失败带 wx_auth=failed", () => {
  const p = join(ROOT, "src/app/api/subscription/wechat-oauth/callback/route.ts");
  assert.ok(existsSync(p));
  const src = readFileSync(p, "utf8");
  assert.match(src, /export async function GET/);
  assert.match(src, /isValidOpenid\(openid\)/, "openid 格式校验");
  assert.match(src, /target\.searchParams\.set\("openid", openid\)/, "openid 透传给前端");
  assert.match(src, /target\.searchParams\.set\("wx_auth", "failed"\)/, "失败标记");
  assert.match(src, /sanitizeReturnPath/, "return 站内校验");
  assert.ok(!/json\(\s*\{[^}]*openid/.test(src), "openid 不经 JSON 响应（仅 302 回跳）");
});

// ───────────── 7) 支付回调（notify）回归：验签与订阅入账不变 ─────────────
test("pay/notify: 官方验签顺序 + subscription- 订单解析保持不变", () => {
  const src = read("src/app/api/pay/notify/route.ts");
  assert.match(
    src,
    /md5\(\s*`\$\{aoid\}\$\{order_id\}\$\{pay_price\}\$\{pay_time\}\$\{XORPAY_APP_SECRET\}`/,
    "验签串 aoid+order_id+pay_price+pay_time+secret 不变",
  );
  assert.match(src, /\^subscription-\(monthly\|quarterly\|yearly\)-/, "订阅订单前缀解析保留");
  assert.match(src, /user_subscriptions/, "订阅入账保留");
  assert.match(src, /return new Response\("success"/, "成功应答 success（停止 XorPay 重试）");
});

// ───────────── 8) 前端：微信检测 + JSAPI 拉起 + 回调处理 ─────────────
test("subscribe-client: 客户端 MicroMessenger 检测 + openid 缓存/OAuth 跳转", () => {
  const src = read("src/components/subscription/subscribe-client.tsx");
  assert.match(src, /navigator\.userAgent\.includes\("MicroMessenger"\)/, "客户端 UA 检测");
  assert.match(src, /sessionStorage\.setItem\(OPENID_KEY/, "openid 写入会话缓存");
  assert.match(src, /\/api\/subscription\/wechat-oauth\?return=/, "无 openid 时跳 OAuth");
  assert.match(src, /PENDING_PLAN_KEY/, "记录待支付计划以便回跳续单");
  assert.match(src, /wx_auth.*failed/s, "授权失败提示分支");
});

test("subscribe-client: WeixinJSBridge 拉起收银台 + 未就绪兜底", () => {
  const src = read("src/components/subscription/subscribe-client.tsx");
  assert.match(src, /WeixinJSBridge\?\.invoke\?\.\(\s*"getBrandWCPayRequest"/, "getBrandWCPayRequest 拉起");
  assert.match(
    src,
    /document\.addEventListener\("WeixinJSBridgeReady", doInvoke, \{ once: true \}\)/,
    "WeixinJSBridgeReady 兜底",
  );
  assert.match(src, /interface Window \{[\s\S]*?WeixinJSBridge\?:/, "TS 全局声明");
});

test("subscribe-client: 支付回调 ok → confirming 轮询；cancel/fail 分支", () => {
  const src = read("src/components/subscription/subscribe-client.tsx");
  assert.match(src, /"get_brand_wcpay_request:ok"/, "成功判定");
  assert.match(src, /setPayModal\(\{ kind: "confirming", planId, orderId \}\)/, "成功后进入确认态（后端回调为准）");
  assert.match(src, /msg\.includes\(":cancel"\)/, "取消分支");
  assert.match(src, /payModal\.kind !== "qr" && payModal\.kind !== "confirming"/, "轮询覆盖 qr+confirming 两态");
  assert.match(src, /\/api\/subscription\/status/, "主动查询订单状态确认");
});

// ───────────── 9) 前端：Native 二维码引导 + 5 分钟重刷 ─────────────
test("subscribe-client: 扫码引导文案 + 5 分钟二维码过期重刷", () => {
  const src = read("src/components/subscription/subscribe-client.tsx");
  assert.match(src, /const QR_REFRESH_MS = 5 \* 60 \* 1000/, "5 分钟刷新常量");
  assert.match(src, /\{t\("scanGuide"\)\}/, "「扫一扫」引导文案渲染");
  assert.match(src, /createOrder\(planId, null\)/, "到期静默重新下单换新码（仅刷新 effect 不带 openid）");
  assert.match(src, /channel === "jsapi" && data\.jsapiParams/, "JSAPI 响应分流拉起");
});

// ───────────── 10) i18n：新增 key 双语齐备 ─────────────
test("i18n: subscription 新增 payCancelled/payConfirming/scanGuide/openidFailed 双语", () => {
  const zh = JSON.parse(read("messages/zh.json"));
  const en = JSON.parse(read("messages/en.json"));
  for (const key of ["payCancelled", "payConfirming", "scanGuide", "openidFailed"]) {
    assert.equal(typeof zh.subscription[key], "string", `zh.subscription.${key} 缺失`);
    assert.equal(typeof en.subscription[key], "string", `en.subscription.${key} 缺失`);
  }
  assert.ok(zh.subscription.scanGuide.includes("扫一扫"), "中文引导含「扫一扫」");
});

