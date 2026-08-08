import { NextResponse } from "next/server";

import { ensureDbSchemaOnce } from "@/db/client";
import {
  readMemory,
  deleteMemoryFact,
  clearMemory,
  MEMORY_MAX_CHARS,
} from "@/lib/memory";

export const runtime = "nodejs";

/**
 * GET /api/memory?adoptionId=<id>
 * 返回该宠物的长期记忆（用于可视化/管理）。
 *
 * POST /api/memory  { adoptionId, action: 'delete'|'clear', text?: string }
 *  - delete：删除单条记忆（需 text）
 *  - clear：清空全部记忆
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const adoptionId = url.searchParams.get("adoptionId") ?? "";
  if (!adoptionId) {
    return NextResponse.json({ ok: false, error: "缺少 adoptionId" }, { status: 400 });
  }

  await ensureDbSchemaOnce();
  try {
    const data = await readMemory(adoptionId);
    return NextResponse.json({ ok: true, ...data });
  } catch (err) {
    console.error("[memory] GET failed:", err);
    return NextResponse.json({ ok: false, error: "读取记忆失败" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const adoptionId = typeof body?.adoptionId === "string" ? body.adoptionId : "";
  const action = body?.action;

  if (!adoptionId) {
    return NextResponse.json({ ok: false, error: "缺少 adoptionId" }, { status: 400 });
  }

  await ensureDbSchemaOnce();
  try {
    if (action === "clear") {
      await clearMemory(adoptionId);
      return NextResponse.json({
        ok: true,
        facts: [],
        usedChars: 0,
        maxChars: MEMORY_MAX_CHARS,
      });
    }

    if (action === "delete" && typeof body?.text === "string") {
      const facts = await deleteMemoryFact(adoptionId, body.text);
      if (!facts) {
        return NextResponse.json({ ok: false, error: "未找到该记忆" }, { status: 404 });
      }
      return NextResponse.json({
        ok: true,
        facts,
        usedChars: facts.reduce((s, f) => s + f.text.length, 0),
        maxChars: MEMORY_MAX_CHARS,
      });
    }

    return NextResponse.json({ ok: false, error: "无效操作" }, { status: 400 });
  } catch (err) {
    console.error("[memory] POST failed:", err);
    return NextResponse.json({ ok: false, error: "记忆管理失败" }, { status: 500 });
  }
}
