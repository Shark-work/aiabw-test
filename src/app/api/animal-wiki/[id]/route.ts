import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db, ensureDbSchemaOnce } from "@/db/client";
import { animalWiki } from "@/db/schema";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { toKnowledgeSnapshot } from "@/lib/exploration-engine";

export const runtime = "nodejs";

/**
 * GET /api/animal-wiki/[id]
 * 公共接口：按 species id 查动物百科详情。
 * - traits / fun_facts 在 DB 中是 JSON 字符串；这里反序列化为 string[]。
 * - 找不到 → 404 animalWikiNotFound。
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ensureDbSchemaOnce();
    const { id } = await params;
    if (!id) {
      return NextResponse.json(
        { ok: false, error: apiError(resolveLocale(req), "animalWikiIdRequired") },
        { status: 400 },
      );
    }
    const [row] = await db
      .select()
      .from(animalWiki)
      .where(eq(animalWiki.id, id))
      .limit(1);
    if (!row) {
      return NextResponse.json(
        { ok: false, error: apiError(resolveLocale(req), "animalWikiNotFound") },
        { status: 404 },
      );
    }
    const knowledge = toKnowledgeSnapshot(row as unknown as Record<string, unknown>);
    return NextResponse.json({ ok: true, knowledge });
  } catch (err) {
    console.error("[/api/animal-wiki/[id]] failed:", err);
    return NextResponse.json(
      { ok: false, error: apiError(resolveLocale(req), "animalWikiLoadFailed") },
      { status: 500 },
    );
  }
}
