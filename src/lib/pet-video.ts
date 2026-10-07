/**
 * Phase 10 灵宠日常短视频（SCHEMA_VERSION 21）
 *
 * 全链路（零人工剪辑）：
 *   1) DeepSeek（generateThrottled，Phase 8 并发槽 + 跨 provider 降级）生成 100 字内脚本
 *      { scene 画面描述, subtitle 字幕文案, bgmStyle BGM 风格标签, prompt 视频模型提示词 }；
 *      AI 繁忙/失败 → 本地模板兜底（零 LLM 成本，功能永可用）；
 *   2) 脚本 prompt + 灵宠形象图（first_frame）→ 可灵/百炼图生视频异步任务（9:16 竖屏、5s、audio）；
 *   3) /api/video/poll 轮询至 SUCCEEDED/FAILED；成功后立即把临时 video_url 转存 Vercel Blob
 *      （平台链接有效期短，Blob URL 长期有效）；
 *   4) 配额：users.video_quota（默认 1/日，预留 XorPay/Stripe 付费扩容）；failed 不计数 = 失败自动退还。
 *
 * 视频平台接入（env 驱动，双 provider 同一接口）：
 *   - KLING_API_KEY：平台密钥（缺省回退 BAILIAN_API_KEY；两者都没有 → 路由层 503 降级）；
 *   - KLING_BASE_URL：默认 https://dashscope.aliyuncs.com/api/v1（百炼 DashScope 异步任务模式）；
 *     指向 https://api.klingai.com 时自动切换可灵官方 API 字段映射（/v1/videos/image2video）；
 *   - KLING_MODEL：默认 kling-v3-turbo-video-generation（按所用平台实际模型名调整）。
 */
import { put } from "@vercel/blob";

import { pool } from "@/db/client";
import { todayString } from "@/lib/chat-quota-config";
import { generateThrottled, AiBusyError } from "@/lib/llm-fallback";

// ---------- 类型 ----------

export interface VideoScript {
  /** 画面描述（给运营/排障看的摘要） */
  scene: string;
  /** 字幕文案（≤20 字） */
  subtitle: string;
  /** BGM 风格标签 */
  bgmStyle: string;
  /** 送入视频模型的完整提示词（画面+字幕+风格，100 字内） */
  prompt: string;
}

export type VideoStatus = "pending" | "processing" | "succeeded" | "failed";

// ---------- 配置 ----------

export function klingConfigured(): boolean {
  return Boolean(process.env.KLING_API_KEY || process.env.BAILIAN_API_KEY);
}

function klingApiKey(): string {
  return (process.env.KLING_API_KEY || process.env.BAILIAN_API_KEY || "").trim();
}

function klingBaseUrl(): string {
  return (
    process.env.KLING_BASE_URL?.trim() || "https://dashscope.aliyuncs.com/api/v1"
  ).replace(/\/+$/, "");
}

function klingModel(): string {
  return process.env.KLING_MODEL?.trim() || "kling-v3-turbo-video-generation";
}

/** 可灵官方开放平台（klingai.com）与百炼 DashScope 字段映射不同，按 base URL 自动识别。 */
function isKlingOfficial(): boolean {
  return klingBaseUrl().includes("klingai");
}

// ---------- 1) AI 脚本生成 ----------

const SCRIPT_SYSTEM = `你是治愈系宠物短视频编剧。为一只灵宠写一段 5 秒竖屏小短片的拍摄脚本。
只输出 JSON（不要 markdown 代码块），字段：
- scene：一句话画面描述（中文，≤30 字）
- subtitle：屏幕字幕文案（中文，≤20 字，治愈或搞笑）
- bgmStyle：BGM 风格标签（英文，如 "lofi piano", "playful pizzicato"）
- prompt：给图生视频模型的画面提示词（中文，≤80 字），要求：主体保持图片中宠物形象不变，9:16 竖屏构图，镜头缓慢推近，动作轻缓治愈，画面下方留白给字幕
整体语气：温暖、日常、小确幸；不要出现人类、文字水印、logo。`;

/** 本地兜底脚本（AI 繁忙/失败时零成本降级，保证功能可用）。 */
export function fallbackVideoScript(petName: string): VideoScript {
  return {
    scene: `${petName}在洒满阳光的窗边伸了个懒腰，尾巴轻轻摇摆`,
    subtitle: `${petName}的治愈日常`,
    bgmStyle: "lofi piano",
    prompt: `${petName}在洒满阳光的窗边伸懒腰，尾巴轻轻摇摆，镜头缓慢推近，9:16 竖屏构图，画面温暖柔和，下方留白`,
  };
}

