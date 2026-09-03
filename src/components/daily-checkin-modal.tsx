"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { LivingPet } from "@/components/LivingPet";
import {
  MOOD_EXPRESSIONS,
  RARITY_BADGE_CLASS,
  itemDisplayName,
  moodKeyFor,
  type CheckinItem,
  type CheckinMood,
} from "@/lib/checkin-items";

/**
 * P0-1 每日签到弹窗（全站挂载于 [locale]/layout.tsx）：
 *  - 每天首次访问弹出一次（localStorage aiabw_checkin_seen 存当天日期）；
 *  - 仅登录用户且当天未签到时弹出（已签到/游客 → 静默跳过）；
 *  - 宠物形象取第一只领养宠物（无宠物 → 通用 🦊 形象），
 *    按连签天数展示表情与台词（1 天/3 天/≥7 天三档）；
 *  - 7 天进度点：第 7 天是 🎁 盲盒节点；
 *  - 签到结果：+积分（月卡 ×2）、7 天周期开出心情盲盒道具（月卡保底稀有）。
 */
const SEEN_KEY = "aiabw_checkin_seen";

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type Status = {
  checkedToday: boolean;
  streak: number;
  nextStreak: number;
  premium: boolean;
};

type CheckinResult = {
  ok: boolean;
  already: boolean;
  pointsGain?: number;
  bonusPoints?: number;
  streak?: number;
  premium?: boolean;
  mood?: CheckinMood;
  item?: CheckinItem | null;
};

export function DailyCheckinModal() {
  const t = useTranslations("checkin");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [pet, setPet] = useState<{ name: string; avatar: string | null } | null>(null);
  const [result, setResult] = useState<CheckinResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("aiabw_token");
    if (!token) return;
    // 一天只弹一次（以本机日期为准；实际是否已签到由服务端判定）
    if (localStorage.getItem(SEEN_KEY) === todayStr()) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/user/checkin", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 401) return; // token 失效：静默跳过
        const data = await res.json();
        if (!alive || !data?.ok) return;
        if (data.checkedToday) {
          // 已签到：记录当天已看过，不再打扰
          localStorage.setItem(SEEN_KEY, todayStr());
          return;
        }
        setStatus({
          checkedToday: false,
          streak: data.streak ?? 0,
          nextStreak: data.nextStreak ?? 1,
          premium: !!data.premium,
        });
        // 宠物形象：取第一只领养宠物（失败/无宠物 → 通用形象）
        try {
          const pr = await fetch("/api/pets", { headers: { Authorization: `Bearer ${token}` } });
          const pd = await pr.json();
          if (pd?.ok && Array.isArray(pd.pets) && pd.pets.length > 0 && alive) {
            const p = pd.pets[0];
            setPet({ name: p.displayName || p.petName || "", avatar: p.avatar ?? null });
          }
        } catch {
          /* 回退默认形象 */
        }
        if (alive) setOpen(true);
      } catch {
        /* 状态拉取失败不打扰主流程，明天再弹 */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const close = useCallback(() => {
    localStorage.setItem(SEEN_KEY, todayStr());
    setOpen(false);
  }, []);

  const doCheckin = async () => {
    const token = localStorage.getItem("aiabw_token");
    if (!token || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch("/api/user/checkin", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data?.ok) setResult(data);
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  if (!open || !status) return null;

  // 展示档位：签到前预览「今天签到将达成」的天数，签到后以结果为准
  const streakForMood = result ? (result.streak ?? status.nextStreak) : status.nextStreak;
  const mood = result?.mood ?? moodKeyFor(streakForMood);
  const moodLine =
    mood === "day1" ? t("day1") : mood === "day3" ? t("day3") : mood === "day7" ? t("day7") : t("dayOther");
  // 进度点：已点亮天数（签到前 = nextStreak-1，签到后 = streak）
  const filled = result ? (result.streak ?? 0) : status.nextStreak - 1;
  const item = result?.item ?? null;
  const totalGain = (result?.pointsGain ?? 0) + (result?.bonusPoints ?? 0);
  const petName = pet?.name || t("petGeneric");

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-zinc-900/50 p-4 backdrop-blur-sm"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label={t("title")}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-orange-200 bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold text-zinc-900">{t("title")}</h2>
          {status.premium && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
              {t("premiumBadge")}
            </span>
          )}
        </div>

        {/* 宠物 + 心情台词气泡 */}
        <div className="flex items-center gap-3">
          {pet?.avatar ? (
            <LivingPet
              src={pet.avatar}
              alt={petName}
              className="h-20 w-20 rounded-2xl border border-orange-200 bg-orange-50 object-cover"
              tail={false}
            />
          ) : (
            <span
              className="flex h-20 w-20 items-center justify-center rounded-2xl border border-orange-200 bg-orange-50 text-4xl"
              aria-hidden
            >
              🦊
            </span>
          )}
          <div className="min-w-0 flex-1 rounded-2xl bg-orange-50 px-3 py-2">
            <p className="text-lg font-semibold leading-snug text-zinc-800">
              {MOOD_EXPRESSIONS[mood]} {moodLine}
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">{t("streakLabel", { days: streakForMood })}</p>
          </div>
        </div>

        {/* 7 天进度（第 7 天 = 🎁 盲盒节点） */}
        <div className="mt-4">
          <div className="flex items-center gap-1.5">
            {Array.from({ length: 7 }, (_, i) => {
              const day = i + 1;
              const done = day <= filled;
              const isGift = day === 7;
              return (
                <span
                  key={day}
                  className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs ${
                    done
                      ? "border-orange-400 bg-orange-400 font-semibold text-white"
                      : isGift
                        ? "border-amber-300 bg-amber-50 text-amber-500"
                        : "border-zinc-200 bg-zinc-50 text-zinc-400"
                  }`}
                >
                  {isGift ? "🎁" : done ? "✓" : day}
                </span>
              );
            })}
          </div>
          <p className="mt-1.5 text-[11px] text-zinc-400">{t("progressHint")}</p>
        </div>

        {result ? (
          <div className="mt-4">
            <div className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {result.already ? t("doneAlready") : t("pointsGain", { points: totalGain })}
            </div>
            {item && (
              <div className={`mt-2 flex items-center gap-3 rounded-xl border px-3 py-3 ${RARITY_BADGE_CLASS[item.rarity]}`}>
                <span className="text-3xl" aria-hidden>
                  {item.emoji}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-bold">{t("blindboxTitle")}</p>
                  <p className="mt-0.5 text-xs">
                    {t("itemGet", { name: itemDisplayName(item, locale) })}
                    <span className="ml-1 font-semibold">{t(`rarity_${item.rarity}`)}</span>
                  </p>
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={close}
              className="mt-4 w-full rounded-full bg-orange-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-600"
            >
              {t("close")}
            </button>
          </div>
        ) : (
          <div className="mt-4">
            {status.premium && <p className="mb-2 text-[11px] text-amber-600">{t("premiumHint")}</p>}
            {failed && <p className="mb-2 text-xs text-red-500">{t("failed")}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={close}
                className="flex-1 rounded-full border border-zinc-200 px-4 py-2 text-sm text-zinc-500 transition hover:bg-zinc-50"
              >
                {tc("cancel")}
              </button>
              <button
                type="button"
                onClick={doCheckin}
                disabled={busy}
                className="flex-[2] rounded-full bg-orange-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-600 disabled:opacity-50"
              >
                {busy ? t("checking") : t("checkinBtn")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
