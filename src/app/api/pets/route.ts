import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db, ensureDbSchemaOnce } from "@/db/client";
import { adoptions } from "@/db/schema";
import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { parseMemoryStore, type MemoryFact } from "@/lib/memory";
import { getPet } from "@/lib/pet-config";

export const runtime = "nodejs";

/**
 * GET /api/pets
 * 返回当前用户的宠物列表（含每只宠物的记忆）。
 *  - 携带有效登录 Token（Authorization: Bearer）→ 取该账号下的宠物；
 *  - 否则需带 ?anonymousId=<设备ID> → 取该设备游客模式下的宠物。
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const anonymousId = url.searchParams.get("anonymousId") ?? "";

  await ensureDbSchemaOnce();
  try {
    const user = await getUserFromRequest(req);

    let rows: typeof adoptions.$inferSelect[];
    if (user) {
      rows = await db
        .select()
        .from(adoptions)
        .where(eq(adoptions.userId, user.id));
    } else if (anonymousId) {
      rows = await db
        .select()
        .from(adoptions)
        .where(
          and(eq(adoptions.userId, "anonymous"), eq(adoptions.anonymousId, anonymousId)),
        );
    } else {
      rows = [];
    }

    const pets = rows.map((a) => {
      const pet = getPet(a.petType);
      const store = parseMemoryStore(a.memoryContext);
      const facts: (MemoryFact & { pinned: boolean })[] = store.facts.map((f) => ({
        ...f,
        pinned: !!f.pinned,
      }));
      return {
        id: a.id,
        petType: a.petType,
        petName: a.petName,
        avatar: pet.avatar,
        level: a.level,
        happiness: a.happiness,
        chatCount: a.chatCount,
        monthlyPoints: a.monthlyPoints,
        isUnlocked: a.isUnlocked,
        threadId: a.threadId,
        adoptedAt: a.adoptedAt ? a.adoptedAt.toISOString() : null,
        memory: {
          facts,
          usedChars: facts.reduce((s, f) => s + f.text.length, 0),
        },
      };
    });

    return NextResponse.json({ ok: true, pets });
  } catch (err) {
    console.error("[pets] failed:", err);
    return NextResponse.json({ ok: false, error: apiError(resolveLocale(req), "petListFailed") }, { status: 500 });
  }
}
