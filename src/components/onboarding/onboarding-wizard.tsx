"use client";

/**
 * 新手引导「唤醒仪式」三步流程（P1 故事外显）：
 *  Step 1 遇见：沉睡灵宠展示（灰调滤镜 + 💤），「一段沉睡的灵魂正在等待唤醒」；
 *  Step 2 唤醒：点击唤醒 → POST /api/pets/claim（领养 + 自动生成灵魂凭证）→
 *    展示全球唯一编号（AIBI-000456）+ 卡面预览；
 *  Step 3 启程：给灵宠起名 →「第一次对话」或「第一次探索」二选一 →
 *    标记完成（POST /api/onboarding）并跳转。
 *
 * 叙事约束（P0 概念收敛；违禁词清单由 tests/onboarding.test.mjs 全文扫描锁定）：
 * 流程文案统一使用「唤醒 / 生成凭证 / 全球唯一编号」。
 *
 * 登录门槛与 explore-v2 同策略：登录态只存 localStorage aiabw_token（客户端判定），
 * 无 token / 401 → 引导登录后回跳 /onboarding；已完成或已有灵宠 → 直达首页。
 */

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Link, useRouter } from "@/i18n/navigation";
import {
  ELEMENT_META,
  RARITY_META,
  normalizeElement,
  normalizeRarity,
} from "@/lib/soul-card-config";

type Candidate = {
  petId: string;
  speciesId: string;
  name: string;
  category: string;
  habitat: string | null;
  imageUrl: string | null;
  rarity: string;
  element: string | null;
};

type ClaimState = {
  adoptionId: string;
  threadId: string | null;
  petId: string;
  petName: string;
  imageUrl: string | null;
  certificateNo: string | null;
  rarity: string;
  element: string | null;
};

type Phase = "loading" | "meet" | "awaken" | "awakened" | "journey" | "empty";

