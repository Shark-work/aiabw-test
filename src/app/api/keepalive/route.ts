import { NextResponse } from "next/server";
import { pool } from "@/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/keepalive
 *
 * 轻量保活 + 测速接口：
 *   - 连续执行两次 SELECT 1，返回各步耗时（firstMs / secondMs / totalMs）；
 *   - firstMs 明显大于 secondMs => 首查在做连接建立/计算唤醒，第二次复用连接后很快；
 *   - 用途：外部监控服务（如 UptimeRobot，免费版每 5 分钟）周期性 GET 本接口，
 *     可避免 Neon 免费版 compute 在 5 分钟无连接后自动休眠带来的 1~5s 冷唤醒。
 */
export async function GET() {
  const started = Date.now();
  try {
    const t0 = Date.now();
    await pool.query("SELECT 1");
    const firstMs = Date.now() - t0;

    const t1 = Date.now();
    await pool.query("SELECT 1");
    const secondMs = Date.now() - t1;

    return NextResponse.json({
      ok: true,
      firstMs,
      secondMs,
      totalMs: Date.now() - started,
      ts: Date.now(),
    });
  } catch (err) {
    console.error("[keepalive] db ping failed:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "db error" },
      { status: 500 },
    );
  }
}
