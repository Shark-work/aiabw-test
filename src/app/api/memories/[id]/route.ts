import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { petMemories } from "@/db/schema";
import { getUserFromRequest } from "@/lib/auth";
import { hasMemoryAccess } from "@/lib/memory-gate";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import zhMessages from "../../../../../messages/zh.json";
import enMessages from "../../../../../messages/en.json";

/**
 * DELETE /api/memories/[id]
 *  - 仅 VIP；仅能删自己的记忆
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const locale = resolveLocale(req);
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { ok: false, code: "SIGN_IN_REQUIRED", error: apiError(locale, "signInFirst") },
      { status: 401 },
    );
  }
  const ok = await hasMemoryAccess(user.id);
  if (!ok) {
    const dict = (locale === "en" ? enMessages : zhMessages) as unknown as {
      memories?: Record<string, string>;
    };
    return NextResponse.json(
      {
        ok: false,
        code: "VIP_REQUIRED",
        error: dict.memories?.vipOnly ?? "VIP required",
      },
      { status: 403 },
    );
  }
  const { id } = await params;
  if (!id || typeof id !== "string") {
    return NextResponse.json(
      { ok: false, code: "BAD_REQUEST", error: "id required" },
      { status: 400 },
    );
  }
  const result = await db
    .delete(petMemories)
    .where(and(eq(petMemories.id, id), eq(petMemories.userId, user.id)))
    .returning({ id: petMemories.id });
  if (result.length === 0) {
    return NextResponse.json(
      { ok: false, code: "NOT_FOUND", error: "memory not found" },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, id: result[0].id });
}

/**
 * PUT /api/memories/[id]
 *  - 仅 VIP；仅能改自己的记忆
 *  - body: { content?: string; importance?: number; memoryType?: MemoryType }
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const locale = resolveLocale(req);
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { ok: false, code: "SIGN_IN_REQUIRED", error: apiError(locale, "signInFirst") },
      { status: 401 },
    );
  }
  const ok = await hasMemoryAccess(user.id);
  if (!ok) {
    const dict = (locale === "en" ? enMessages : zhMessages) as unknown as {
      memories?: Record<string, string>;
    };
    return NextResponse.json(
      {
        ok: false,
        code: "VIP_REQUIRED",
        error: dict.memories?.vipOnly ?? "VIP required",
      },
      { status: 403 },
    );
  }
  const { id } = await params;
  if (!id) {
    return NextResponse.json(
      { ok: false, code: "BAD_REQUEST", error: "id required" },
      { status: 400 },
    );
  }
  let body: {
    content?: string;
    importance?: number;
    memoryType?: string;
  } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }
  const update: {
    content?: string;
    importance?: number;
    memoryType?: "preference" | "event" | "fact" | "emotion";
  } = {};
  if (typeof body.content === "string") {
    const trimmed = body.content.trim();
    if (trimmed.length === 0) {
      return NextResponse.json(
        { ok: false, code: "BAD_REQUEST", error: "content empty" },
        { status: 400 },
      );
    }
    update.content = trimmed.slice(0, 1000);
  }
  if (typeof body.importance === "number") {
    update.importance = Math.max(1, Math.min(10, Math.round(body.importance)));
  }
  if (
    typeof body.memoryType === "string" &&
    ["preference", "event", "fact", "emotion"].includes(body.memoryType)
  ) {
    update.memoryType = body.memoryType as
      | "preference"
      | "event"
      | "fact"
      | "emotion";
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { ok: false, code: "BAD_REQUEST", error: "no fields to update" },
      { status: 400 },
    );
  }
  const result = await db
    .update(petMemories)
    .set(update)
    .where(and(eq(petMemories.id, id), eq(petMemories.userId, user.id)))
    .returning();
  if (result.length === 0) {
    return NextResponse.json(
      { ok: false, code: "NOT_FOUND", error: "memory not found" },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, memory: result[0] });
}
