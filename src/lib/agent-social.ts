/**
 * 数字人 Agent - 社交平台发布库
 *
 * 安全：所有凭据一律从环境变量读取，绝不在代码中硬编码：
 *   - X：    X_API_KEY / X_API_SECRET（必填）+ X_ACCESS_TOKEN / X_ACCESS_TOKEN_SECRET（发布必需）
 *   - 小红书：XHS_TOKEN（必填）；小红书无公开发帖 API，若配置了第三方网关
 *            XHS_POST_ENDPOINT 则转发，否则以 dry-run 模拟（便于验收闭环）。
 * 缺少凭据时优雅返回错误对象，绝不抛异常导致服务崩溃。
 */
import crypto from "crypto";

const X_API_KEY = process.env.X_API_KEY ?? "";
const X_API_SECRET = process.env.X_API_SECRET ?? "";
const X_ACCESS_TOKEN = process.env.X_ACCESS_TOKEN ?? "";
const X_ACCESS_TOKEN_SECRET = process.env.X_ACCESS_TOKEN_SECRET ?? "";
const XHS_TOKEN = process.env.XHS_TOKEN ?? "";
const XHS_POST_ENDPOINT = process.env.XHS_POST_ENDPOINT ?? "";

export type PostResult = {
  ok: boolean;
  platform: "x" | "xhs";
  externalId?: string | null;
  dryRun?: boolean;
  error?: string;
  note?: string;
};

export function isSocialPlatform(v: unknown): v is "x" | "xhs" {
  return v === "x" || v === "xhs";
}

/* ---------------------------------------------------------------------------
 * OAuth 1.0a 签名（纯 Node crypto，无第三方依赖）
 * ------------------------------------------------------------------------- */
function percentEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

function hmacSha1Base64(key: string, base: string): string {
  return crypto.createHmac("sha1", key).update(base).digest("base64");
}

function buildOAuth1Authorization(
  method: string,
  url: string,
  bodyParams: Record<string, string>,
): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: X_API_KEY,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: X_ACCESS_TOKEN,
    oauth_version: "1.0",
  };
  const all: Record<string, string> = { ...bodyParams, ...oauth };
  const paramString = Object.keys(all)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(all[k])}`)
    .join("&");
  const base =
    method.toUpperCase() +
    "&" +
    percentEncode(url) +
    "&" +
    percentEncode(paramString);
  const signingKey = percentEncode(X_API_SECRET) + "&" + percentEncode(X_ACCESS_TOKEN_SECRET);
  oauth.oauth_signature = hmacSha1Base64(signingKey, base);
  return (
    "OAuth " +
    Object.keys(oauth)
      .sort()
      .map((k) => `${percentEncode(k)}="${percentEncode(oauth[k])}"`)
      .join(", ")
  );
}

/* ---------------------------------------------------------------------------
 * X (Twitter) - POST /2/tweets（OAuth 1.0a 用户上下文发推）
 * ------------------------------------------------------------------------- */
async function postToX(text: string): Promise<PostResult> {
  if (!X_API_KEY || !X_API_SECRET) {
    return {
      ok: false,
      platform: "x",
      error: "X API credentials not configured (X_API_KEY / X_API_SECRET) - please set them in Vercel env",
    };
  }
  if (!X_ACCESS_TOKEN || !X_ACCESS_TOKEN_SECRET) {
    return {
      ok: false,
      platform: "x",
      error:
        "X user access tokens not configured (X_ACCESS_TOKEN / X_ACCESS_TOKEN_SECRET) - required to post. Generate them in the X developer portal (user auth).",
    };
  }

  const url = "https://api.twitter.com/2/tweets";
  const bodyParams = { text };
  const authorization = buildOAuth1Authorization("POST", url, bodyParams);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(bodyParams),
    });
    const data = (await res.json().catch(() => ({}))) as {
      data?: { id?: string };
      title?: string;
      detail?: string;
    };
    if (!res.ok) {
      return {
        ok: false,
        platform: "x",
        error: `X API rejected the post (${res.status} ${data.title ?? ""}) ${data.detail ?? ""}`.trim(),
      };
    }
    return { ok: true, platform: "x", externalId: data.data?.id ?? null };
  } catch (err) {
    return {
      ok: false,
      platform: "x",
      error: `X API request failed: ${err instanceof Error ? err.message : "network error"}`,
    };
  }
}

/* ---------------------------------------------------------------------------
 * 小红书 (XHS) - 无官方公开发帖 API
 *   配置了 XHS_POST_ENDPOINT（第三方自动化网关）则转发；
 *   否则 dry-run 模拟（返回 ok + dryRun，便于验收）。
 * ------------------------------------------------------------------------- */
async function postToXhs(text: string): Promise<PostResult> {
  if (!XHS_TOKEN) {
    return {
      ok: false,
      platform: "xhs",
      error: "XHS_TOKEN not configured - please set it in Vercel env",
    };
  }
  if (XHS_POST_ENDPOINT) {
    try {
      const res = await fetch(XHS_POST_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${XHS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: text }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        id?: string;
        error?: string;
      };
      if (!res.ok) {
        return { ok: false, platform: "xhs", error: `XHS gateway error (${res.status}) ${data.error ?? ""}`.trim() };
      }
      return { ok: true, platform: "xhs", externalId: data.id ?? null };
    } catch (err) {
      return {
        ok: false,
        platform: "xhs",
        error: `XHS gateway request failed: ${err instanceof Error ? err.message : "network error"}`,
      };
    }
  }
  // 无网关：dry-run 模拟（只记录，不真实发布）
  console.log("[agent-social] XHS dry-run post (no XHS_POST_ENDPOINT gateway):", text.slice(0, 120));
  return {
    ok: true,
    platform: "xhs",
    dryRun: true,
    externalId: null,
    note: "XHS has no public posting API. Configure XHS_POST_ENDPOINT (a third-party automation gateway) to actually publish; until then this is a dry-run.",
  };
}

/** 统一发布入口：缺少凭据时返回 { ok:false, error }，绝不抛异常。 */
export async function postToSocial(
  platform: "x" | "xhs",
  text: string,
): Promise<PostResult> {
  if (platform === "x") return postToX(text);
  if (platform === "xhs") return postToXhs(text);
  return { ok: false, platform, error: "unsupported platform" };
}

