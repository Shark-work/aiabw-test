import { NextResponse } from "next/server";
import { pool, db, ensureDbSchemaOnce } from "@/db/client";
import { users } from "@/db/schema";
import { hashPassword, signToken } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/dbdiag
 * 诊断：按 login/register 的步骤拆分耗时，定位 Vercel 函数侧的真实瓶颈。
 * 返回字段（毫秒）：
 *   select1Ms       裸 SELECT 1（pool.query 复用连接）
 *   ensureSchemaMs  ensureDbSchemaOnce（已缓存时接近 0）
 *   drizzleSelectMs drizzle 查 users 表
 *   scryptMs        scrypt 密码哈希（register/login 的核心 CPU 开销）
 *   joseSignMs      JWT 签发
 */
export async function GET() {
  const out: Record<string, number> = {};
  const timed = (label: string) => {
    const start = Date.now();
    return () => {
      out[label] = Date.now() - start;
    };
  };

  try {
    let done = timed("select1Ms");
    await pool.query("SELECT 1");
    done();

    done = timed("ensureSchemaMs");
    await ensureDbSchemaOnce();
    done();

    done = timed("drizzleSelectMs");
    await db.select().from(users).limit(1);
    done();

    // raw INSERT (temp row, then delete) vs drizzle INSERT -> is 125ms a Neon write cost or adapter overhead?
    const tempEmail = `diag_${Date.now()}@test.aiabw`;
    done = timed("rawInsertMs");
    await pool.query(
      "INSERT INTO users (email, password_hash) VALUES ($1, 'x') RETURNING id",
      [tempEmail],
    );
    done();

    done = timed("drizzleInsertMs");
    const tempEmail2 = `diag2_${Date.now()}@test.aiabw`;
    await db
      .insert(users)
      .values({ email: tempEmail2, passwordHash: "x" })
      .returning({ id: users.id });
    done();

    done = timed("deleteMs");
    await pool.query("DELETE FROM users WHERE email = ANY($1)", [[tempEmail, tempEmail2]]);
    done();

    done = timed("scryptMs");
    await hashPassword("perf-test-password");
    done();

    done = timed("joseSignMs");
    await signToken({ id: "00000000-0000-0000-0000-000000000000", email: "diag@test.aiabw" });
    done();

    out["totalMs"] = Object.values(out).reduce((a, b) => a + b, 0);
    return NextResponse.json({ ok: true, ...out });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "diag failed" },
      { status: 500 },
    );
  }
}
