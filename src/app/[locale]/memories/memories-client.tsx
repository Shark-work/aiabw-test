"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Trash2, Edit3, Star, Loader2 } from "lucide-react";

type MemoryType = "preference" | "event" | "fact" | "emotion";

interface MemoryItem {
  id: string;
  memoryType: MemoryType;
  content: string;
  importance: number;
  timesRecalled: number;
  sourceMessage: string | null;
  createdAt: string;
  expiresAt: string | null;
}

type Status = "loading" | "ready" | "forbidden" | "error";

const TYPES: MemoryType[] = ["preference", "event", "fact", "emotion"];

/**
 * 记忆库客户端（鉴权模式对齐 de6453d / explore-v2 修复）：
 *  - 登录态只存 localStorage(aiabw_token)，所有 /api/memories 请求带 Bearer
 *  - 无 token / 401 → 清 stale token，重定向 /{locale}/login?redirect=/{locale}/memories
 *  - 403 VIP_REQUIRED → 订阅引导；组件仅做展示，不读写任何 cookie
 */
export function MemoriesClient() {
  const t = useTranslations("memories");
  const locale = useLocale();
  const router = useRouter();
  const [status, setStatus] = useState<Status>("loading");
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [daysRemaining, setDaysRemaining] = useState(0);
  const [filter, setFilter] = useState<"all" | MemoryType>("all");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [editing, setEditing] = useState<MemoryItem | null>(null);
  const [editDraft, setEditDraft] = useState({
    content: "",
    importance: 5,
    memoryType: "preference" as MemoryType,
  });
  const [confirmDelete, setConfirmDelete] = useState<MemoryItem | null>(null);
  const [saving, setSaving] = useState(false);

  /** 未登录或 401：清 stale token，回跳登录页（redirect 参数供登录后跳回） */
  const gotoLogin = useCallback(() => {
    try {
      localStorage.removeItem("aiabw_token");
    } catch {
      /* ignore */
    }
    router.replace(`/${locale}/login?redirect=/${locale}/memories`);
  }, [locale, router]);

  /** 统一 Bearer 请求；无 token / 401 自动转登录页 */
  const authFetch = useCallback(
    async (input: string, init?: RequestInit) => {
      const token = localStorage.getItem("aiabw_token");
      if (!token) {
        gotoLogin();
        throw new Error("not signed in");
      }
      const res = await fetch(input, {
        ...init,
        headers: {
          ...(init?.headers ?? {}),
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.status === 401) {
        gotoLogin();
        throw new Error("session expired");
      }
      return res;
    },
    [gotoLogin],
  );

  /** 拉取第一页（挂载 + 失败重试共用） */
  const loadFirstPage = useCallback(async () => {
    setStatus("loading");
    try {
      const url = new URL("/api/memories", window.location.origin);
      url.searchParams.set("page", "1");
      url.searchParams.set("pageSize", "20");
      const res = await authFetch(url.toString());
      const data = (await res.json()) as {
        memories?: MemoryItem[];
        daysRemaining?: number;
      };
      if (res.status === 403) {
        setStatus("forbidden");
        return;
      }
      if (!res.ok) {
        setStatus("error");
        return;
      }
      setMemories(data.memories ?? []);
      setHasMore((data.memories?.length ?? 0) >= 20);
      setDaysRemaining(data.daysRemaining ?? 0);
      setPage(1);
      setStatus("ready");
    } catch (err) {
      // 401/未登录：authFetch 已触发登录页重定向
      if (err instanceof Error && /signed in|expired/.test(err.message)) return;
      setStatus("error");
    }
  }, [authFetch]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  const filtered = useMemo(
    () =>
      filter === "all"
        ? memories
        : memories.filter((m) => m.memoryType === filter),
    [memories, filter],
  );

  const fetchPage = useCallback(
    async (p: number) => {
      const url = new URL("/api/memories", window.location.origin);
      url.searchParams.set("page", String(p));
      url.searchParams.set("pageSize", "20");
      if (filter !== "all") url.searchParams.set("type", filter);
      const res = await authFetch(url.toString());
      const data = (await res.json()) as { memories?: MemoryItem[] };
      return data;
    },
    [authFetch, filter],
  );

  const onFilterChange = useCallback(async (next: "all" | MemoryType) => {
    setFilter(next);
    setPage(1);
    setLoadingMore(true);
    try {
      const url = new URL("/api/memories", window.location.origin);
      url.searchParams.set("page", "1");
      url.searchParams.set("pageSize", "20");
      if (next !== "all") url.searchParams.set("type", next);
      const res = await authFetch(url.toString());
      const data = (await res.json()) as { memories?: MemoryItem[] };
      setMemories(data.memories ?? []);
      setHasMore((data.memories?.length ?? 0) >= 20);
    } catch {
      /* 401 已由 authFetch 转登录页 */
    } finally {
      setLoadingMore(false);
    }
  }, [authFetch]);

  const onLoadMore = useCallback(async () => {
    setLoadingMore(true);
    try {
      const next = page + 1;
      const data = await fetchPage(next);
      setMemories((prev) => [...prev, ...(data.memories ?? [])]);
      setHasMore((data.memories?.length ?? 0) >= 20);
      setPage(next);
    } catch {
      /* 401 已由 authFetch 转登录页 */
    } finally {
      setLoadingMore(false);
    }
  }, [fetchPage, page]);

  const onStartEdit = useCallback((m: MemoryItem) => {
    setEditing(m);
    setEditDraft({
      content: m.content,
      importance: m.importance,
      memoryType: m.memoryType,
    });
  }, []);

  const onSaveEdit = useCallback(async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const res = await authFetch(`/api/memories/${editing.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: editDraft.content,
          importance: editDraft.importance,
          memoryType: editDraft.memoryType,
        }),
      });
      if (res.status === 403) {
        setStatus("forbidden");
        return;
      }
      const data = (await res.json()) as { ok: boolean; memory?: MemoryItem };
      if (data.ok && data.memory) {
        setMemories((prev) =>
          prev.map((m) =>
            m.id === data.memory!.id
              ? {
                  ...m,
                  content: data.memory!.content,
                  importance: data.memory!.importance,
                  memoryType: data.memory!.memoryType as MemoryType,
                }
              : m,
          ),
        );
        setEditing(null);
      }
    } finally {
      setSaving(false);
    }
  }, [authFetch, editDraft, editing]);

  const onConfirmDelete = useCallback(async () => {
    if (!confirmDelete) return;
    setSaving(true);
    try {
      const res = await authFetch(`/api/memories/${confirmDelete.id}`, {
        method: "DELETE",
      });
      if (res.status === 403) {
        setStatus("forbidden");
        return;
      }
      const data = (await res.json()) as { ok: boolean };
      if (data.ok) {
        setMemories((prev) => prev.filter((m) => m.id !== confirmDelete.id));
        setConfirmDelete(null);
      }
    } finally {
      setSaving(false);
    }
  }, [authFetch, confirmDelete]);

  return (
    <main className="mx-auto min-h-dvh w-full max-w-3xl bg-gradient-to-br from-orange-50 via-white to-rose-50 px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-zinc-900 sm:text-3xl">
          {t("title")}
        </h1>
        <p className="mt-2 text-sm text-zinc-500">{t("subtitle")}</p>
        {status === "ready" && daysRemaining > 0 ? (
          <p className="mt-2 inline-block rounded-full bg-violet-100 px-3 py-1 text-xs font-medium text-violet-700">
            💎 VIP · {t("vipDays", { days: daysRemaining })}
          </p>
        ) : null}
      </header>

      {status === "loading" ? (
        <div className="mt-10 flex justify-center text-violet-500">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : status === "forbidden" ? (
        <div className="rounded-xl border border-dashed border-violet-300 bg-violet-50 p-6 text-center">
          <p className="text-sm font-medium text-violet-700">{t("vipOnly")}</p>
          <p className="mt-1 text-xs text-violet-500">{t("upgradeHint")}</p>
          <Link
            href={`/${locale}/subscribe`}
            className="mt-3 inline-block rounded-full bg-violet-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-violet-700"
          >
            {t("subscribeNow")}
          </Link>
        </div>
      ) : status === "error" ? (
        <div className="rounded-xl border border-dashed border-zinc-300 p-6 text-center">
          <p className="text-sm text-zinc-500">{t("loadFailed")}</p>
          <button
            type="button"
            onClick={() => void loadFirstPage()}
            className="mt-3 rounded-full border border-violet-300 px-4 py-1.5 text-sm font-medium text-violet-700 transition hover:bg-violet-50"
          >
            {t("retry")}
          </button>
        </div>
      ) : null}

      {status === "ready" ? (
        <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FilterChip
          active={filter === "all"}
          onClick={() => onFilterChange("all")}
          label={t("filterAll")}
        />
        {TYPES.map((ty) => (
          <FilterChip
            key={ty}
            active={filter === ty}
            onClick={() => onFilterChange(ty)}
            label={t(
              `filter${ty.charAt(0).toUpperCase() + ty.slice(1)}` as Parameters<typeof t>[0],
            )}
          />
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-200 bg-white p-12 text-center text-sm text-zinc-500">
          {t("empty")}
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((m) => (
            <li
              key={m.id}
              className="rounded-2xl border border-zinc-100 bg-white p-4 shadow-sm transition hover:border-violet-200 hover:shadow"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-medium text-zinc-600">
                      {t(
                        `filter${m.memoryType.charAt(0).toUpperCase() + m.memoryType.slice(1)}` as Parameters<typeof t>[0],
                      )}
                    </span>
                    <span>·</span>
                    <span>{formatTimeAgo(m.createdAt, t)}</span>
                    <span>·</span>
                    <span>
                      {t("importance")} {renderStars(m.importance)}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm text-zinc-800">
                    {m.content}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => onStartEdit(m)}
                    className="rounded-md p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
                    title={t("edit")}
                  >
                    <Edit3 className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(m)}
                    className="rounded-md p-1.5 text-zinc-400 transition hover:bg-rose-50 hover:text-rose-600"
                    title={t("delete")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {hasMore ? (
        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition hover:border-violet-300 hover:text-violet-700 disabled:opacity-50"
          >
            {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t("loadMore")}
          </button>
        </div>
      ) : null}
        </>
      ) : null}

      {editing ? (
        <Modal title={t("editTitle")} onClose={() => !saving && setEditing(null)}>
          <label className="block text-xs font-medium text-zinc-600">
            {t("editTitle")}
          </label>
          <textarea
            value={editDraft.content}
            onChange={(e) =>
              setEditDraft((d) => ({ ...d, content: e.target.value }))
            }
            rows={4}
            className="mt-1 w-full rounded-lg border border-zinc-200 bg-white p-2 text-sm"
          />
          <div className="mt-3 flex gap-3">
            <label className="flex-1 text-xs font-medium text-zinc-600">
              {t("importance")}
              <input
                type="number"
                min={1}
                max={10}
                value={editDraft.importance}
                onChange={(e) =>
                  setEditDraft((d) => ({
                    ...d,
                    importance: Number(e.target.value) || 5,
                  }))
                }
                className="mt-1 w-full rounded-lg border border-zinc-200 bg-white p-2 text-sm"
              />
            </label>
            <label className="flex-1 text-xs font-medium text-zinc-600">
              type
              <select
                value={editDraft.memoryType}
                onChange={(e) =>
                  setEditDraft((d) => ({
                    ...d,
                    memoryType: e.target.value as MemoryType,
                  }))
                }
                className="mt-1 w-full rounded-lg border border-zinc-200 bg-white p-2 text-sm"
              >
                {TYPES.map((ty) => (
                  <option key={ty} value={ty}>
                    {t(
                      `filter${ty.charAt(0).toUpperCase() + ty.slice(1)}` as Parameters<typeof t>[0],
                    )}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(null)}
              disabled={saving}
              className="rounded-lg px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100"
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              onClick={onSaveEdit}
              disabled={saving || !editDraft.content.trim()}
              className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-violet-700 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("save")}
            </button>
          </div>
        </Modal>
      ) : null}

      {confirmDelete ? (
        <Modal
          title={t("delete")}
          onClose={() => !saving && setConfirmDelete(null)}
        >
          <p className="text-sm text-zinc-600">{t("deleteConfirm")}</p>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmDelete(null)}
              disabled={saving}
              className="rounded-lg px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100"
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              onClick={onConfirmDelete}
              disabled={saving}
              className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-rose-700 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t("delete")}
            </button>
          </div>
        </Modal>
      ) : null}
    </main>
  );
}




function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium transition ${
        active
          ? "bg-violet-600 text-white"
          : "border border-zinc-200 bg-white text-zinc-600 hover:border-violet-300 hover:text-violet-700"
      }`}
    >
      {label}
    </button>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-base font-semibold text-zinc-900">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function renderStars(importance: number) {
  return (
    <span className="inline-flex">
      {Array.from({ length: 10 }).map((_, i) => (
        <Star
          key={i}
          className={`h-3 w-3 ${
            i < importance ? "fill-amber-400 text-amber-400" : "text-zinc-200"
          }`}
        />
      ))}
    </span>
  );
}

function formatTimeAgo(
  iso: string,
  t: ReturnType<typeof useTranslations>,
): string {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return "";
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days === 0) return t("today");
  if (days < 0) return t("today");
  return t("daysAgo", { days });
}
