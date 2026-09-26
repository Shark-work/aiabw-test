"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { PORTRAIT_STYLES } from "@/lib/ugc-workshop";

type Quota = {
  isVip: boolean;
  todayCount: number;
  dailyLimit: number; // -1 = 无限（VIP）
  remaining: number; // -1 = 无限
  costYuan: number;
};

type Result = { imageUrl: string; hd: boolean; watermarked: boolean };

type Phase = "idle" | "generating" | "done" | "error";

/** 前端上传限制：≤5MB（与 API 端 MAX_PHOTO_BASE64_LEN 对应） */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** AI 宠物写真工坊：上传照片 + 10 种风格 → 生成 → 结果展示 */
export function PortraitClient() {
  const t = useTranslations("workshop.portrait");
  const tm = useTranslations("workshop");
  const [auth, setAuth] = useState<"loading" | "guest" | "authed">("loading");
  const [quota, setQuota] = useState<Quota | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [styleId, setStyleId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 配额查询（含 VIP 状态）
  useEffect(() => {
    const token = localStorage.getItem("aiabw_token");
    if (!token) {
      setAuth("guest");
      return;
    }
    fetch("/api/ugc/generate-portrait", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        if (r.status === 401) {
          setAuth("guest");
          return;
        }
        const d = await r.json();
        if (d?.ok) setQuota(d as Quota);
        setAuth("authed");
      })
      .catch(() => setAuth("authed")); // 配额失败不阻塞页面，生成时后端仍会校验
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const onPickFile = (f: File | undefined) => {
    setPhotoError(null);
    if (!f) return;
    if (f.size > MAX_FILE_BYTES) {
      setPhotoError(t("photoTooBig"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPhoto(reader.result as string);
    reader.readAsDataURL(f);
  };

  // 生成：真实请求 + 模拟进度条（生图约 30s，先平滑爬升到 90%，响应到达后补满）
  const generate = async () => {
    if (!photo) {
      setErrMsg(t("needPhoto"));
      return;
    }
    if (!styleId) {
      setErrMsg(t("needStyle"));
      return;
    }
    setErrMsg(null);
    setResult(null);
    setPhase("generating");
    setProgress(3);
    timerRef.current = setInterval(() => {
      setProgress((p) => Math.min(90, p + Math.random() * 6));
    }, 800);

    try {
      const token = localStorage.getItem("aiabw_token") ?? "";
      const res = await fetch("/api/ugc/generate-portrait", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ styleType: styleId, photo }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.ok && d.imageUrl) {
        setResult({ imageUrl: d.imageUrl, hd: !!d.hd, watermarked: !!d.watermarked });
        setPhase("done");
        setProgress(100);
        setQuota((q) =>
          q ? { ...q, remaining: d.remaining, todayCount: q.todayCount + 1 } : q,
        );
      } else {
        setErrMsg(typeof d?.error === "string" ? d.error : t("failed"));
        setPhase("error");
      }
    } catch {
      setErrMsg(t("failed"));
      setPhase("error");
    } finally {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  };

  // ── 渲染 ──────────────────────────────────────────────
  if (auth === "loading") return null;
  if (auth === "guest") {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <p className="text-sm text-zinc-600">{t("loginFirst")}</p>
        <Link
          href="/login"
          className="mt-4 inline-block rounded-full bg-orange-500 px-6 py-2 text-sm font-semibold text-white"
        >
          {t("loginFirst")}
        </Link>
      </div>
    );
  }

  const generating = phase === "generating";
  const freeUsedUp = !!quota && !quota.isVip && quota.remaining === 0;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="text-center text-xl font-bold text-zinc-900 sm:text-2xl">
        📸 {tm("portraitTitle")}
      </h1>

      {/* 配额条 */}
      {quota && (
        <p className="mt-3 text-center text-xs text-zinc-500">
          {quota.isVip
            ? `💎 ${t("quotaVip")}`
            : freeUsedUp
              ? `⛔ ${t("quotaUsedUp")}`
              : `${t("quotaFree")} · ${t("remainingToday", { n: quota.remaining })}`}
        </p>
      )}

      {/* 上传组件 */}
      <div className="mt-6">
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => onPickFile(e.target.files?.[0])}
        />
        {photo ? (
          <div className="flex items-center gap-4 rounded-2xl border border-zinc-200 bg-white p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo}
              alt={t("upload")}
              className="h-24 w-24 rounded-xl object-cover"
            />
            <div className="flex-1">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="rounded-full border border-zinc-300 px-4 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50"
              >
                🔄 {t("change")}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-zinc-300 bg-white/60 px-4 py-10 text-zinc-500 transition hover:border-violet-400 hover:text-violet-600"
          >
            <span className="text-3xl" aria-hidden>
              🖼️
            </span>
            <span className="text-sm font-medium">{t("upload")}</span>
            <span className="text-xs text-zinc-400">{t("uploadHint")}</span>
          </button>
        )}
        {photoError && <p className="mt-2 text-xs text-rose-500">{photoError}</p>}
      </div>

      {/* 风格选择器：10 种预设网格 */}
      <p className="mt-6 mb-2 text-xs font-semibold text-zinc-500">{t("pickStyle")}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {PORTRAIT_STYLES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setStyleId(s.id)}
            className={`flex flex-col items-center gap-1 rounded-xl border bg-gradient-to-br from-violet-50 to-fuchsia-50 px-2 py-3 transition ${
              styleId === s.id
                ? "border-violet-500 ring-2 ring-violet-300"
                : "border-zinc-200 hover:border-violet-300"
            }`}
          >
            <span className="text-3xl" aria-hidden>
              {s.emoji}
            </span>
            <span className="text-xs font-medium text-zinc-700">
              {t(`styles.${s.id}`)}
            </span>
          </button>
        ))}
      </div>


      {/* 生成按钮 + 成本透明化标注 */}
      <div className="mt-6">
        <button
          type="button"
          onClick={generate}
          disabled={generating || !photo || !styleId || freeUsedUp}
          className="w-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:opacity-95 disabled:opacity-50"
        >
          {generating ? `⏳ ${t("generating")}` : `✨ ${t("generate")}`}
        </button>
        <p className="mt-1.5 text-center text-[11px] text-zinc-400">
          💰 {t("costHint")}
        </p>
        {freeUsedUp && (
          <p className="mt-2 text-center text-xs">
            <Link href="/subscribe" className="font-semibold text-amber-600 hover:underline">
              👑 {t("upgrade")}
            </Link>
          </p>
        )}
      </div>

      {/* 生成进度条 */}
      {generating && (
        <div className="mt-4">
          <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200">
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all duration-700"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* 错误提示 + 重试 */}
      {phase === "error" && errMsg && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-center text-sm text-rose-600">
          {errMsg}
          <button
            type="button"
            onClick={generate}
            className="ml-2 font-semibold underline"
          >
            {t("retry")}
          </button>
        </div>
      )}

      {/* 结果展示区 */}
      {phase === "done" && result && (
        <div className="mt-6">
          <p className="mb-2 text-xs font-semibold text-zinc-500">
            {t("result")} ·{" "}
            <span className={result.hd ? "text-emerald-600" : "text-amber-600"}>
              {result.hd ? `💎 ${t("hd")}` : `🔖 ${t("sd")}`}
            </span>
          </p>
          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={result.imageUrl}
              alt={tm("portraitTitle")}
              className="block w-full"
              draggable={false}
            />
          </div>
          <a
            href={result.imageUrl}
            target="_blank"
            rel="noreferrer"
            download
            className="mt-3 block rounded-full bg-zinc-900 px-4 py-3 text-center text-sm font-semibold text-white"
          >
            ⬇️ {t("download")}
          </a>
        </div>
      )}
    </div>
  );
}

