"use client";

/**
 * 新手引导「唤醒仪式」五步流程（P1 故事外显 + Phase 2 新手引导优化）：
 *  Step 1 遇见：至多 3 只沉睡灵宠视觉化卡片（图片/稀有度/元素/栖息地），点击选择；
 *  Step 2 唤醒：确认唤醒（POST /api/pets/claim 领养 + 自动生成灵魂凭证）→
 *    展示全球唯一编号（AIBI-000456）+ 卡面预览；
 *  Step 3 起名：输入名字或「✨ AI 建议名」（/api/onboarding/name-suggestions，
 *    LLM 失败自动降级本地预设池，流程永不被 AI 故障阻断）；
 *  Step 4 启程：「第一次对话」（预设话题引导）或「第一次探索」（奖励预览：
 *    积分 / 随机道具 / 限定明信片）二选一；
 *  Step 5 完成：POST /api/onboarding 标记完成并首次发放 +10 积分 →
 *    奖励展示 → 跳转所选目的地。
 *
 * 叙事约束（P0 概念收敛；违禁词清单由 tests/onboarding.test.mjs 全文扫描锁定）：
 * 流程文案统一使用「唤醒 / 生成凭证 / 全球唯一编号」。
 *
 * 埋点（各步骤完成率）：进入每一步触发 GA gtag('event','onboarding_step') 与
 * 百度 _hmt.push(['_trackEvent',...])；统计脚本未加载时静默跳过。
 *
 * 登录门槛与 explore-v2 同策略：登录态只存 localStorage aiabw_token（客户端判定），
 * 无 token / 401 → 引导登录后回跳 /onboarding；已完成或已有灵宠 → 直达首页（可跳过引导）。
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

type Phase =
  | "loading"
  | "meet"
  | "awaken"
  | "awakened"
  | "naming"
  | "journey"
  | "reward"
  | "empty";

function bearerHeaders(): HeadersInit {
  const token = localStorage.getItem("aiabw_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * 步骤埋点（漏斗分析各步骤完成率）：
 * GA gtag + 百度 _hmt 双通道，统计脚本未加载（隐私插件/离线）时静默跳过。
 */
function trackStep(step: number) {
  if (typeof window === "undefined") return;
  const w = window as unknown as {
    gtag?: (...args: unknown[]) => void;
    _hmt?: { push: (args: unknown[]) => void };
  };
  try {
    w.gtag?.("event", "onboarding_step", { step });
    w._hmt?.push(["_trackEvent", "onboarding", "step", String(step)]);
  } catch {
    /* 统计脚本异常不影响流程 */
  }
}

