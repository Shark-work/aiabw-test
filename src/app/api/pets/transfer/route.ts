import { NextResponse } from "next/server";

import { pool, ensureDbSchemaOnce } from "@/db/client";
import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { TRANSFER_FEE, TRANSFER_COOLDOWN_MS } from "@/lib/genetics";

export const runtime = "nodejs";

/**
 * POST /api/pets/transfer   — 数字藏品转赠
 * 请求体：{ collectibleId: string, toUserId: string }
 *
 * 事务（任何失败 → ROLLBACK）：
 *   1. SELECT ... FOR UPDATE 锁定藏品（防并发转赠/繁育）；
 *   2. 校验存在 + 归属当前用户 + active；
 *   3. 冷却期校验：locked_until > now() → 403 COOLDOWN（含 retryAfter）；
 *   4. 转移所有权：owner_id 变更 + 新主人 locked_until = now() + 7 天 +
 *      transferred_count + 1（重置冷却期）；
 *   5. 同步现有资产归属：source_pet_id → pets.owner_id；adoption_id → adoptions.user_id。
 */
export async function POST(req: Request) {
  const locale = resolveLocale(req);
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: apiError(locale, "signInFirst") }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    const collectibleId = typeof body?.collectibleId === "string" ? body.collectibleId.trim() : "";
    const toUserId = typeof body?.toUserId === "string" ? body.toUserId.trim() : "";
    if (!collectibleId || !toUserId) {
      return NextResponse.json({ ok: false, error: apiError(locale, "invalidTransfer") }, { status: 400 });
    }

    await ensureDbSchemaOnce();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 1) 锁定藏品并校验归属
      const { rows: owned } = await client.query(
        `SELECT id, owner_id, collectible_id, source_pet_id, adoption_id, status, locked_until
           FROM user_collectibles
          WHERE id = $1
          FOR UPDATE`,
        [collectibleId],
      );
      const row = owned[0];
      if (!row) {
        await client.query("ROLLBACK");
        return NextResponse.json({ ok: false, error: apiError(locale, "collectibleNotFound") }, { status: 404 });
      }
      if (row.status !== "active") {
        await client.query("ROLLBACK");
        return NextResponse.json({ ok: false, error: apiError(locale, "collectibleInactive") }, { status: 410 });
      }
      if (row.owner_id !== user.id) {
        await client.query("ROLLBACK");
        return NextResponse.json({ ok: false, error: apiError(locale, "noPermissionTransfer") }, { status: 403 });
      }

      // 2) 冷却期校验（需求核心：未过期返回 403）
      const now = new Date();
      const lockedUntil = new Date(row.locked_until as string);
      if (lockedUntil > now) {
        const retryAfter = Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000);
        await client.query("ROLLBACK");
        return NextResponse.json(
          { ok: false, error: apiError(locale, "transferCooldown"), code: "COOLDOWN", retryAfter, lockedUntil },
          { status: 403 },
        );
      }

      // 3) 接收者存在校验
      const receiver = await client.query("SELECT id FROM users WHERE id = $1", [toUserId]);
      if (!receiver.rows.length) {
        await client.query("ROLLBACK");
        return NextResponse.json({ ok: false, error: apiError(locale, "receiverNotFound") }, { status: 404 });
      }

      // 4) 转赠费用（第一阶段免转赠费）
      if (TRANSFER_FEE > 0) {
        const fee = await client.query(
          `UPDATE users SET points = points - $1 WHERE id = $2 AND points >= $1`,
          [TRANSFER_FEE, user.id],
        );
        if (fee.rowCount === 0) {
          await client.query("ROLLBACK");
          return NextResponse.json({ ok: false, error: apiError(locale, "notEnoughPoints") }, { status: 402 });
        }
        await client.query(`INSERT INTO points_log (user_id, amount, reason) VALUES ($1, $2, 'transfer')`, [user.id, -TRANSFER_FEE]);
      }

      // 5) 转移所有权 + 重置新主人冷却期
      const nextCooldown = new Date(now.getTime() + TRANSFER_COOLDOWN_MS);
      await client.query(
        `UPDATE user_collectibles
            SET owner_id = $1, locked_until = $2, transferred_count = transferred_count + 1
          WHERE id = $3`,
        [toUserId, nextCooldown, collectibleId],
      );

      // 6) 同步现有资产归属（宠物实例 + 领养记录 → 保证聊天/图鉴归属一致）
      if (row.source_pet_id) {
        await client.query(
          `UPDATE pets SET owner_id = $1, adopted_at = now() WHERE id = $2`,
          [toUserId, row.source_pet_id],
        );
      }
      if (row.adoption_id) {
        await client.query(
          `UPDATE adoptions SET user_id = $1 WHERE id = $2`,
          [toUserId, row.adoption_id],
        );
      }

      await client.query("COMMIT");

      return NextResponse.json({
        ok: true,
        collectibleId,
        newOwnerId: toUserId,
        nextCooldown: nextCooldown.toISOString(),
        transferredCount: Number(row.transferred_count ?? 0) + 1,
      });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("[pets/transfer] failed:", err);
    return NextResponse.json({ ok: false, error: apiError(locale, "transferFailed") }, { status: 500 });
  }
}
