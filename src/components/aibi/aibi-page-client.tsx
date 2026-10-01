"use client";

/**
 * AibiPageClient · 艾比详情页舞台（Phase 9 · AibiStagePage，公开可读）
 *  - 数据源：GET /api/aibi/token/[tokenId]（复用 Phase 7 接口；带 Bearer 时返回 viewerIsOwner）；
 *  - 舞台布局（桌面三栏，移动端自动降级单列上下堆叠）：
 *      左 形象大卡（AibiCard lg · 复用 Phase 8 五档动效 + 悬停信息浮层）
 *      中 详细信息面板（名称/稀有度/元素/栖息地/凭证编号/等级/亲密度/经验条/状态标签）
 *      右 链上信息面板（持有者/铸造时间/销毁记录/流转轨迹）
 *  - 底部互动区：互动记录时间线（aibi_growth_logs 最新 20 条，公开只读）+
 *    四动作 feed/train/talk/play → POST /api/interact { tokenId, action }（复用 Phase 4/5 接口）；
 *    响应 state 就地刷新卡面/面板/时间线，leveledUp 弹升级提示；
 *  - 非持有者模式：隐藏互动按钮，整页只读。
 */
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { AibiCard } from "./aibi-card";
import { AibiErrorBanner } from "./aibi-error-banner";
import { aibiFetch, AibiClientError } from "@/lib/aibi-client";
import { getAibiHabitat } from "@/lib/aibi-catalog";
import { EXP_PER_LEVEL, INTERACT_RULES } from "@/lib/aibi-service";
import {
  aibiCertDisplay,
  aibiElementLabel,
  rarityVisual,
  type AibiTokenDto,
} from "@/lib/aibi-visual";

type InteractAction = "feed" | "train" | "talk" | "play";

interface ProvenanceRow {
  kind: "mint" | "burn";
  source: string | null;
  reason: string | null;
  chainTxHash: string | null;
  blockNumber: string | null;
  supplyAfter: number;
  createdAt: string;
}

/** 互动时间线行（Phase 9 · readTokenDetail.interactions） */
interface InteractionRow {
  action: string;
  mood: string | null;
  growthLevel: number | null;
  createdAt: string;
}

/** 互动后实时状态（与 /api/interact 响应 state 同构） */
interface GrowthLive {
  personalityType: string;
  mood: string;
  affinity: number;
  energy: number;
  growthLevel: number;
  growthExp: number;
}

interface TokenDetailDto {
  aibiTokenId: string;
  speciesId: string;
  status: string;
  walletAddress: string | null;
  chainId: string | null;
  contractAddress: string | null;
  txHash: string | null;
  physicalBound: boolean;
  mintedAt: string | null;
  burnedAt: string | null;
  burnReason: string | null;
  createdAt: string;
  personalityType: string | null;
  mood: string | null;
  affinity: number | null;
  energy: number | null;
  growthLevel: number | null;
  growthExp: number | null;
  lastInteractedAt: string | null;
  ownerDisplay: string | null;
  provenance: ProvenanceRow[];
  interactions: InteractionRow[];
  species: AibiTokenDto["species"];
  viewerIsOwner: boolean;
}

const ACTIONS: { id: InteractAction; emoji: string }[] = [
  { id: "feed", emoji: "🍎" },
  { id: "train", emoji: "🏋️" },
  { id: "talk", emoji: "💬" },
  { id: "play", emoji: "🎾" },
];

/** 时间线动作 emoji（含道具使用落库的 evolve 等非四动作类型） */
const ACTION_EMOJI: Record<string, string> = {
  feed: "🍎",
  train: "🏋️",
  talk: "💬",
  play: "🎾",
  evolve: "✨",
};

/** 中栏状态标签 pill 配色 */
const STATUS_CLASS: Record<string, string> = {
  minted: "bg-emerald-500",
  pending: "bg-amber-400",
  burned: "bg-red-400",
  revoked: "bg-zinc-400",
};