export function OnboardingWizard() {
  const t = useTranslations("onboarding");
  const locale = useLocale();
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("loading");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedPetId, setSelectedPetId] = useState<string | null>(null);
  const [claim, setClaim] = useState<ClaimState | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState("");
  const [pending, setPending] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestFallback, setSuggestFallback] = useState(false);
  // undefined=奖励请求失败（不展示积分条）；null=已领取过；对象=本次新发放
  const [reward, setReward] = useState<{ points: number } | null | undefined>(
    undefined,
  );
  const [dest, setDest] = useState<"chat" | "explore" | null>(null);

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
        candidates?: Candidate[];
      };
      if (!data?.ok) throw new Error("status failed");
      // 已完成引导或已持有灵宠（老用户）→ 不进入仪式，直达首页
      if (data.completed || data.hasPet) {
        router.replace("/");
        return;
      }
      const list = Array.isArray(data.candidates) ? data.candidates : [];
      if (list.length === 0) {
        setPhase("empty");
        return;
      }
      setCandidates(list);
      setSelectedPetId((prev) =>
        prev && list.some((c) => c.petId === prev) ? prev : null,
      );
      setPhase("meet");
    } catch {
      setError(t("loadFailed"));
      setPhase("empty");
    }
  }, [router, t]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const stepNo =
    phase === "meet"
      ? 1
      : phase === "awaken" || phase === "awakened"
        ? 2
        : phase === "naming"
          ? 3
          : phase === "journey"
            ? 4
            : phase === "reward"
              ? 5
              : 0;

  // 埋点：进入流程内每一步上报一次（漏斗：step1 遇见 → step5 完成）
  useEffect(() => {
    if (stepNo > 0) trackStep(stepNo);
  }, [stepNo]);

  const selectedCandidate =
    candidates.find((c) => c.petId === selectedPetId) ?? null;

  /** Step 1→2：选中心仪灵宠后唤醒（领养 + 自动生成灵魂凭证，复用 P0 claim 链路） */
  async function handleAwaken() {
    if (claiming || !selectedCandidate) return;
    const target = selectedCandidate;
    setClaiming(true);
    setError("");
    setNotice("");
    setPhase("awaken");
    try {
      const res = await fetch("/api/pets/claim", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-locale": locale,
          ...bearerHeaders(),
        },
        body: JSON.stringify({ petId: target.petId }),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 410) {
        // 这只灵宠刚被别人抢先唤醒 → 重新寻找一批，回到 Step 1
        setNotice(t("awaken.gone"));
        setCandidates([]);
        setSelectedPetId(null);
        setPhase("loading");
        void bootstrap();
        return;
      }
      if (!res.ok || !data?.ok || !data.adoption) {
        setError(data?.error ?? t("awaken.failed"));
        setPhase("meet");
        return;
      }
      setClaim({
        adoptionId: String(data.adoption.id),
        threadId: data.threadId ? String(data.threadId) : null,
        petId: String(data.pet.id),
        petName: String(data.adoption.petName ?? data.pet.speciesName),
        imageUrl: data.pet.imageUrl ? String(data.pet.imageUrl) : target.imageUrl,
        certificateNo: data.soulCard?.certificateNo
          ? String(data.soulCard.certificateNo)
          : null,
        rarity: String(data.soulCard?.rarity ?? target.rarity),
        element: data.soulCard?.element ?? target.element,
      });
      setName(String(data.pet.speciesName ?? data.adoption.petName ?? ""));
      setPhase("awakened");
    } catch {
      setError(t("awaken.failed"));
      setPhase("meet");
    } finally {
      setClaiming(false);
    }
  }

  /** Step 3：AI 建议名（LLM 失败/格式异常 → 服务端已降级预设池，此处仅切换提示文案） */
  async function handleSuggest() {
    if (suggesting) return;
    setSuggesting(true);
    setSuggestFallback(false);
    try {
      const res = await fetch("/api/onboarding/name-suggestions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-locale": locale,
          ...bearerHeaders(),
        },
        body: JSON.stringify({
          speciesName: claim?.petName ?? selectedCandidate?.name ?? "",
          category: selectedCandidate?.category ?? "",
          element: claim?.element ?? selectedCandidate?.element ?? "",
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok && Array.isArray(data.names) && data.names.length) {
        setSuggestions(data.names.slice(0, 3).map((n: unknown) => String(n)));
        setSuggestFallback(data.source === "fallback");
      } else {
        setSuggestFallback(true);
      }
    } catch {
      setSuggestFallback(true);
    } finally {
      setSuggesting(false);
    }
  }

  /** Step 3：提交灵宠名（幂等；返回是否成功，供 CTA 串联）。 */
  async function submitName(): Promise<boolean> {
    const n = name.trim();
    if (!claim) return false;
    if (n.length < 1 || n.length > 24) {
      setNameError(t("naming.nameInvalid"));
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
        setNameError(data?.error ?? t("naming.nameInvalid"));
        return false;
      }
      return true;
    } catch {
      setNameError(t("naming.nameInvalid"));
      return false;
    }
  }

  /** Step 4 终点：起名 → 标记完成（首次完成发放 +10 积分）→ Step 5 奖励展示。 */
  async function finalize(d: "chat" | "explore") {
    if (pending || !claim) return;
    setPending(true);
    try {
      const named = await submitName();
      if (!named) {
        setPhase("naming");
        return;
      }
      setDest(d);
      try {
        const res = await fetch("/api/onboarding", {
          method: "POST",
          headers: bearerHeaders(),
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data?.ok) {
          setReward(
            typeof data.reward?.points === "number"
              ? { points: data.reward.points }
              : null,
          );
        } else {
          setReward(undefined);
        }
      } catch {
        // 完成标记失败不阻断流程（banner 会继续提示，下次可自然完成）
        setReward(undefined);
      }
      setPhase("reward");
    } finally {
      setPending(false);
    }
  }

  /** Step 5：奖励展示后跳转所选目的地。 */
  function goDest() {
    if (!claim || !dest) return;
    router.push(
      dest === "chat"
        ? `/chat?thread=${claim.threadId}&adopt=${claim.adoptionId}`
        : "/explore-v2",
    );
  }

  const rarity = normalizeRarity(claim?.rarity ?? selectedCandidate?.rarity);
  const rarityMeta = RARITY_META[rarity];
  const element = normalizeElement(claim?.element ?? selectedCandidate?.element);
  const elementMeta = ELEMENT_META[element];

  return (
    <div className="space-y-6">
      {/* 步骤指示器（仅流程内展示） */}
      {stepNo > 0 ? (
        <div
          className="flex items-center justify-center gap-2"
          aria-label={t("stepOf", { step: stepNo })}
        >
          {[1, 2, 3, 4, 5].map((s) => (
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

      {/* ============ Step 1 · 遇见（视觉化物种卡片选择） ============ */}
      {phase === "meet" ? (
        <section className="space-y-5 text-center">
          <h1 className="text-xl font-bold tracking-widest text-zinc-900 dark:text-zinc-100">
            {t("meet.title")}
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("meet.desc")}</p>

          <div className="grid grid-cols-3 gap-3">
            {candidates.map((c, idx) => {
              const selected = c.petId === selectedPetId;
              const cm = RARITY_META[normalizeRarity(c.rarity)];
              const ce = c.element
                ? ELEMENT_META[normalizeElement(c.element)]
                : null;
              return (
                <div
                  key={c.petId}
                  className="animate-[ob-card-in_0.45s_ease_both]"
                  style={{ animationDelay: `${idx * 90}ms` }}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedPetId(c.petId)}
                    aria-pressed={selected}
                    className={`relative w-full overflow-hidden rounded-2xl border p-2 text-left transition ${
                      selected
                        ? "border-violet-500 ring-2 ring-violet-400 animate-[ob-card-glow_2s_ease-in-out_infinite] dark:border-violet-400"
                        : "border-zinc-200 hover:border-violet-300 dark:border-zinc-700 dark:hover:border-violet-600"
                    }`}
                  >
                    <div className="relative overflow-hidden rounded-xl bg-zinc-100 dark:bg-zinc-800">
                      {c.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={c.imageUrl}
                          alt={c.name}
                          className={`aspect-square w-full object-cover transition ${
                            selected ? "" : "opacity-80 grayscale"
                          }`}
                        />
                      ) : (
                        <div className="flex aspect-square items-center justify-center text-5xl">
                          🌰
                        </div>
                      )}
                      <span
                        className="absolute right-1.5 top-1.5 animate-pulse text-xl"
                        aria-hidden
                      >
                        💤
                      </span>
                    </div>
                    <p className="mt-2 truncate text-xs font-bold text-zinc-900 dark:text-zinc-100">
                      {c.name}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-zinc-500 dark:text-zinc-400">
                      <span>
                        {cm.emoji} {locale === "en" ? cm.labelEn : cm.labelZh}
                      </span>
                      {ce ? (
                        <span>
                          {ce.emoji} {locale === "en" ? ce.labelEn : ce.labelZh}
                        </span>
                      ) : null}
                    </div>
                    {c.habitat ? (
                      <p className="mt-0.5 truncate text-[10px] text-zinc-400">
                        📍 {c.habitat}
                      </p>
                    ) : null}
                  </button>
                </div>
              );
            })}
          </div>

          <p className="text-xs text-zinc-400">{t("meet.pickHint")}</p>
          <p className="text-xs text-zinc-400">{t("meet.hint")}</p>
          {error ? <p className="text-xs text-red-500">{error}</p> : null}
          <button
            type="button"
            onClick={handleAwaken}
            disabled={!selectedCandidate || claiming}
            className="w-full rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-500 py-3 text-sm font-semibold text-white shadow-md transition hover:from-violet-700 hover:to-fuchsia-600 disabled:opacity-60"
          >
            {claiming ? t("awaken.working") : t("meet.cta")}
          </button>
        </section>
      ) : null}


      {/* ============ Step 2 · 唤醒（过渡态：claim 请求进行中） ============ */}
      {phase === "awaken" && selectedCandidate ? (
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
                {selectedCandidate.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={selectedCandidate.imageUrl}
                    alt={selectedCandidate.name}
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
            <span>{selectedCandidate.name}</span>
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

          <p className="text-sm text-violet-500 dark:text-violet-300">
            {t("awaken.working")}
          </p>
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

          {/* 卡面预览（灵魂凭证：稀有度渐变边框 + 立绘 + 编号；born-pop 诞生动画） */}
          <div
            className={`mx-auto w-56 rounded-3xl bg-gradient-to-br p-[3px] shadow-lg animate-[born-pop_0.6s_ease_both] ${rarityMeta.frameClass}`}
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
            onClick={() => setPhase("naming")}
            className="w-full rounded-full bg-violet-600 py-3 text-sm font-semibold text-white transition hover:bg-violet-700"
          >
            {t("awakened.cta")}
          </button>
        </section>
      ) : null}


      {/* ============ Step 3 · 起名（输入 + AI 建议名） ============ */}
      {phase === "naming" && claim ? (
        <section className="space-y-5">
          <div className="text-center">
            <h1 className="text-xl font-bold tracking-widest text-zinc-900 dark:text-zinc-100">
              {t("naming.title")}
            </h1>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="onboarding-pet-name"
              className="block text-center text-sm font-semibold text-zinc-700 dark:text-zinc-300"
            >
              {t("naming.nameLabel")}
            </label>
            <input
              id="onboarding-pet-name"
              type="text"
              value={name}
              maxLength={24}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("naming.namePlaceholder")}
              className="w-full rounded-full border border-zinc-300 bg-white px-4 py-2.5 text-center text-sm outline-none transition focus:border-violet-500 dark:border-zinc-700 dark:bg-zinc-900"
            />
            {nameError ? (
              <p className="text-center text-xs text-red-500">{nameError}</p>
            ) : null}
          </div>

          <div className="space-y-2 text-center">
            <button
              type="button"
              onClick={handleSuggest}
              disabled={suggesting}
              className="rounded-full border border-violet-300 bg-violet-50 px-4 py-2 text-xs font-semibold text-violet-700 transition hover:bg-violet-100 disabled:opacity-60 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
            >
              {suggesting ? t("naming.aiWorking") : t("naming.aiCta")}
            </button>
            {suggestFallback ? (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                {t("naming.aiFailed")}
              </p>
            ) : null}
            {suggestions.length > 0 ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-center gap-2">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setName(s);
                        setNameError("");
                      }}
                      className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 transition hover:border-violet-400 hover:text-violet-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-violet-500 dark:hover:text-violet-300"
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-zinc-400">
                  {t("naming.suggestionHint")}
                </p>
              </div>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => {
              const n = name.trim();
              if (n.length < 1 || n.length > 24) {
                setNameError(t("naming.nameInvalid"));
                return;
              }
              setNameError("");
              setPhase("journey");
            }}
            className="w-full rounded-full bg-violet-600 py-3 text-sm font-semibold text-white transition hover:bg-violet-700"
          >
            {t("naming.cta")}
          </button>
        </section>
      ) : null}

      {/* ============ Step 4 · 启程（首次体验二选一：预设话题对话 / 探索奖励预览） ============ */}
      {phase === "journey" && claim ? (
        <section className="space-y-5">
          <div className="text-center">
            <h1 className="text-xl font-bold tracking-widest text-zinc-900 dark:text-zinc-100">
              {t("journey.title")}
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {t("journey.choiceHint", { name: name.trim() || claim.petName })}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
            {/* 第一次对话：预设话题引导 */}
            <button
              type="button"
              onClick={() => finalize("chat")}
              disabled={pending}
              className="space-y-2 rounded-2xl border border-violet-200 bg-violet-50 p-4 text-left transition hover:bg-violet-100 disabled:opacity-60 dark:border-violet-800 dark:bg-violet-950/40"
            >
              <p className="text-sm font-semibold text-violet-700 dark:text-violet-300">
                {t("journey.chatCta")}
              </p>
              <p className="text-[11px] text-violet-500 dark:text-violet-400">
                {t("journey.chatDesc")}
              </p>
              <div className="space-y-1">
                <p className="w-fit rounded-full bg-white px-2.5 py-1 text-[11px] text-zinc-600 shadow-sm dark:bg-zinc-900 dark:text-zinc-300">
                  {t("journey.topic1")}
                </p>
                <p className="w-fit rounded-full bg-white px-2.5 py-1 text-[11px] text-zinc-600 shadow-sm dark:bg-zinc-900 dark:text-zinc-300">
                  {t("journey.topic2")}
                </p>
              </div>
            </button>

            {/* 第一次探索：奖励预览 */}
            <button
              type="button"
              onClick={() => finalize("explore")}
              disabled={pending}
              className="space-y-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-left transition hover:bg-emerald-100 disabled:opacity-60 dark:border-emerald-800 dark:bg-emerald-950/40"
            >
              <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                {t("journey.exploreCta")}
              </p>
              <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
                {t("journey.exploreDesc")}
              </p>
              <div className="rounded-xl bg-white/70 p-2.5 dark:bg-zinc-900/60">
                <p className="text-[10px] uppercase tracking-wide text-zinc-400">
                  {t("journey.rewardsTitle")}
                </p>
                <ul className="mt-1 space-y-0.5 text-[11px] text-zinc-600 dark:text-zinc-300">
                  <li>{t("journey.rewardPoints")}</li>
                  <li>{t("journey.rewardItem")}</li>
                  <li>{t("journey.rewardPostcard")}</li>
                </ul>
              </div>
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

      {/* ============ Step 5 · 完成（引导奖励展示） ============ */}
      {phase === "reward" && claim ? (
        <section className="space-y-5 py-6 text-center">
          <div className="text-5xl" aria-hidden>
            🎉
          </div>
          <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
            {t("reward.title")}
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {t("reward.desc", { name: name.trim() || claim.petName })}
          </p>

          {reward ? (
            <div className="mx-auto w-fit animate-[ob-reward-pop_0.5s_ease_both] rounded-2xl border border-amber-200 bg-amber-50 px-6 py-4 dark:border-amber-800 dark:bg-amber-950/40">
              <p className="text-lg font-bold text-amber-600 dark:text-amber-300">
                {t("reward.pointsLabel", { points: reward.points })}
              </p>
            </div>
          ) : reward === null ? (
            <p className="text-xs text-zinc-400">{t("reward.noReward")}</p>
          ) : null}

          <button
            type="button"
            onClick={goDest}
            className="w-full rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-500 py-3 text-sm font-semibold text-white shadow-md transition hover:from-violet-700 hover:to-fuchsia-600"
          >
            {t("reward.cta")}
          </button>
        </section>
      ) : null}
    </div>
  );
}

