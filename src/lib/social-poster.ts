// 社交分享模块：微博 / X(Twitter) 自动发布（供「繁育出传说/史诗宠物」炫耀动态触发）。
//
// 安全规范：
//  - 凭证仅通过 process.env 动态读取（支持 WEIBO_* / TWITTER_* / X_* 多套命名），
//    绝不硬编码；未配置时优雅降级（返回 ok:false，不抛异常）。
//  - 所有发布调用均为异步非阻塞；调用方需 catch，失败只记录错误日志。
//
// 发帖文案：优先调用 AI（getModel）按宠物基因/稀有度生成带话题标签的炫耀文案，
// 失败自动回退到本地模板（保证零成本可用）。
import crypto from "crypto";
import { generateText } from "ai";

/** 依次读取环境变量，返回第一个非空值。 */
function env(names: string[]): string {
  for (const n of names) {
    const v = process.env[n];
    if (v && v.trim()) return v.trim();
  }
  return "";
}

// 微博（OAuth2 简化：access_token 直调）
const weiboToken = () => env(["WEIBO_ACCESS_TOKEN", "WEIBO_TOKEN", "WEIBO_API_KEY"]);
// X / Twitter（OAuth1.0a）
const xKey = () => env(["X_API_KEY", "TWITTER_API_KEY"]);
const xSecret = () => env(["X_API_SECRET", "TWITTER_API_SECRET"]);
const xAccessToken = () => env(["X_ACCESS_TOKEN", "TWITTER_ACCESS_TOKEN"]);
const xAccessTokenSecret = () => env(["X_ACCESS_TOKEN_SECRET", "TWITTER_ACCESS_SECRET"]);

export type SocialPlatformConfig = { weibo: boolean; twitter: boolean };

/** 当前社交凭证配置状态。 */
export function isSocialConfigured(): SocialPlatformConfig {
  return {
    weibo: !!weiboToken(),
    twitter: !!(xKey() && xAccessToken()),
  };
}

export type BreedShareMeta = {
  speciesName: string;
  rarity: string;
  element?: string;
  generation: number;
  hashId?: string;
};

/** 本地模板文案（AI 不可用时回退，零成本）。 */
export function buildFallbackShareText(meta: BreedShareMeta): string {
  const r = meta.rarity === "legendary" ? "传说" : "史诗";
  const elem = meta.element ? ` · ${meta.element}元素` : "";
  const shortHash = meta.hashId ? ` #${meta.hashId.slice(0, 8)}` : "";
  return (
    `🎉 我的艾比繁育出了${r}级「${meta.speciesName}」！` +
    `第 ${meta.generation} 代${elem}，独一无二${shortHash}～` +
    ` #艾比世界 #${r}宠物 #繁育炫耀`
  );
}

/** AI 生成炫耀文案（带话题标签），失败回退模板。 */
export async function generateShareText(meta: BreedShareMeta): Promise<string> {
  try {
    // 动态加载模型（避免模块级依赖；Next 编译正常解析，Node 测试自动回退模板）
    const { getModel } = await import("@/lib/get-model");
    const { text } = await generateText({
      model: getModel(),
      system:
        "你是艾比世界（AIABW）的社媒运营助手。请用活泼、有成就感的语气生成一条用于微博/X 的宠物炫耀文案，必须自然带上话题标签：#艾比世界 和稀有度标签。",
      prompt: `请为下面这只新繁育的宠物生成一条中文炫耀文案（不超过 100 字，包含 emoji 与话题标签）：${JSON.stringify(meta)}`,
      maxOutputTokens: 160,
    });
    const clean = text.trim().replace(/\s+/g, " ").slice(0, 280);
    return clean || buildFallbackShareText(meta);
  } catch (err) {
    console.error("[social] AI 文案生成失败，使用模板:", err instanceof Error ? err.message : err);
    return buildFallbackShareText(meta);
  }
}


/** OAuth1.0a 请求签名（HMAC-SHA1），用于 X / Twitter v2 API。 */
export function oauth1Header(opts: {
  method: string;
  url: string;
  params: Record<string, string>;
  consumerKey: string;
  consumerSecret: string;
  token: string;
  tokenSecret: string;
}): string {
  const oauth = {
    oauth_consumer_key: opts.consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: opts.token,
    oauth_version: "1.0",
  };
  const all: Record<string, string> = { ...oauth, ...opts.params };
  const paramStr = Object.keys(all)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(all[k])}`)
    .join("&");
  const base = `${opts.method.toUpperCase()}&${encodeURIComponent(opts.url)}&${encodeURIComponent(paramStr)}`;
  const key = `${encodeURIComponent(opts.consumerSecret)}&${encodeURIComponent(opts.tokenSecret)}`;
  const sig = crypto.createHmac("sha1", key).update(base).digest("base64");
  const header = Object.entries({ ...oauth, oauth_signature: sig })
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}="${encodeURIComponent(v)}"`)
    .join(", ");
  return `OAuth ${header}`;
}

/** 发布到 X / Twitter（未配置 / 网络失败 → 返回 ok:false，绝不抛异常）。 */
export async function publishToTwitter(text: string): Promise<{ ok: boolean; error?: string }> {
  const key = xKey();
  const token = xAccessToken();
  if (!key || !token) return { ok: false, error: "twitter not configured" };
  try {
    const url = "https://api.twitter.com/2/tweets";
    const auth = oauth1Header({
      method: "POST",
      url,
      params: {},
      consumerKey: key,
      consumerSecret: xSecret(),
      token,
      tokenSecret: xAccessTokenSecret(),
    });
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, error: `twitter status ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "twitter request failed" };
  }
}

/**
 * 组合发帖：生成文案 → 依次发布到已配置平台。
 * 全程非阻塞容错：任何一步失败只记录错误日志，绝不抛出。
 */
export async function postBreedShare(
  meta: BreedShareMeta,
): Promise<{ posted: boolean; results: Array<{ ok: boolean; error?: string }> }> {
  const text = await generateShareText(meta);
  const cfg = isSocialConfigured();
  const results: Array<{ ok: boolean; error?: string }> = [];
  if (cfg.weibo) results.push(await publishToWeibo(text));
  if (cfg.twitter) results.push(await publishToTwitter(text));
  if (results.length === 0) {
    console.log("[social] 未配置社交凭证，跳过发帖（不影响业务）");
  } else {
    for (const r of results) {
      if (r.ok) console.log("[social] 发帖成功");
      else console.error("[social] 发帖失败(非阻塞):", r.error);
    }
  }
  return { posted: results.some((r) => r.ok), results };
}

/** 发布到微博（未配置 / 网络失败 → 返回 ok:false，绝不抛异常）。 */
export async function publishToWeibo(text: string): Promise<{ ok: boolean; error?: string }> {
  const token = weiboToken();
  if (!token) return { ok: false, error: "weibo not configured" };
  try {
    const res = await fetch("https://api.weibo.com/2/statuses/share.json", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ access_token: token, status: text }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, error: `weibo status ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "weibo request failed" };
  }
}

