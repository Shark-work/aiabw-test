import { NextResponse } from "next/server";

import { ensureDbSchemaOnce, pool } from "@/db/client";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { getUserFromRequest } from "@/lib/auth";
import {
  archiveVideoToBlob,
  markVideoFailed,
  queryVideoTask,
} from "@/lib/pet-video";

export const runtime = "nodejs";
// 视频下载 + Blob 转存可能耗时数十秒；hobby 上限 60s。
export const maxDuration = 60;

/** 占位后超过该时长仍未出结果视为平台超时 → failed（退还次数）。 */
const TASK_TIMEOUT_MS = 10 * 60 * 1000;

interface GenerationRow {
  id: string;
  user_id: string;
  pet_id: string;
  task_id: string | null;
  status: string;
  script: unknown;
  video_url: string | null;
  source_url: string | null;
  error: string | null;
  created_at: string;
}

function publicView(r: GenerationRow) {
  return {
    id: r.id,
    petId: r.pet_id,
    status: r.status,
    script: r.script,
    videoUrl: r.video_url ?? r.source_url,
    error: r.error,
    createdAt: r.created_at,
  };
}

/**
 * 推进一条 pending/processing 记录：查平台任务 → 成功转存 Blob / 失败退还 / 超时退还。
 * 返回 true 表示状态已终结（succeeded/failed）。
 */
async function advanceGeneration(row: GenerationRow): Promise<boolean> {
  if (!row.task_id) {
    // 占位后尚未绑定 task_id（generate 请求仍在飞）；超时则兜底失败
    if (Date.now() - new Date(row.created_at).getTime() > TASK_TIMEOUT_MS) {
      await markVideoFailed(row.id, "bind timeout");
      return true;
    }
    return false;
  }
  try {
    const r = await queryVideoTask(row.task_id);
    if (r.status === "succeeded" && r.videoUrl) {
      // 平台链接有效期短 → 立即转存自有对象存储；Blob 失败降级保留临时链接
      const archived = await archiveVideoToBlob(row.id, r.videoUrl);
      await pool.query(
        `UPDATE video_generations
            SET status='succeeded', video_url=$2, source_url=$3, updated_at=now()
          WHERE id=$1`,
        [row.id, archived ?? r.videoUrl, r.videoUrl],
      );
      row.status = "succeeded";
      row.video_url = archived ?? r.videoUrl;
      row.source_url = r.videoUrl;
      return true;
    }
    if (r.status === "failed") {
      await markVideoFailed(row.id, r.error || "task failed");
      row.status = "failed";
      row.error = r.error || "task failed";
      return true;
    }
  } catch (err) {
    console.error("[video/poll] query failed:", err instanceof Error ? err.message : err);
  }
  // 查询异常不致命；但超过总超时仍按失败处理（退还次数）
  if (Date.now() - new Date(row.created_at).getTime() > TASK_TIMEOUT_MS) {
    await markVideoFailed(row.id, "poll timeout");
    row.status = "failed";
    row.error = "poll timeout";
    return true;
  }
  return false;
}

/**
 * GET /api/video/poll — 视频任务轮询（Phase 10）
 *
 * 三种模式：
 *  - ?id=<generationId>（前端 5s 轮询）：鉴权 + 归属校验，推进并返回最新状态；
 *  - ?petId=<adoptionId>（页面刷新恢复）：返回该灵宠最新一条记录；
 *  - ?mode=sweep（Vercel cron 兜底，CRON_SECRET 鉴权）：批量推进逾期任务。
 *    注：hobby cron 最低每日一次，30s 级实时轮询由前端承担，cron 仅兜底清理。
 */
export async function GET(req: Request) {
  await ensureDbSchemaOnce();
  const locale = resolveLocale(req);
  const url = new URL(req.url);

  // ---- cron 兜底模式 ----
  if (url.searchParams.get("mode") === "sweep") {
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.get("authorization") ?? "";
    if (secret && auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const { rows } = await pool.query<GenerationRow>(
      `SELECT * FROM video_generations
        WHERE status IN ('pending','processing')
          AND created_at < now() - interval '2 minutes'
        ORDER BY created_at ASC LIMIT 8`,
    );
    let done = 0;
    for (const row of rows) {
      if (await advanceGeneration(row)) done += 1;
    }
    return NextResponse.json({ swept: rows.length, settled: done });
  }

  // ---- 用户模式（需鉴权） ----
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: apiError(locale, "signInFirst") }, { status: 401 });
  }

  const id = url.searchParams.get("id");
  const petId = url.searchParams.get("petId");
  if (!id && !petId) {
    return NextResponse.json({ error: apiError(locale, "videoPollBadRequest") }, { status: 400 });
  }

  try {
    if (petId) {
      const { rows } = await pool.query<GenerationRow>(
        `SELECT * FROM video_generations
          WHERE pet_id = $1 AND user_id = $2
          ORDER BY created_at DESC LIMIT 1`,
        [petId, user.id],
      );
      const row = rows[0];
      if (!row) return NextResponse.json({ latest: null });
      if (row.status === "pending" || row.status === "processing") {
        await advanceGeneration(row);
      }
      return NextResponse.json({ latest: publicView(row) });
    }

    const { rows } = await pool.query<GenerationRow>(
      `SELECT * FROM video_generations WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [id, user.id],
    );
    const row = rows[0];
    if (!row) {
      return NextResponse.json({ error: apiError(locale, "videoNotFound") }, { status: 404 });
    }
    if (row.status === "pending" || row.status === "processing") {
      await advanceGeneration(row);
    }
    return NextResponse.json({
      ...publicView(row),
      refunded: row.status === "failed",
    });
  } catch (err) {
    console.error("[video/poll] failed:", err);
    return NextResponse.json({ error: apiError(locale, "videoPollFailed") }, { status: 500 });
  }
}
