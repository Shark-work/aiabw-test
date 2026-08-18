import { NextResponse } from "next/server";

import { isMemoryType } from "@/lib/agent-embedding";
import {
  listMemories,
  setMemoryImportant,
  writeMemory,
} from "@/lib/agent-memory";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * 数字人记忆 - 统一收口 API（所有记忆写入/查询/标记都走这里）：
 *
 * GET  /api/agent/memories?limit=50
 *   列出最近访问的记忆（重要记忆优先）。
 *
 * POST /api/agent/memories
 *   请求体（按 action 区分）：
 *     { action: "write", type: "fact"|"skill"|"user_preference", content: string, important?: boolean }
 *       写入记忆（自动语义去重；important 标记为核心记忆，豁免 30 天清理 → 跨日沉淀）。
 *     { action: "pin",   id: string }   将已有记忆标记为核心记忆
 *     { action: "unpin", id: string }   取消核心标记
 *
 * 安全：必须携带 Authorization: Bearer <CRON_SECRET>（与 Vercel Cron 同密钥）。
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200);
  const memories = await listMemories(limit);
  return NextResponse.json({ ok: true, count: memories.length, memories });
}

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const action = body?.action;
  if (action === "write") {
    const type = body?.type;
    const content = typeof body?.content === "string" ? body.content.trim() : "";
    if (!isMemoryType(type)) {
      return NextResponse.json(
        { ok: false, error: "type must be 'fact' | 'skill' | 'user_preference'" },
        { status: 400 },
      );
    }
    if (!content) {
      return NextResponse.json({ ok: false, error: "content is required" }, { status: 400 });
    }
    const result = await writeMemory(type, content, {
      important: body?.important === true,
    });
    return NextResponse.json({ ok: true, ...result });
  }

  if (action === "pin" || action === "unpin") {
    const id = typeof body?.id === "string" ? body.id : "";
    if (!id) {
      return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
    }
    await setMemoryImportant(id, action === "pin");
    return NextResponse.json({ ok: true, id, important: action === "pin" });
  }

  return NextResponse.json(
    { ok: false, error: "unknown action (write | pin | unpin)" },
    { status: 400 },
  );
}
