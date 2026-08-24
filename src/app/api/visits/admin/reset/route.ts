import { NextResponse } from "next/server";

import { pool } from "@/db/client";
import { visitsCacheClear } from "@/lib/visits-cache";

export const runtime = "nodejs";

/**
 * GET /api/visits/admin/reset
 * 重置访问计数（仅开发环境可用；生产环境返回 404）。
 * 返回：{ ok: true, total: 0, unique: 0 }
 */
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }
  await pool.query(`INSERT INTO site_visits (id, visit_count, unique_count)
                     VALUES (1, 0, 0)
                     ON CONFLICT (id) DO UPDATE
                       SET visit_count = 0, unique_count = 0, last_updated = now()`);
  visitsCacheClear();
  return NextResponse.json({ ok: true, total: 0, unique: 0 });
}
