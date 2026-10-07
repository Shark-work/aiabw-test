"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { Link, useRouter } from "@/i18n/navigation";

interface VideoScript {
  scene: string;
  subtitle: string;
  bgmStyle: string;
  prompt: string;
}

interface Generation {
  id: string;
  status: "pending" | "processing" | "succeeded" | "failed";
  script: VideoScript | null;
  videoUrl: string | null;
  error: string | null;
}

type Phase = "loading" | "idle" | "generating" | "done" | "failed";

const POLL_INTERVAL_MS = 5000;
/** 前端轮询上限（与后端 TASK_TIMEOUT_MS 对齐 + 余量）。 */
const POLL_DEADLINE_MS = 11 * 60 * 1000;

/**
 * 灵宠日常短视频客户端（Phase 10）
 *  - 状态机：loading（恢复进行中任务）→ idle（可生成）→ generating（5s 轮询 /api/video/poll）
 *    → done（播放器 + 水印 + 下载/分享）/ failed（次数已退还，可重试）；
 *  - 水印：播放器右下角叠层（aiabw.com，pointer-events-none）；分享文案带官网链接反哺冷启动；
 *  - 分享小红书/B 站：navigator.share 优先，剪贴板兜底（复制文案+视频链接）。
 */
export function PetVideoClient({ petId }: { petId: string }) {
  const t = useTranslations("petVideo");
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("loading");
  const [gen, setGen] = useState<Generation | null>(null);
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStartedAt = useRef<number>(0);

  const token = () =>
    typeof window !== "undefined" ? localStorage.getItem("aiabw_token") ?? "" : "";

  const stopPolling = () => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  };

  const applyGeneration = useCallback((g: Generation) => {
    setGen(g);
    if (g.status === "succeeded") {
      stopPolling();
      setPhase("done");
    } else if (g.status === "failed") {
      stopPolling();
      setErrorMsg(g.error);
      setPhase("failed");
    }
  }, []);

  const startPolling = useCallback(
    (id: string) => {
      stopPolling();
      pollStartedAt.current = Date.now();
      pollTimer.current = setInterval(async () => {
        if (Date.now() - pollStartedAt.current > POLL_DEADLINE_MS) {
          stopPolling();
          setErrorMsg("poll timeout");
          setPhase("failed");
          return;
        }
        try {
          const res = await fetch(`/api/video/poll?id=${encodeURIComponent(id)}`, {
            headers: { Authorization: `Bearer ${token()}` },
          });
          if (!res.ok) return; // 瞬时错误下一轮重试
          const j = (await res.json()) as Generation;
          applyGeneration(j);
        } catch {
          // 网络抖动：下一轮重试
        }
      }, POLL_INTERVAL_MS);
    },
    [applyGeneration],
  );

  // 进入页面：恢复该灵宠最近一次生成（进行中则继续轮询）
  useEffect(() => {
    if (!token()) {
      router.push(`/login?redirect=/pets/${petId}/video`);
      return;
    }
    (async () => {
      try {
        const res = await fetch(`/api/video/poll?petId=${encodeURIComponent(petId)}`, {
          headers: { Authorization: `Bearer ${token()}` },
        });
        if (res.status === 401) {
          router.push(`/login?redirect=/pets/${petId}/video`);
          return;
        }
        const j = (await res.json()) as { latest: Generation | null };
        const latest = j.latest;
        if (!latest || latest.status === "failed") {
          setGen(latest);
          setPhase("idle");
        } else if (latest.status === "succeeded") {
          setGen(latest);
          setPhase("done");
        } else {
          setGen(latest);
          setPhase("generating");
          startPolling(latest.id);
        }
      } catch {
        setPhase("idle");
      }
    })();
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [petId]);

  const generate = async () => {
    setErrorMsg(null);
    setPhase("generating");
    try {
      const res = await fetch(`/api/pets/${encodeURIComponent(petId)}/video/generate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token()}` },
      });
      const j = (await res.json()) as {
        id?: string;
        error?: string;
        usage?: { used: number; quota: number };
      };
      if (j.usage) setUsage(j.usage);
      if (!res.ok || !j.id) {
        setErrorMsg(j.error ?? "error");
        setPhase(res.status === 429 ? "idle" : "failed");
        return;
      }
      startPolling(j.id);
    } catch {
      setErrorMsg("network");
      setPhase("failed");
    }
  };

  const shareText = () => {
    const name = gen?.script?.subtitle ?? t("shareFallbackTitle");
    return t("shareText", { name, url: "https://www.aiabw.com" });
  };

  const share = async (channel: "xiaohongshu" | "bilibili") => {
    const text = `${shareText()} ${gen?.videoUrl ?? ""}`.trim();
    try {
      if (navigator.share) {
        await navigator.share({ title: t("title"), text, url: gen?.videoUrl ?? undefined });
      } else {
        await navigator.clipboard.writeText(text);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // 剪贴板权限被拒：静默
      }
    }
    void channel; // 两个按钮同一动作（复制/系统分享），渠道仅留作后续埋点扩展
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 pb-10 pt-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-zinc-900">{t("title")}</h1>
        <Link href="/pets/my" className="text-xs text-zinc-400 hover:text-zinc-600">
          ← {t("backToMyPets")}
        </Link>
      </div>

      {/* 额度条 */}
      <div className="mt-3 rounded-xl border border-violet-100 bg-violet-50/70 px-3 py-2 text-xs text-violet-700">
        {usage
          ? t("quotaLeft", { left: Math.max(0, usage.quota - usage.used), max: usage.quota })
          : t("quotaHint")}
      </div>

      {/* 9:16 舞台 */}
      <div className="relative mt-4 overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-950 shadow-lg"
        style={{ aspectRatio: "9 / 16" }}
      >
        {phase === "done" && gen?.videoUrl ? (
          <>
            <video
              src={gen.videoUrl}
              controls
              playsInline
              loop
              className="h-full w-full object-contain"
              data-testid="pet-video-player"
            />
            {/* 水印叠层：官网链接（serverless 无 ffmpeg 烧录，叠层 + 分享文案双保险） */}
            <div className="pointer-events-none absolute bottom-2 right-2 rounded bg-black/40 px-1.5 py-0.5 text-[10px] font-medium text-white/90">
              aiabw.com
            </div>
            {gen.script?.subtitle && (
              <div className="pointer-events-none absolute bottom-8 left-0 right-0 text-center">
                <span className="rounded bg-black/50 px-2 py-1 text-xs font-semibold text-white">
                  {gen.script.subtitle}
                </span>
              </div>
            )}
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            {phase === "generating" || phase === "loading" ? (
              <>
                <div className="h-10 w-10 animate-spin rounded-full border-2 border-violet-300 border-t-transparent" />
                <p className="px-6 text-sm text-zinc-300">{t("generating")}</p>
                <p className="px-6 text-[11px] text-zinc-500">{t("generatingHint")}</p>
              </>
            ) : phase === "failed" ? (
              <>
                <span className="text-3xl">😿</span>
                <p className="px-6 text-sm text-zinc-300">{t("failed")}</p>
                {errorMsg && <p className="px-6 text-[11px] text-zinc-500">{errorMsg}</p>}
                <p className="px-6 text-[11px] text-emerald-400">{t("failedRefunded")}</p>
              </>
            ) : (
              <>
                <span className="text-4xl">🎬</span>
                <p className="px-6 text-sm text-zinc-300">{t("idleHint")}</p>
              </>
            )}
          </div>
        )}
      </div>

      {/* 脚本信息（完成后展示） */}
      {phase === "done" && gen?.script && (
        <div className="mt-3 space-y-1 rounded-xl border border-zinc-100 bg-white/80 p-3 text-xs text-zinc-600">
          <p>🎬 {gen.script.scene}</p>
          <p>🎵 {t("bgmLabel")}: {gen.script.bgmStyle}</p>
        </div>
      )}

      {/* 操作区 */}
      <div className="mt-4 space-y-2">
        {phase === "done" && gen?.videoUrl ? (
          <>
            <a
              href={gen.videoUrl}
              download
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-full bg-violet-500 px-4 py-2.5 text-center text-sm font-semibold text-white shadow transition hover:bg-violet-600"
            >
              ⬇️ {t("download")}
            </a>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => share("xiaohongshu")}
                className="flex-1 rounded-full border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-100"
              >
                {t("shareXhs")}
              </button>
              <button
                type="button"
                onClick={() => share("bilibili")}
                className="flex-1 rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-600 transition hover:bg-sky-100"
              >
                {t("shareBili")}
              </button>
            </div>
            {copied && (
              <p className="text-center text-xs text-emerald-600">{t("shareCopied")}</p>
            )}
            <button
              type="button"
              onClick={generate}
              className="w-full rounded-full border border-zinc-200 px-4 py-2 text-xs text-zinc-500 transition hover:bg-zinc-50"
            >
              {t("regenerate")}
            </button>
          </>
        ) : phase !== "generating" && phase !== "loading" ? (
          <button
            type="button"
            onClick={generate}
            className="w-full rounded-full bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white shadow transition hover:bg-violet-600 disabled:opacity-50"
          >
            🎬 {phase === "failed" ? t("retry") : t("generateCta")}
          </button>
        ) : null}
      </div>
    </main>
  );
}