export async function generateVideoScript(input: {
  petName: string;
  personality: string;
  locale: string;
}): Promise<{ script: VideoScript; source: "ai" | "fallback" }> {
  const langNote = input.locale === "en" ? "字幕 subtitle 用英文。" : "";
  try {
    const r = await generateThrottled({
      system: SCRIPT_SYSTEM,
      prompt: `灵宠名字：${input.petName}\n性格设定：${input.personality}\n${langNote}请输出脚本 JSON。`,
      temperature: 0.9,
      maxOutputTokens: 400,
    });
    const m = r.text.match(/\{[\s\S]*\}/);
    if (m) {
      const j = JSON.parse(m[0]) as Partial<VideoScript>;
      if (j.scene && j.subtitle && j.prompt) {
        return {
          script: {
            scene: String(j.scene).slice(0, 60),
            subtitle: String(j.subtitle).slice(0, 24),
            bgmStyle: String(j.bgmStyle || "lofi piano").slice(0, 40),
            prompt: String(j.prompt).slice(0, 120),
          },
          source: "ai",
        };
      }
    }
    throw new Error("script JSON malformed");
  } catch (err) {
    if (!(err instanceof AiBusyError)) {
      console.error("[pet-video] script generation fell back:", err instanceof Error ? err.message : err);
    }
    return { script: fallbackVideoScript(input.petName), source: "fallback" };
  }
}


// ---------- 2) 视频平台任务提交/查询 ----------

interface SubmitResult {
  taskId: string;
}

