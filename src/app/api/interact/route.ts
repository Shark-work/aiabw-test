import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db, pool, ensureDbSchemaOnce } from "@/db/client";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { adoptions } from "@/db/schema";
import { getUserFromRequest } from "@/lib/auth";
import { aibiCatch, aibiFail, aibiOk, AibiError } from "@/lib/aibi-api";
import { applyGrowth, INTERACT_RULES, type GrowthState } from "@/lib/aibi-service";

export const runtime = "nodejs";

/** 触发更高心情加成的积极情绪词。 */
const HAPPY_WORDS = [
  "happy",
  "glad",
  "love",
  "awesome",
  "great",
  "amazing",
  "thank",
  "thanks",
  "cool",
  "nice",
  "wonderful",
  "fantastic",
  "cute",
  "lol",
  "haha",
  "good",
  "like",
  "best",
  "perfect",
];

/** 根据消息内容计算心情增量：只要互动 +1，包含积极情绪词则 +3。 */
function happinessDeltaFor(text: string): number {
  let delta = 1;
  for (const w of HAPPY_WORDS) {
    if (text.includes(w)) {
      delta = 3;
      break;
    }
  }
  return delta;
}

/**
 * POST /api/interact
 * 请求体：{ adoptionId: string, message?: string }
 * 每次互动：
 *   - 根据用户消息内容提升该艾比的心情值（封顶 100）并更新最后互动时间；
 *   - chatCount +1（每次发消息计数）；
 *   - 当 chatCount 达到 50 时自动升到 Lv.2；
 *   - monthlyPoints +10（月度活跃度积分）。
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  // ---- 艾比凭证互动分支（Phase 4 · 4.3）：body 带 tokenId 时走新流程 ----
  // 旧版领养互动（adoptionId）流程保持完全不变，见下方。
  if (typeof body?.tokenId === "string" && body.tokenId) {
    return handleAibiInteract(req, body);
  }

  const adoptionId = body?.adoptionId;
  const message = typeof body?.message === "string" ? body.message : "";

  if (typeof adoptionId !== "string" || !adoptionId) {
    return NextResponse.json({ ok: false, error: apiError(resolveLocale(req), "missingAdoptionId") }, { status: 400 });
  }

  try {
    // 首次访问自动建表（幂等）
    await ensureDbSchemaOnce();

    const [row] = await db
      .select({
        happiness: adoptions.happiness,
        chatCount: adoptions.chatCount,
        level: adoptions.level,
        monthlyPoints: adoptions.monthlyPoints,
      })
      .from(adoptions)
      .where(eq(adoptions.id, adoptionId))
      .limit(1);

    if (!row) {
      return NextResponse.json({ ok: false, error: apiError(resolveLocale(req), "adoptionNotFound") }, { status: 404 });
    }

    const delta = happinessDeltaFor(message);
    const next = Math.max(0, Math.min(100, row.happiness + delta));

    const nextChatCount = row.chatCount + 1;
    // 养成：累计对话达到 50 句后自动升级到 Lv.2。
    const nextLevel = nextChatCount >= 50 && row.level < 2 ? 2 : row.level;
    const nextPoints = row.monthlyPoints + 10;

    await db
      .update(adoptions)
      .set({
        happiness: next,
        lastInteractedAt: new Date(),
        chatCount: nextChatCount,
        level: nextLevel,
        monthlyPoints: nextPoints,
      })
      .where(eq(adoptions.id, adoptionId));

    return NextResponse.json({
      ok: true,
      happiness: next,
      delta,
      chatCount: nextChatCount,
      level: nextLevel,
      monthlyPoints: nextPoints,
    });
  } catch (err) {
    console.error("Failed to update happiness:", err);
    return NextResponse.json({ ok: false, error: apiError(resolveLocale(req), "interactFailed") }, { status: 500 });
  }
}

// ============================================================================
// 艾比凭证互动（Phase 4 · 4.3）：POST /api/interact { tokenId, action }
//  - action: feed | train | talk | play；规则见 aibi-service.INTERACT_RULES；
//  - 更新 aibi_personalities 成长数据与心情（性格类型随物种档案，mood 随动作漂移），
//    写 aibi_growth_logs 前后快照；
//  - 统一返回格式：成功 { data }；失败 { code, message }。
// ============================================================================

const aibiInteractSchema = z.object({
  tokenId: z.string().min(1),
  action: z.enum(["feed", "train", "talk", "play"]),
});

async function handleAibiInteract(req: Request, rawBody: unknown) {
  try {
    await ensureDbSchemaOnce();
    const user = await getUserFromRequest(req);
    if (!user) return aibiFail("UNAUTHORIZED", 401, req);

    const parsed = aibiInteractSchema.safeParse(rawBody);
    if (!parsed.success) return aibiFail("VALIDATION_ERROR", 400, req);
    const { tokenId, action } = parsed.data;
    const rule = INTERACT_RULES[action];

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 凭证校验（行锁）：必须本人持有且处于 minted
      const tokenRes = await client.query(
        `SELECT owner_id::text AS "ownerId", status FROM aibi_tokens
          WHERE aibi_token_id = $1 FOR UPDATE`,
        [tokenId],
      );
      if (!tokenRes.rows.length) throw new AibiError("TOKEN_NOT_FOUND", 404);
      if (tokenRes.rows[0].ownerId !== user.id) throw new AibiError("TOKEN_NOT_OWNED", 403);
      if (tokenRes.rows[0].status !== "minted") throw new AibiError("TOKEN_NOT_MINTED", 409);

      const perRes = await client.query(
        `SELECT personality_type AS "personalityType", mood, affinity, energy,
                growth_level AS "growthLevel", growth_exp AS "growthExp"
           FROM aibi_personalities WHERE aibi_token_id = $1 FOR UPDATE`,
        [tokenId],
      );
      if (!perRes.rows.length) throw new AibiError("TOKEN_NOT_FOUND", 404);
      const before: GrowthState = perRes.rows[0];

      if (before.energy < rule.minEnergy) throw new AibiError("NOT_ENOUGH_ENERGY", 400);

      const after = applyGrowth(before, {
        energy: rule.energy,
        exp: rule.exp,
        affinity: rule.affinity,
        mood: rule.mood,
      });

      await client.query(
        `UPDATE aibi_personalities
            SET mood=$2, affinity=$3, energy=$4, growth_level=$5, growth_exp=$6,
                last_interacted_at=now(), updated_at=now()
          WHERE aibi_token_id=$1`,
        [tokenId, after.mood, after.affinity, after.energy, after.growthLevel, after.growthExp],
      );
      await client.query(
        `INSERT INTO aibi_growth_logs ("aibi_token_id","action_type","before_state","after_state")
         VALUES ($1,$2,$3::jsonb,$4::jsonb)`,
        [tokenId, action, JSON.stringify(before), JSON.stringify(after)],
      );

      await client.query("COMMIT");
      return aibiOk({
        tokenId,
        action,
        state: after,
        leveledUp: after.growthLevel > before.growthLevel,
      });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    return aibiCatch(err, req);
  }
}
