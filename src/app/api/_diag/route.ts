import { NextResponse } from "next/server";

/**
 * 【临时诊断端点，用完即删】探测生产环境 AI 提供商环境变量配置与上游连通性。
 * 安全：需携带一次性随机头 x-diag-key；只回传 key 前 6 位 + 长度，绝不回传完整值。
 */
export const runtime = "nodejs";
export const maxDuration = 30;

const DIAG_KEY = "diag-7f3k9x2mq8w1";

interface ProviderProbe {
  set: boolean;
  prefix?: string;
  length?: number;
  baseURL?: string;
  model?: string;
  upstreamStatus?: number;
  upstreamError?: string;
}

async function probeUpstream(
  baseURL: string,
  apiKey: string,
  model: string,
): Promise<{ status: number; error?: string }> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`${baseURL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 1,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    let err: string | undefined;
    if (!res.ok) {
      const text = await res.text();
      err = text.slice(0, 160);
    }
    return { status: res.status, error: err };
  } catch (e) {
    return { status: -1, error: String(e).slice(0, 120) };
  }
}

export async function GET(req: Request) {
  if (req.headers.get("x-diag-key") !== DIAG_KEY) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const report: Record<string, ProviderProbe> = {};

  const openaiKey = process.env.OPENAI_API_KEY;
  report.openai = { set: !!openaiKey };
  if (openaiKey) {
    const baseURL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    const r = await probeUpstream(baseURL, openaiKey, model);
    report.openai = {
      set: true,
      prefix: openaiKey.slice(0, 6),
      length: openaiKey.length,
      baseURL,
      model,
      upstreamStatus: r.status,
      upstreamError: r.error,
    };
  }

  const dsKey = process.env.DEEPSEEK_API_KEY;
  report.deepseek = { set: !!dsKey };
  if (dsKey) {
    const baseURL = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
    const model = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
    const r = await probeUpstream(baseURL, dsKey, model);
    report.deepseek = {
      set: true,
      prefix: dsKey.slice(0, 6),
      length: dsKey.length,
      baseURL,
      model,
      upstreamStatus: r.status,
      upstreamError: r.error,
    };
  }

  const blKey = process.env.BAILIAN_API_KEY;
  report.bailian = { set: !!blKey };
  if (blKey) {
    const baseURL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
    const model = process.env.BAILIAN_MODEL ?? "qwen-turbo";
    const r = await probeUpstream(baseURL, blKey, model);
    report.bailian = {
      set: true,
      prefix: blKey.slice(0, 6),
      length: blKey.length,
      baseURL,
      model,
      upstreamStatus: r.status,
      upstreamError: r.error,
    };
  }

  report.meta = {
    set: true,
    prefix: `node ${process.version}`,
    baseURL: process.env.VERCEL_ENV ?? "unknown",
  };

  return NextResponse.json(report);
}
