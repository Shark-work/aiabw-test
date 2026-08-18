import { NextResponse } from "next/server";

import { pool } from "@/db/client";
import {
  cleanupStaleMemories,
  writeMemory,
} from "@/lib/agent-memory";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/agent/memories/verify
 * 数字人记忆系统自检（验收用，带 CRON_SECRET 鉴权）：
 *   ① 语义去重：连续写入两条“相似”记忆 → 只落库 1 条（第二条触发合并 → action=updated）；
 *   ② 核心记忆标记：writeMemory(important:true) 落库后 important=true；
 *   ③ 跨日沉淀保护：把重要记忆人工“老化”到 31 天未访问 + 写入一条过期普通记忆，
 *      执行 cleanupStaleMemories() 后 → 重要记忆保留、过期普通记忆被清理。
 *   自检完成后立即清理测试数据，不留脏数据。
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const tag = `__verify__${Date.now()}`;
  const dedupContent = `${tag}_dedup 用户喜欢喝咖啡并且热爱工作`;
  const coreContent = `${tag}_core 重要记忆：数字人的核心使命是陪伴用户、共同成长`;
  const staleContent = `${tag}_stale 一条过期低频记忆（应被 30 天清理）`;
  try {
    // ① 语义去重：两次写入相同语义的内容
    const first = await writeMemory("fact", dedupContent);
    const second = await writeMemory("fact", dedupContent);
    const { rows: dedupCount } = await pool.query(
      `SELECT count(*)::int AS n FROM agent_memories WHERE content LIKE $1`,
      [`%${tag}_dedup%`],
    );
    const stored = Number(dedupCount[0]?.n ?? 0);
    const dedupWorks =
      first.action === "created" && second.action === "updated" && stored === 1;

    // ② 核心记忆标记：important:true 写入
    const core = await writeMemory("fact", coreContent, { important: true });
    const importantWorks = core.action === "created" && core.important === true;

    // ③ 跨日沉淀保护：
    //   - 把重要记忆“老化”到 31 天前（模拟长期未被访问）
    await pool.query(
      `UPDATE agent_memories SET last_accessed = now() - interval '31 days' WHERE id = $1`,
      [core.id],
    );
    //   - 写入一条过期普通记忆（同样老化到 31 天前）
    await pool.query(
      `INSERT INTO agent_memories (memory_type, content, embedding, last_accessed, important)
       VALUES ('fact', $1, ARRAY[0.1,0.2,0.3], now() - interval '31 days', false)`,
      [staleContent],
    );
    //   - 执行 30 天低频清理
    const cleaned = await cleanupStaleMemories();
    const { rows: coreRows } = await pool.query(
      `SELECT count(*)::int AS n FROM agent_memories WHERE content LIKE $1 AND important = true`,
      [`%${tag}_core%`],
    );
    const { rows: staleRows } = await pool.query(
      `SELECT count(*)::int AS n FROM agent_memories WHERE content LIKE $1`,
      [`%${tag}_stale%`],
    );
    const protectionWorks =
      Number(coreRows[0]?.n ?? 0) === 1 && Number(staleRows[0]?.n ?? 0) === 0;

    return NextResponse.json({
      ok: true,
      dedupWorks,
      importantWorks,
      protectionWorks,
      firstWrite: first,
      secondWrite: second,
      coreWrite: core,
      cleanedMemories: cleaned,
      message: [
        dedupWorks ? "✅ 语义去重生效（两条相似记忆只保留一条）" : "❌ 语义去重未生效",
        importantWorks ? "✅ 核心记忆标记生效" : "❌ 核心记忆标记未生效",
        protectionWorks ? "✅ 重要记忆豁免 30 天清理（跨日沉淀）" : "❌ 重要记忆保护未生效",
      ].join("；"),
    });
  } finally {
    // 清理自检数据，保证幂等且不污染生产记忆
    await pool.query(`DELETE FROM agent_memories WHERE content LIKE $1`, [`%${tag}%`]).catch(() => {});
  }
}