export function AibiPageClient({ tokenId }: { tokenId: string }) {
  const t = useTranslations("aibi.tokenPage");
  const ti = useTranslations("aibi.interact");
  const locale = useLocale();
  const isEn = locale === "en";
  const [detail, setDetail] = useState<TokenDetailDto | null>(null);
  const [live, setLive] = useState<GrowthLive | null>(null);
  const [timeline, setTimeline] = useState<InteractionRow[]>([]);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<InteractAction | null>(null);
  const [levelUp, setLevelUp] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    aibiFetch<TokenDetailDto>(`/api/aibi/token/${encodeURIComponent(tokenId)}`, { locale })
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        setLive({
          personalityType: d.personalityType ?? "",
          mood: d.mood ?? "",
          affinity: d.affinity ?? 0,
          energy: d.energy ?? 0,
          growthLevel: d.growthLevel ?? 1,
          growthExp: d.growthExp ?? 0,
        });
        setTimeline(d.interactions ?? []);
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof AibiClientError) setError({ code: e.code, message: e.message });
        else setError({ message: t("loadFailed") });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tokenId, locale, t]);

  /** 互动四动作（仅持有者渲染入口）：响应 state 就地刷新 + 时间线头插一条 */
  async function doInteract(action: InteractAction) {
    if (!detail) return;
    setPending(action);
    setError(null);
    try {
      const res = await aibiFetch<{ state: GrowthLive; leveledUp: boolean }>("/api/interact", {
        method: "POST",
        body: { tokenId: detail.aibiTokenId, action },
        locale,
      });
      setLive(res.state);
      setTimeline((prev) =>
        [
          {
            action,
            mood: res.state.mood,
            growthLevel: res.state.growthLevel,
            createdAt: new Date().toISOString(),
          },
          ...prev,
        ].slice(0, 20),
      );
      if (res.leveledUp) {
        setLevelUp(true);
        setTimeout(() => setLevelUp(false), 1800);
      }
    } catch (e) {
      if (e instanceof AibiClientError) setError({ code: e.code, message: e.message });
      else setError({ message: ti("failed") });
    } finally {
      setPending(null);
    }
  }

  if (loading) {
    return <p className="py-16 text-center text-sm text-zinc-400">…</p>;
  }
  if (!detail || !live) {
    return (
      <div className="mx-auto max-w-md py-10">
        <AibiErrorBanner
          code={error?.code}
          message={error?.message ?? t("notFound")}
        />
      </div>
    );
  }

  const sp = detail.species;
  const rv = rarityVisual(sp?.rarityId ?? "common");
  const name = sp ? (isEn ? sp.nameEn : sp.nameZh) : detail.speciesId;
  const rarityName = rv.rarity ? (isEn ? rv.rarity.nameEn : rv.rarity.nameZh) : rv.id;
  const habitat = sp ? getAibiHabitat(sp.habitatId) : undefined;
  const habitatName = habitat ? (isEn ? habitat.nameEn : habitat.nameZh) : "—";
  const elementName = sp ? aibiElementLabel(sp.element, locale) : "—";
  const personality =
    live.personalityType || (sp ? (isEn ? sp.personalityTemplateEn : sp.personalityTemplate) : "—");
  const fmtTime = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(isEn ? "en-US" : "zh-CN", { hour12: false }) : "—";
  const statusKnown = ["minted", "pending", "burned", "revoked"].includes(detail.status);
  const statusText = statusKnown ? t(`statuses.${detail.status}`) : detail.status;
  /** 时间线动作文案：四动作走 i18n，其余（如道具 evolve）原样展示 action_type */
  const actionLabel = (action: string) =>
    ACTIONS.some((a) => a.id === action) ? ti(`actions.${action}`) : action;

  const cardToken: AibiTokenDto = {
    aibiTokenId: detail.aibiTokenId,
    speciesId: detail.speciesId,
    status: detail.status,
    physicalBound: detail.physicalBound,
    createdAt: detail.createdAt,
    personalityType: live.personalityType || null,
    mood: live.mood || null,
    affinity: live.affinity,
    energy: live.energy,
    growthLevel: live.growthLevel,
    growthExp: live.growthExp,
    species: detail.species,
  };
  const expPct = Math.max(0, Math.min(100, Math.round((live.growthExp / EXP_PER_LEVEL) * 100)));

  return (
    <div className="space-y-4">
      {/* 舞台区：桌面三栏 / 移动端单列堆叠降级 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,0.9fr)]">
        {/* 左：形象舞台（AibiCard 五档动效大卡 + 稀有度氛围光） */}
        <section
          className="relative overflow-hidden rounded-3xl border border-zinc-200 bg-gradient-to-b from-zinc-50 to-white p-4 dark:border-zinc-700 dark:from-zinc-900 dark:to-zinc-950"
          style={{ boxShadow: `inset 0 0 64px ${rv.color}26` }}
        >
          {levelUp ? (
            <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2 animate-bounce rounded-full bg-gradient-to-r from-amber-400 to-orange-500 px-4 py-1.5 text-xs font-bold text-white shadow-lg">
              🎉 {ti("levelUp", { level: live.growthLevel })}
            </div>
          ) : null}
          <AibiCard token={cardToken} locale={locale} size="lg" hoverInfo />
          <div className="mt-3 text-center">
            <h1 className="text-xl font-black text-zinc-900 dark:text-zinc-50">
              {rv.emoji} {name}
            </h1>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {rarityName} · {elementName} · {habitatName}
            </p>
            {live.mood ? (
              <p className="mt-1 text-[11px] text-zinc-400">
                {t("mood")}：{live.mood}
              </p>
            ) : null}
          </div>
        </section>

        {/* 中：详细信息面板（名称/稀有度/元素/栖息地/凭证编号/状态 + 成长条） */}
        <section className="rounded-3xl border border-zinc-200 p-4 dark:border-zinc-700">
          <h2 className="text-sm font-bold text-zinc-800 dark:text-zinc-100">
            🧬 {t("infoTitle")}
          </h2>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <InfoCell label={t("name")} value={name} />
            <InfoCell label={t("cert")} value={aibiCertDisplay(detail.aibiTokenId)} mono />
            <div className="rounded-xl bg-zinc-50 px-3 py-2 dark:bg-zinc-800/60">
              <p className="text-[10px] text-zinc-400">{t("statusLabel")}</p>
              <p className="mt-1">
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold text-white ${
                    STATUS_CLASS[detail.status] ?? "bg-zinc-400"
                  }`}
                >
                  {statusText}
                </span>
              </p>
            </div>
            <InfoCell label={t("rarity")} value={`${rv.emoji} ${rarityName}`} />
            <InfoCell label={t("element")} value={elementName} />
            <InfoCell label={t("habitat")} value={habitatName} />
            <div className="col-span-2">
              <InfoCell label={t("personality")} value={personality} />
            </div>
          </div>

          {/* 成长状态：等级 + 经验条 + 亲密度 + 精力（互动后实时刷新） */}
          <h3 className="mt-4 text-xs font-bold text-zinc-500 dark:text-zinc-400">
            📈 {t("growthTitle")}
          </h3>
          <div className="mt-2 space-y-2.5">
            <div>
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-zinc-700 dark:text-zinc-200">
                  {t("level")} Lv.{live.growthLevel}
                </span>
                <span className="text-zinc-400">
                  {live.growthExp}/{EXP_PER_LEVEL} {t("exp")}
                </span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all"
                  style={{ width: `${expPct}%` }}
                />
              </div>
            </div>
            <MeterBar label={t("affinity")} value={live.affinity} emoji="💗" barClass="from-pink-400 to-rose-500" />
            <MeterBar label={t("energy")} value={live.energy} emoji="⚡" barClass="from-sky-400 to-cyan-500" />
            <p className="text-[10px] text-zinc-400">
              {t("lastInteractedAt")}：{fmtTime(detail.lastInteractedAt)}
            </p>
          </div>

          {sp ? (
            <p className="mt-3 border-t border-zinc-100 pt-3 text-xs leading-relaxed text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              {isEn ? sp.descriptionEn : sp.description}
            </p>
          ) : null}
        </section>

        {/* 右：链上信息面板（持有者/铸造时间/销毁记录/流转轨迹） */}
        <section className="rounded-3xl border border-zinc-200 p-4 dark:border-zinc-700">
          <h2 className="text-sm font-bold text-zinc-800 dark:text-zinc-100">
            ⛓️ {t("chainTitle")}
          </h2>
          <div className="mt-3 space-y-2 text-xs">
            <InfoCell label={t("owner")} value={detail.ownerDisplay ?? "—"} mono />
            <InfoCell label={t("mintedAt")} value={fmtTime(detail.mintedAt)} />
            {detail.burnedAt ? (
              <InfoCell
                label={t("eventBurn")}
                value={`${fmtTime(detail.burnedAt)}${detail.burnReason ? ` · ${detail.burnReason}` : ""}`}
              />
            ) : null}
            <InfoCell label={t("txHash")} value={detail.txHash ?? "—"} mono />
            <InfoCell
              label={t("contract")}
              value={detail.contractAddress ?? t("contractMock")}
              mono={!!detail.contractAddress}
            />
            <InfoCell label={t("chainId")} value={detail.chainId ?? "—"} mono />
            <InfoCell label={t("wallet")} value={detail.walletAddress ?? "—"} mono={!!detail.walletAddress} />
            <InfoCell
              label={t("physicalBound")}
              value={detail.physicalBound ? t("bound") : t("unbound")}
            />
          </div>

          {/* 流转轨迹：mint/burn 全履历（时间升序） */}
          <h3 className="mt-4 text-xs font-bold text-zinc-500 dark:text-zinc-400">
            📜 {t("historyTitle")}
          </h3>
          <ul className="mt-2 space-y-1.5">
            {detail.provenance.map((p, i) => (
              <li
                key={i}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-zinc-50 px-2.5 py-1.5 text-[11px] dark:bg-zinc-800/60"
              >
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white ${
                    p.kind === "mint" ? "bg-emerald-500" : "bg-red-400"
                  }`}
                >
                  {p.kind === "mint" ? t("eventMint") : t("eventBurn")}
                </span>
                <span className="text-zinc-500 dark:text-zinc-400">{p.source ?? p.reason ?? "—"}</span>
                <span className="ml-auto font-mono text-[10px] text-zinc-400">
                  {fmtTime(p.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* 底部：互动区（时间线公开只读；动作按钮仅持有者渲染） */}
      <section className="rounded-3xl border border-zinc-200 p-4 dark:border-zinc-700">
        <h2 className="text-sm font-bold text-zinc-800 dark:text-zinc-100">
          🎮 {t("interactTitle")}
        </h2>

        {detail.viewerIsOwner ? (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {ACTIONS.map((a) => {
                const rule = INTERACT_RULES[a.id];
                const disabled =
                  pending !== null || detail.status !== "minted" || live.energy < rule.minEnergy;
                return (
                  <button
                    key={a.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => void doInteract(a.id)}
                    className="flex flex-col items-center gap-0.5 rounded-2xl border border-zinc-200 py-2.5 text-xs font-semibold text-zinc-700 transition hover:border-orange-300 hover:bg-orange-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    <span className="text-lg">{a.emoji}</span>
                    <span>{pending === a.id ? ti("doing") : ti(`actions.${a.id}`)}</span>
                    <span className="text-[10px] font-normal text-zinc-400">
                      +{rule.exp} {t("exp")} · {rule.energy > 0 ? "+" : ""}
                      {rule.energy} {t("energy")}
                    </span>
                  </button>
                );
              })}
            </div>
            {error ? (
              <div className="mt-3">
                <AibiErrorBanner code={error.code} message={error.message} onClose={() => setError(null)} />
              </div>
            ) : null}
          </>
        ) : (
          <p className="mt-3 rounded-xl bg-zinc-50 px-3 py-2 text-center text-[11px] text-zinc-400 dark:bg-zinc-800/60">
            {t("ownerOnlyHint")}
          </p>
        )}

        {/* 互动记录时间线（最新在前，公开只读；互动后头插实时更新） */}
        {timeline.length ? (
          <ul className="mt-4 space-y-1.5">
            {timeline.map((it, i) => (
              <li
                key={`${it.createdAt}-${i}`}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-zinc-50 px-3 py-1.5 text-[11px] dark:bg-zinc-800/60"
              >
                <span>{ACTION_EMOJI[it.action] ?? "🫧"}</span>
                <span className="font-semibold text-zinc-700 dark:text-zinc-200">
                  {actionLabel(it.action)}
                </span>
                {it.mood ? (
                  <span className="text-zinc-400">
                    {t("mood")}→{it.mood}
                  </span>
                ) : null}
                {it.growthLevel ? <span className="text-zinc-400">Lv.{it.growthLevel}</span> : null}
                <span className="ml-auto font-mono text-[10px] text-zinc-400">
                  {fmtTime(it.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-center text-[11px] text-zinc-400">{t("interactEmpty")}</p>
        )}
      </section>
    </div>
  );
}

function InfoCell({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl bg-zinc-50 px-3 py-2 dark:bg-zinc-800/60">
      <p className="text-[10px] text-zinc-400">{label}</p>
      <p
        className={`mt-0.5 truncate font-semibold text-zinc-800 dark:text-zinc-100 ${
          mono ? "font-mono text-[11px]" : ""
        }`}
        title={value}
      >
        {value}
      </p>
    </div>
  );
}

/** 成长条（亲密度/精力共用）：0-100 计量，互动后随 live state 实时刷新 */
function MeterBar({
  label,
  value,
  emoji,
  barClass,
}: {
  label: string;
  value: number;
  emoji: string;
  barClass: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-zinc-500 dark:text-zinc-400">
          {emoji} {label}
        </span>
        <span className="font-semibold text-zinc-700 dark:text-zinc-200">{value}/100</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div
          className={`h-full rounded-full bg-gradient-to-r transition-all ${barClass}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