function bearerHeaders(): HeadersInit {
  const token = localStorage.getItem("aiabw_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function OnboardingWizard() {
  const t = useTranslations("onboarding");
  const locale = useLocale();
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("loading");
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [claim, setClaim] = useState<ClaimState | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState("");
  const [pending, setPending] = useState(false);

  const bootstrap = useCallback(async () => {
    if (!localStorage.getItem("aiabw_token")) {
      router.replace("/login?redirect=/onboarding");
      return;
    }
    try {
      const res = await fetch("/api/onboarding", {
        headers: bearerHeaders(),
        cache: "no-store",
      });
      if (res.status === 401) {
        localStorage.removeItem("aiabw_token");
        router.replace("/login?redirect=/onboarding");
        return;
      }
      const data = (await res.json()) as {
        ok: boolean;
        completed?: boolean;
        hasPet?: boolean;
        candidate?: Candidate | null;
      };
      if (!data?.ok) throw new Error("status failed");
      // 已完成引导或已持有灵宠（老用户）→ 不进入仪式，直达首页
      if (data.completed || data.hasPet) {
        router.replace("/");
        return;
      }
      if (!data.candidate) {
        setPhase("empty");
        return;
      }
      setCandidate(data.candidate);
      setPhase("meet");
    } catch {
      setError(t("loadFailed"));
      setPhase("empty");
    }
  }, [router, t]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  /** Step 2：唤醒（领养 + 自动生成灵魂凭证，复用 P0 claim 链路） */
  async function handleAwaken() {
    if (claiming || !candidate) return;
    setClaiming(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/pets/claim", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-locale": locale,
          ...bearerHeaders(),
        },
        body: JSON.stringify({ petId: candidate.petId }),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 410) {
        // 这只灵宠刚被别人抢先唤醒 → 重新寻找一只，回到 Step 1
        setNotice(t("awaken.gone"));
        setCandidate(null);
        setPhase("loading");
        void bootstrap();
        return;
      }
      if (!res.ok || !data?.ok || !data.adoption) {
        setError(data?.error ?? t("awaken.failed"));
        return;
      }
      setClaim({
        adoptionId: String(data.adoption.id),
        threadId: data.threadId ? String(data.threadId) : null,
        petId: String(data.pet.id),
        petName: String(data.adoption.petName ?? data.pet.speciesName),
        imageUrl: data.pet.imageUrl ? String(data.pet.imageUrl) : candidate.imageUrl,
        certificateNo: data.soulCard?.certificateNo
          ? String(data.soulCard.certificateNo)
          : null,
        rarity: String(data.soulCard?.rarity ?? candidate.rarity),
        element: data.soulCard?.element ?? candidate.element,
      });
      setName(String(data.pet.speciesName ?? data.adoption.petName ?? ""));
      setPhase("awakened");
    } catch {
      setError(t("awaken.failed"));
    } finally {
      setClaiming(false);
    }
  }

  /** Step 3：提交灵宠名（幂等；返回是否成功，供 CTA 串联）。 */
  async function submitName(): Promise<boolean> {
    const n = name.trim();
    if (!claim) return false;
    if (n.length < 1 || n.length > 24) {
      setNameError(t("journey.nameInvalid"));
      return false;
    }
    setNameError("");
    try {
      const res = await fetch("/api/onboarding/name", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...bearerHeaders() },
        body: JSON.stringify({
          adoptionId: claim.adoptionId,
          petId: claim.petId,
          name: n,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setNameError(data?.error ?? t("journey.nameInvalid"));
        return false;
      }
      return true;
    } catch {
      setNameError(t("journey.nameInvalid"));
      return false;
    }
  }

  /** Step 3 终点：起名 → 标记完成 → 第一次对话 / 第一次探索（二选一）。 */
  async function finalize(dest: "chat" | "explore") {
    if (pending || !claim) return;
    setPending(true);
    try {
      const named = await submitName();
      if (!named) return;
      await fetch("/api/onboarding", {
        method: "POST",
        headers: bearerHeaders(),
      }).catch(() => {
        /* 完成标记失败不阻断跳转（banner 会继续提示，下次可自然完成） */
      });
      router.push(
        dest === "chat"
          ? `/chat?thread=${claim.threadId}&adopt=${claim.adoptionId}`
          : "/explore-v2",
      );
    } finally {
      setPending(false);
    }
  }

  const rarity = normalizeRarity(claim?.rarity ?? candidate?.rarity);
  const rarityMeta = RARITY_META[rarity];
  const element = normalizeElement(claim?.element ?? candidate?.element);
  const elementMeta = ELEMENT_META[element];
  const stepNo =
    phase === "meet"
      ? 1
      : phase === "awaken" || phase === "awakened"
        ? 2
        : phase === "journey"
          ? 3
          : 0;

  return (
    <div className="space-y-6">
      {/* 步骤指示器（仅流程内展示） */}
      {stepNo > 0 ? (
        <div
          className="flex items-center justify-center gap-2"
          aria-label={t("stepOf", { step: stepNo })}
        >
          {[1, 2, 3].map((s) => (
            <span
              key={s}
              className={`h-2 w-8 rounded-full transition ${
                s <= stepNo ? "bg-violet-500" : "bg-zinc-200 dark:bg-zinc-700"
              }`}
            />
          ))}
        </div>
      ) : null}

      {notice ? (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-center text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          {notice}
        </p>
      ) : null}

      {phase === "loading" ? (
        <p className="py-20 text-center text-sm text-zinc-400">{t("loading")}</p>
      ) : null}

      {phase === "empty" ? (
        <section className="space-y-4 py-16 text-center">
          <div className="text-5xl">🌲</div>
          <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
            {t("empty.title")}
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("empty.desc")}</p>
          {error ? <p className="text-xs text-red-500">{error}</p> : null}
          <Link
            href="/"
            className="inline-block rounded-full bg-violet-600 px-6 py-2 text-sm font-semibold text-white transition hover:bg-violet-700"
          >
            {t("empty.cta")}
          </Link>
        </section>
      ) : null}

      {/* ============ Step 1 · 遇见 ============ */}
      {phase === "meet" && candidate ? (
        <section className="space-y-5 text-center">
          <h1 className="text-xl font-bold tracking-widest text-zinc-900 dark:text-zinc-100">
            {t("meet.title")}
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("meet.desc")}</p>

          <div className="relative mx-auto w-56">
            <div className="overflow-hidden rounded-3xl border border-zinc-200 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800">
              {candidate.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={candidate.imageUrl}
                  alt={candidate.name}
                  className="aspect-square w-full object-cover opacity-70 grayscale"
                />
              ) : (
                <div className="flex aspect-square items-center justify-center text-6xl">
                  🌰
                </div>
              )}
            </div>
            <span className="absolute right-3 top-3 animate-pulse text-3xl" aria-hidden>
              💤
            </span>
          </div>

          <p className="text-xs text-zinc-400">{t("meet.hint")}</p>
          <button
            type="button"
            onClick={() => setPhase("awaken")}
            className="w-full rounded-full bg-violet-600 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-violet-700"
          >
            {t("meet.cta")}
          </button>
        </section>
      ) : null}


      {/* ============ Step 2 · 唤醒 ============ */}
      {phase === "awaken" && candidate ? (
        <section className="space-y-5 text-center">
          <h1 className="text-xl font-bold tracking-widest text-zinc-900 dark:text-zinc-100">
            {t("awaken.title")}
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("awaken.desc")}</p>

          <div className="relative mx-auto w-56 animate-pulse">
            <div
              className={`overflow-hidden rounded-3xl bg-gradient-to-br p-[3px] ${rarityMeta.frameClass}`}
            >
              <div className="overflow-hidden rounded-[21px] bg-white dark:bg-zinc-900">
                {candidate.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={candidate.imageUrl}
                    alt={candidate.name}
                    className="aspect-square w-full object-cover"
                  />
                ) : (
                  <div className="flex aspect-square items-center justify-center text-6xl">
                    🌰
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            <span>{candidate.name}</span>
            <span>·</span>
            <span>
              {elementMeta.emoji}{" "}
              {locale === "en" ? elementMeta.labelEn : elementMeta.labelZh}
            </span>
            <span>·</span>
            <span>
              {rarityMeta.emoji}{" "}
              {locale === "en" ? rarityMeta.labelEn : rarityMeta.labelZh}
            </span>
          </div>

          {error ? <p className="text-xs text-red-500">{error}</p> : null}
          <button
            type="button"
            onClick={handleAwaken}
            disabled={claiming}
            className="w-full rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-500 py-3 text-sm font-semibold text-white shadow-md transition hover:from-violet-700 hover:to-fuchsia-600 disabled:opacity-60"
          >
            {claiming ? t("awaken.working") : t("awaken.cta")}
          </button>
        </section>
      ) : null}

      {/* ============ Step 2 · 唤醒成功（全球唯一编号 + 卡面预览） ============ */}
      {phase === "awakened" && claim ? (
        <section className="space-y-5 text-center">
          <div className="text-4xl" aria-hidden>
            🎉
          </div>
          <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
            {t("awakened.title")}
          </h1>

          {/* 卡面预览（灵魂凭证：稀有度渐变边框 + 立绘 + 编号） */}
          <div
            className={`mx-auto w-56 rounded-3xl bg-gradient-to-br p-[3px] shadow-lg ${rarityMeta.frameClass}`}
          >
            <div className="overflow-hidden rounded-[21px] bg-white dark:bg-zinc-900">
              {claim.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={claim.imageUrl}
                  alt={claim.petName}
                  className="aspect-square w-full object-cover"
                />
              ) : (
                <div className="flex aspect-square items-center justify-center text-6xl">
                  🌰
                </div>
              )}
              <div className="space-y-1 p-3">
                <div className="flex items-center justify-between">
                  <span className="truncate text-sm font-bold text-zinc-900 dark:text-zinc-100">
                    {claim.petName}
                  </span>
                  <span className="text-xs">🌰 Lv.1</span>
                </div>
                <p className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                  {claim.certificateNo ?? t("awakened.certPending")}
                </p>
              </div>
            </div>
          </div>

          {claim.certificateNo ? (
            <div className="space-y-1">
              <p className="text-[11px] uppercase tracking-widest text-zinc-400">
                {t("awakened.certLabel")}
              </p>
              <p className="font-mono text-lg font-bold text-violet-600 dark:text-violet-300">
                {claim.certificateNo}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {t("awakened.certHint")}
              </p>
            </div>
          ) : (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {t("awakened.certPendingHint")}
            </p>
          )}

          <button
            type="button"
            onClick={() => setPhase("journey")}
            className="w-full rounded-full bg-violet-600 py-3 text-sm font-semibold text-white transition hover:bg-violet-700"
          >
            {t("awakened.cta")}
          </button>
        </section>
      ) : null}


      {/* ============ Step 3 · 启程 ============ */}
      {phase === "journey" && claim ? (
        <section className="space-y-5">
          <div className="text-center">
            <h1 className="text-xl font-bold tracking-widest text-zinc-900 dark:text-zinc-100">
              {t("journey.title")}
            </h1>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="onboarding-pet-name"
              className="block text-center text-sm font-semibold text-zinc-700 dark:text-zinc-300"
            >
              {t("journey.nameLabel")}
            </label>
            <input
              id="onboarding-pet-name"
              type="text"
              value={name}
              maxLength={24}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("journey.namePlaceholder")}
              className="w-full rounded-full border border-zinc-300 bg-white px-4 py-2.5 text-center text-sm outline-none transition focus:border-violet-500 dark:border-zinc-700 dark:bg-zinc-900"
            />
            {nameError ? (
              <p className="text-center text-xs text-red-500">{nameError}</p>
            ) : null}
          </div>

          <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
            {t("journey.choiceHint", { name: name.trim() || claim.petName })}
          </p>

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => finalize("chat")}
              disabled={pending}
              className="rounded-2xl border border-violet-200 bg-violet-50 py-4 text-sm font-semibold text-violet-700 transition hover:bg-violet-100 disabled:opacity-60 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300"
            >
              {t("journey.chatCta")}
            </button>
            <button
              type="button"
              onClick={() => finalize("explore")}
              disabled={pending}
              className="rounded-2xl border border-emerald-200 bg-emerald-50 py-4 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
            >
              {t("journey.exploreCta")}
            </button>
          </div>

          <p className="text-center">
            <Link
              href="/"
              className="text-xs text-zinc-400 underline-offset-2 transition hover:text-zinc-600 hover:underline dark:hover:text-zinc-300"
            >
              {t("journey.later")}
            </Link>
          </p>
        </section>
      ) : null}
    </div>
  );
}

