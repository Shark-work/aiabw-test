import { NextResponse } from "next/server";

import { ensureDbSchemaOnce, pool } from "@/db/client";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { getUserFromRequest } from "@/lib/auth";
import { getPet } from "@/lib/pet-config";
import {
  bindVideoTask,
  createVideoGeneration,
  dailyVideoUsage,
  generateVideoScript,
  klingConfigured,
  markVideoFailed,
  submitVideoTask,
} from "@/lib/pet-video";
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from "@/lib/rate-limit";
import { SITE_URL } from "@/lib/site";
import { isSpeciesPetType, speciesIdOf } from "@/lib/species-prompt";

export const runtime = "nodejs";
// LLM 脚本（~5-10s）+ 可灵任务提交串行，预留余量；hobby 上限 60s。
export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/pets/:id/video/generate — 灵宠日常短视频生成入口（Phase 10）
 *
 * 链路：鉴权 → 限流 → 可灵配置检查（503 降级）→ 灵宠归属校验 → 配额占位（事务权威计数）
 *      → DeepSeek 生成 100 字内脚本（画面/字幕/BGM 标签，失败走本地模板兜底）
 *      → 可灵图生视频异步任务（first_frame=灵宠形象图，9:16，5s，audio=true）
 *      → 返回 generationId；前端凭 id 轮询 /api/video/poll。
 *
 * 配额：users.video_quota（默认 1/日，预留 XorPay/Stripe 付费扩容）；
 *      占位后任何失败都 markVideoFailed → status='failed' 不计入当日计数 = 自动退还次数。
 */
export async function POST(req: Request, { params }: Params) {
  await ensureDbSchemaOnce();
  const locale = resolveLocale(req);
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: apiError(locale, "signInFirst") }, { status: 401 });
    }

    const rl = checkRateLimit(`video:${user.id}`, RATE_LIMITS.video);
    if (rl.limited) return rateLimitResponse(req, rl.retryAfterSec);

    if (!klingConfigured()) {
      return NextResponse.json({ error: apiError(locale, "videoUnavailable") }, { status: 503 });
    }

    const { id: adoptionId } = await params;
    const { rows: petRows } = await pool.query<{
      id: string;
      pet_name: string;
      pet_type: string;
    }>(
      `SELECT id, pet_name, pet_type FROM adoptions WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [adoptionId, user.id],
    );
    const pet = petRows[0];
    if (!pet) {
      return NextResponse.json({ error: apiError(locale, "videoPetNotFound") }, { status: 404 });
    }

    // 形象图 URL（可灵 first_frame，必须公网可访问）：
    // 图鉴物种优先用户持有的真实实例图（已是公网 URL）；否则官方立绘静态资源拼绝对地址。
    let imageUrl: string | null = null;
    if (isSpeciesPetType(pet.pet_type)) {
      try {
        const { rows: imgs } = await pool.query<{ image_url: string }>(
          `SELECT image_url FROM pets
            WHERE species_id = $1 AND image_url IS NOT NULL AND image_url LIKE 'http%'
            ORDER BY created_at DESC LIMIT 1`,
          [speciesIdOf(pet.pet_type)],
        );
        imageUrl = imgs[0]?.image_url ?? null;
      } catch {
        imageUrl = null;
      }
    }
    if (!imageUrl) {
      const avatar = getPet(pet.pet_type).avatar;
      imageUrl = avatar.startsWith("http") ? avatar : `${SITE_URL}${avatar}`;
    }

    // 快速配额预检（UX 提示；权威计数在 createVideoGeneration 事务内）
    const usage = await dailyVideoUsage(user.id);
    if (usage.used >= usage.quota) {
      return NextResponse.json(
        { error: apiError(locale, "videoQuotaExceeded", { max: usage.quota }), usage },
        { status: 429 },
      );
    }

    // 1) 占位（事务内权威计数，并发安全；占位成功才会产生外部调用成本）
    const created = await createVideoGeneration({ userId: user.id, petId: adoptionId });
    if ("error" in created) {
      return NextResponse.json(
        { error: apiError(locale, "videoQuotaExceeded", { max: usage.quota }), usage },
        { status: 429 },
      );
    }
    const generationId = created.id;

    // 2) DeepSeek 生成脚本（AI 繁忙/失败 → 本地模板兜底，永不失败）
    const personality = getPet(pet.pet_type).personality;
    const { script, source } = await generateVideoScript({
      petName: pet.pet_name,
      personality,
      locale,
    });

    // 3) 提交可灵图生视频异步任务；失败 → 标记 failed（自动退还次数）+ 502
    try {
      const { taskId } = await submitVideoTask({ imageUrl, prompt: script.prompt });
      await bindVideoTask(generationId, taskId, script);
      return NextResponse.json({
        id: generationId,
        status: "processing",
        script,
        scriptSource: source,
        usage: { used: usage.used + 1, quota: usage.quota },
      });
    } catch (err) {
      await markVideoFailed(generationId, err instanceof Error ? err.message : String(err));
      return NextResponse.json(
        { error: apiError(locale, "videoSubmitFailed"), refunded: true },
        { status: 502 },
      );
    }
  } catch (err) {
    console.error("[video/generate] failed:", err);
    return NextResponse.json({ error: apiError(locale, "videoGenerateFailed") }, { status: 500 });
  }
}
