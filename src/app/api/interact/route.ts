import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { adoptions } from "@/db/schema";

export const runtime = "nodejs";

/** 触发更高心情加成的积极情绪词。 */
const HAPPY_WORDS = [
  "开心",
  "高兴",
  "快乐",
  "好开心",
  "喜欢",
  "超爱",
  "爱",
  "太棒",
  "真棒",
  "棒",
  "哈哈",
  "可爱",
  "谢谢",
  "感谢",
  "真好",
  "爽",
  "赞",
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
  const adoptionId = body?.adoptionId;
  const message = typeof body?.message === "string" ? body.message : "";

  if (typeof adoptionId !== "string" || !adoptionId) {
    return NextResponse.json({ ok: false, error: "缺少 adoptionId" }, { status: 400 });
  }

  try {
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
      return NextResponse.json({ ok: false, error: "未找到该领养记录" }, { status: 404 });
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
    return NextResponse.json({ ok: false, error: "互动更新失败" }, { status: 500 });
  }
}
