import { NextResponse } from "next/server";

import { pool } from "@/db/client";
import { writeMemory } from "@/lib/agent-memory";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/agent/memories/verify
 * 数字人记忆系统自检（验收用，带 CRON_SECRET 鉴权）：
 *   连续写入两条“相似”记忆 → 断言只落库 1 条（第二条触发语义去重 → action=updated）；
 *   自检完成后立即清理测试数据，不留脏数据。
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const tag = `__verify__${Date.now()}`;
  const content = `${tag} 用户喜欢喝咖啡并且热爱工作`;
  try {
    // 两次写入相同语义的内容
    const first = await writeMemory("fact", content);
    const second = await writeMemory("fact", content);

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM agent_memories WHERE content LIKE $1`,
      [`%${tag}%`],
    );
    const stored = Number(rows[0]?.n ?? 0);
    const dedupWorks =
      first.action === "created" && second.action === "updated" && stored === 1;

    return NextResponse.json({
      ok: true,
      dedupWorks,
      firstWrite: first,
      secondWrite: second,
      storedRows: stored,
      message: dedupWorks
        ? "记忆语义去重生效：两条相似记忆只保留一条"
        : "记忆语义去重未按预期生效",
    });
  } finally {
    // 清理自检数据，保证幂等且不污染生产记忆
    await pool.query(`DELETE FROM agent_memories WHERE content LIKE $1`, [`%${tag}%`]).catch(() => {});
  }
}
