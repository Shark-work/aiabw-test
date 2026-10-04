"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { LivingPet } from "@/components/LivingPet";
import { PaymentModal } from "@/components/payment-modal";
import { CHECKIN_MAKEUP_PRICE_CNY } from "@/lib/checkin-makeup";
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

function dateStrOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function todayStr(): string {
  return dateStrOf(new Date());
}

/** 昨天（本地时区，YYYY-MM-DD）：断签判定与补签成功轮询共用（字典序即日期序） */
function yestStr(): string {
  return dateStrOf(new Date(Date.now() - 24 * 60 * 60 * 1000));
}

type Status = {
  checkedToday: boolean;
  streak: number;
  nextStreak: number;
  premium: boolean;
  /** 最近签到日期（YYYY-MM-DD，null=从未签到）：断签判定用 */
  checkinDate: string | null;
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
  // P0-2 断签补签（XorPay kind=checkin_makeup）：支付弹窗状态 + 到账轮询定时器
  const [makeupOpen, setMakeupOpen] = useState(false);
  const [makeupQr, setMakeupQr] = useState<string | null>(null);
  const [makeupPayUrl, setMakeupPayUrl] = useState<string | null>(null);
  const [makeupBusy, setMakeupBusy] = useState(false);
  const [makeupError, setMakeupError] = useState("");
  const [makeupPaid, setMakeupPaid] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

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
          checkinDate: typeof data.checkinDate === "string" ? data.checkinDate : null,
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

  // 发起补签：/api/pay/create(kind=checkin_makeup) → XorPay 二维码（与积分充值同链路）
  const startMakeup = async () => {
    const token = localStorage.getItem("aiabw_token");
    if (!token || makeupBusy) return;
    setMakeupBusy(true);
    setMakeupError("");
    setMakeupQr(null);
    setMakeupPayUrl(null);
    setMakeupOpen(true);
    try {
      const res = await fetch("/api/pay/create", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ kind: "checkin_makeup" }),
      });
      const data = await res.json();
      if (data?.ok && data.qr) {
        setMakeupQr(data.qr);
        setMakeupPayUrl(data.payUrl ?? null);
      } else {
        setMakeupError(data?.error ?? t("makeupFail"));
      }
    } catch {
      setMakeupError(tc("networkError"));
    } finally {
      setMakeupBusy(false);
    }
  };

  // 二维码就绪后轮询签到状态（每 2s，最多 90 次 = 3 分钟）：
  // pay/notify 回填 last_checkin_date=昨天 → checkinDate ≥ 昨天即判定补签成功
  useEffect(() => {
    if (!makeupQr) return;
    let count = 0;
    pollRef.current = setInterval(async () => {
      count += 1;
      try {
        const token = localStorage.getItem("aiabw_token");
        const res = await fetch("/api/user/checkin", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (data?.ok && typeof data.checkinDate === "string" && data.checkinDate >= yestStr()) {
          stopPoll();
          setMakeupOpen(false);
          setMakeupQr(null);
          setMakeupPaid(true);
          // 刷新面板：checkinDate=昨天 → nextStreak=streak+1，进度点恢复连签显示
          setStatus({
            checkedToday: false,
            streak: data.streak ?? 0,
            nextStreak: data.nextStreak ?? 1,
            premium: !!data.premium,
            checkinDate: data.checkinDate,
          });
          return;
        }
      } catch {
        /* 单次轮询失败不中断 */
      }
      if (count >= 90) stopPoll();
    }, 2000);
    return stopPoll;
  }, [makeupQr, stopPoll, t]);

  useEffect(() => () => stopPoll(), [stopPoll]);

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
  // 断签判定（P0-2）：有连签记录但 last_checkin_date 早于昨天（补签成功后 makeupPaid 置位即隐藏卡片）
  const broken =
    !makeupPaid && status.streak > 0 && !!status.checkinDate && status.checkinDate < yestStr();

  return (
    <>
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
            {broken && (
              <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5">
                <p className="text-sm font-semibold text-rose-600">{t("makeupTitle")}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-rose-500">
                  {t("makeupDesc", { days: status.streak })}
                </p>
                <button
                  type="button"
                  onClick={startMakeup}
                  className="mt-2 w-full rounded-full bg-rose-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rose-600"
                >
                  {t("makeupBtn")}
                </button>
              </div>
            )}
            {makeupPaid && (
              <div className="mb-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                {t("makeupOk")}
              </div>
            )}
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
    {/* P0-2 断签补签支付层（PaymentModal z-[80] 覆盖主弹窗 z-[70]；fragment 兄弟节点避免点击冒泡误关主弹窗） */}
    <PaymentModal
      open={makeupOpen}
      title={t("makeupPayTitle")}
      amount={CHECKIN_MAKEUP_PRICE_CNY}
      description={t("makeupPayDesc")}
      qr={makeupQr ?? undefined}
      payUrl={makeupPayUrl}
      pending={!!makeupQr}
      busy={makeupBusy}
      error={makeupError || undefined}
      onClose={() => {
        stopPoll();
        setMakeupOpen(false);
      }}
    />
    </>
  );
}