/** 提交图生视频异步任务（9:16、5s、audio=true）。未配置密钥抛错（路由层 503）。 */
export async function submitVideoTask(input: {
  imageUrl: string;
  prompt: string;
}): Promise<SubmitResult> {
  const key = klingApiKey();
  if (!key) throw new Error("kling not configured");
  const base = klingBaseUrl();

  if (isKlingOfficial()) {
    // 可灵官方开放平台：POST /v1/videos/image2video
    const res = await fetch(`${base}/v1/videos/image2video`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model_name: klingModel(),
        image: input.imageUrl,
        prompt: input.prompt,
        aspect_ratio: "9:16",
        duration: "5",
        mode: "std",
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const j = (await res.json().catch(() => null)) as {
      code?: number;
      message?: string;
      data?: { task_id?: string };
    } | null;
    if (!res.ok || !j?.data?.task_id) {
      throw new Error(`kling submit failed: ${res.status} ${j?.message ?? ""}`.trim());
    }
    return { taskId: j.data.task_id };
  }

  // 百炼 DashScope 异步任务模式
  const res = await fetch(`${base}/services/aigc/video-generation/video-synthesis`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "X-DashScope-Async": "enable",
    },
    body: JSON.stringify({
      model: klingModel(),
      input: { img_url: input.imageUrl, prompt: input.prompt },
      parameters: { size: "720*1280", duration: 5, audio: true, prompt_extend: true },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await res.json().catch(() => null)) as {
    code?: string;
    message?: string;
    output?: { task_id?: string };
  } | null;
  if (!res.ok || !j?.output?.task_id) {
    throw new Error(`dashscope submit failed: ${res.status} ${j?.message ?? j?.code ?? ""}`.trim());
  }
  return { taskId: j.output.task_id };
}

export interface TaskQueryResult {
  status: "pending" | "succeeded" | "failed";
  /** SUCCEEDED 时的平台临时视频 URL */
  videoUrl?: string;
  error?: string;
}

/** 查询异步任务状态。 */
export async function queryVideoTask(taskId: string): Promise<TaskQueryResult> {
  const key = klingApiKey();
  if (!key) throw new Error("kling not configured");
  const base = klingBaseUrl();

  if (isKlingOfficial()) {
    const res = await fetch(`${base}/v1/videos/image2video/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
    const j = (await res.json().catch(() => null)) as {
      data?: {
        task_status?: string;
        task_status_msg?: string;
        task_result?: { videos?: Array<{ url?: string }> };
      };
    } | null;
    const st = j?.data?.task_status;
    if (!res.ok || !st) throw new Error(`kling query failed: ${res.status}`);
    if (st === "succeed") {
      const url = j?.data?.task_result?.videos?.[0]?.url;
      return url ? { status: "succeeded", videoUrl: url } : { status: "failed", error: "empty result" };
    }
    if (st === "failed") return { status: "failed", error: j?.data?.task_status_msg || "task failed" };
    return { status: "pending" };
  }

  const res = await fetch(`${base}/tasks/${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await res.json().catch(() => null)) as {
    output?: { task_status?: string; video_url?: string; message?: string; code?: string };
  } | null;
  const st = j?.output?.task_status;
  if (!res.ok || !st) throw new Error(`dashscope query failed: ${res.status}`);
  if (st === "SUCCEEDED") {
    const url = j?.output?.video_url;
    return url ? { status: "succeeded", videoUrl: url } : { status: "failed", error: "empty result" };
  }
  if (st === "FAILED" || st === "CANCELED" || st === "UNKNOWN") {
    return { status: "failed", error: j?.output?.message || j?.output?.code || `task ${st.toLowerCase()}` };
  }
  return { status: "pending" };
}

// ---------- 3) Blob 转存（平台链接有效期短 → 自有对象存储） ----------

/** 拉取平台临时视频并转存 Vercel Blob；失败返回 null（调用方降级保留 source_url）。 */
export async function archiveVideoToBlob(generationId: string, sourceUrl: string): Promise<string | null> {
  try {
    const res = await fetch(sourceUrl, { signal: AbortSignal.timeout(45_000) });
    if (!res.ok || !res.body) throw new Error(`fetch video ${res.status}`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 1024) throw new Error("video too small");
    const blob = await put(`pet-videos/${generationId}.mp4`, buf, {
      access: "public",
      contentType: "video/mp4",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return blob.url;
  } catch (err) {
    console.error("[pet-video] blob archive failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

// ---------- 4) 配额（当日次数；failed 不计 = 失败自动退还） ----------

export async function dailyVideoUsage(userId: string): Promise<{ used: number; quota: number }> {
  const { rows } = await pool.query<{ used: string; quota: number }>(
    `SELECT
       (SELECT COUNT(*) FROM video_generations
         WHERE user_id = $1 AND status <> 'failed'
           AND created_at >= $2::date AND created_at < ($2::date + 1)) AS used,
       COALESCE((SELECT video_quota FROM users WHERE id = $1), 1) AS quota`,
    [userId, todayString()],
  );
  return { used: Number(rows[0]?.used ?? 0), quota: Number(rows[0]?.quota ?? 1) };
}

/** 单事务占位：校验配额并插入 pending 记录（并发下靠事务内重新计数兜底）。
 *  先占位再调 LLM/可灵：可灵调用只发生在占位成功后，被配额拒绝时零外部成本。 */
export async function createVideoGeneration(input: {
  userId: string;
  petId: string;
}): Promise<{ id: string } | { error: "quota_exceeded" }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: q } = await client.query<{ used: string; quota: number }>(
      `SELECT
         (SELECT COUNT(*) FROM video_generations
           WHERE user_id = $1 AND status <> 'failed'
             AND created_at >= $2::date AND created_at < ($2::date + 1)) AS used,
         COALESCE((SELECT video_quota FROM users WHERE id = $1), 1) AS quota`,
      [input.userId, todayString()],
    );
    if (Number(q[0]?.used ?? 0) >= Number(q[0]?.quota ?? 1)) {
      await client.query("ROLLBACK");
      return { error: "quota_exceeded" };
    }
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO video_generations (user_id, pet_id, status)
       VALUES ($1, $2, 'pending') RETURNING id`,
      [input.userId, input.petId],
    );
    await client.query("COMMIT");
    return { id: rows[0].id };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** 占位成功后回写：AI 脚本 + 平台任务 id，状态推进到 processing。 */
export async function bindVideoTask(
  id: string,
  taskId: string,
  script: VideoScript,
): Promise<void> {
  await pool.query(
    `UPDATE video_generations
        SET task_id=$2, script=$3::jsonb, status='processing', updated_at=now()
      WHERE id=$1`,
    [id, taskId, JSON.stringify(script)],
  );
}

/** 任务失败落库（status=failed → 当日计数自动释放，即"退还次数"）。 */
export async function markVideoFailed(id: string, error: string): Promise<void> {
  await pool.query(
    `UPDATE video_generations SET status='failed', error=$2, updated_at=now() WHERE id=$1`,
    [id, error.slice(0, 300)],
  );
}
