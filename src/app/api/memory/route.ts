import { NextResponse } from "next/server";

import { ensureDbSchemaOnce } from "@/db/client";
import {
  readMemory,
  deleteMemoryFact,
  clearMemory,
  addMemoryFact,
  updateMemoryFact,
  pinMemoryFact,
  type MemoryCategory,
  MEMORY_MAX_CHARS,
} from "@/lib/memory";

export const runtime = "nodejs";

function factsResponse(facts: { text: string; ts: number }[]) {
  return {
    facts,
    usedChars: facts.reduce((s, f) => s + f.text.length, 0),
    maxChars: MEMORY_MAX_CHARS,
  };
}

/**
 * GET /api/memory?adoptionId=<id>
 * 返回该宠物的长期记忆（用于可视化/管理）。
 *
 * POST /api/memory { adoptionId, action, ... }
 *  - add：新增记忆，{ text, category?: 'user'|'pet' }
 *  - update：编辑记忆，{ oldText, text, category?: 'user'|'pet' }
 *  - delete：删除单条记忆，{ text }
 *  - clear：清空全部记忆
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const adoptionId = url.searchParams.get("adoptionId") ?? "";
  if (!adoptionId) {
    return NextResponse.json({ ok: false, error: "adoptionId is required" }, { status: 400 });
  }

  await ensureDbSchemaOnce();
  try {
    const data = await readMemory(adoptionId);
    return NextResponse.json({ ok: true, ...data });
  } catch (err) {
    console.error("[memory] GET failed:", err);
    return NextResponse.json({ ok: false, error: "Failed to load memories" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const adoptionId = typeof body?.adoptionId === "string" ? body.adoptionId : "";
  const action = body?.action;
  const category: MemoryCategory | undefined =
    body?.category === "pet" || body?.category === "user" ? body.category : undefined;

  if (!adoptionId) {
    return NextResponse.json({ ok: false, error: "adoptionId is required" }, { status: 400 });
  }

  await ensureDbSchemaOnce();
  try {
    if (action === "clear") {
      await clearMemory(adoptionId);
      return NextResponse.json({ ok: true, ...factsResponse([]) });
    }

    if (action === "add" && typeof body?.text === "string" && body.text.trim()) {
      const facts = await addMemoryFact(adoptionId, body.text.trim(), category);
      return NextResponse.json({ ok: true, ...factsResponse(facts) });
    }

    if (
      action === "update" &&
      typeof body?.oldText === "string" &&
      typeof body?.text === "string" &&
      body.text.trim()
    ) {
      const facts = await updateMemoryFact(adoptionId, body.oldText, body.text.trim(), category);
      if (!facts) {
        return NextResponse.json({ ok: false, error: "Memory not found" }, { status: 404 });
      }
      return NextResponse.json({ ok: true, ...factsResponse(facts) });
    }

    if (action === "delete" && typeof body?.text === "string") {
      const facts = await deleteMemoryFact(adoptionId, body.text);
      if (!facts) {
        return NextResponse.json({ ok: false, error: "Memory not found" }, { status: 404 });
      }
      return NextResponse.json({ ok: true, ...factsResponse(facts) });
    }

    if (
      (action === "pin" || action === "unpin") &&
      typeof body?.text === "string"
    ) {
      const facts = await pinMemoryFact(adoptionId, body.text, action === "pin");
      if (!facts) {
        return NextResponse.json({ ok: false, error: "Memory not found" }, { status: 404 });
      }
      return NextResponse.json({ ok: true, ...factsResponse(facts) });
    }

    return NextResponse.json({ ok: false, error: "Invalid action" }, { status: 400 });
  } catch (err) {
    console.error("[memory] POST failed:", err);
    return NextResponse.json({ ok: false, error: "Memory management failed" }, { status: 500 });
  }
}
