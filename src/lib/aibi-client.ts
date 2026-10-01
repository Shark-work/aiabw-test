/**
 * 艾比平台 Phase 5 · 浏览器端 API 助手（仅限客户端组件使用）
 *  - 统一注入 Authorization: Bearer（localStorage aiabw_token）与 x-locale；
 *  - 统一解包 Phase 4 响应格式：成功 { data } / 失败 { code, message }；
 *  - 失败抛 AibiClientError（code 即 Phase 4 错误码，message 已被服务端按 locale 本地化）。
 */

export class AibiClientError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function readAibiToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem("aiabw_token");
}

interface FetchOptions {
  method?: "GET" | "POST";
  body?: unknown;
  locale?: string;
  /** 显式传入令牌；缺省自动读 localStorage */
  token?: string | null;
}

/** 调艾比 API 并解包 data；HTTP/业务失败一律抛 AibiClientError。 */
export async function aibiFetch<T = unknown>(path: string, opts: FetchOptions = {}): Promise<T> {
  const token = opts.token !== undefined ? opts.token : readAibiToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.locale) headers["x-locale"] = opts.locale;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new AibiClientError("NETWORK_ERROR", "Network error.", 0);
  }

  const json = (await res.json().catch(() => ({}))) as {
    data?: T;
    code?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new AibiClientError(
      json.code ?? "INTERNAL_ERROR",
      json.message ?? "Internal server error.",
      res.status,
    );
  }
  return json.data as T;
}
