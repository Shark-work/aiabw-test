"use client";

import { useTranslations } from "next-intl";

export interface BackpackItemView {
  key: string;
  name: string;
  emoji: string;
  price: number;
  hungerDelta: number;
  happinessDelta: number;
  effect: "eat" | "play";
  desc: string;
  owned: number;
}

interface PetBackpackProps {
  /** i18n 命名空间（"petPlay" | "petMovie"） */
  ns: string;
  items: BackpackItemView[];
  open: boolean;
  /** 购买/使用进行中的 item key（防连点；事务在服务端） */
  pendingKey: string | null;
  onClose: () => void;
  onBuy: (item: BackpackItemView) => void;
  onUse: (item: BackpackItemView) => void;
}

/**
 * 互动背包（需求四.2 双形态）：
 *  - 桌面端（md+）：右侧悬浮侧栏，配合父组件右缘热区 hover 滑出；
 *  - 移动端（<md）：底部抽屉（bottom sheet），由右下 🎒 浮动按钮弹出——
 *    hover 在触屏不可用，必须适配手机。
 * 持有道具 → 「使用」（扣道具播动画）；无持有 → 「购买」（积分事务在 /api/pet/play/buy）。
 */
export function PetBackpack({ ns, items, open, pendingKey, onClose, onBuy, onUse }: PetBackpackProps) {
  const t = useTranslations(ns);

  const card = (item: BackpackItemView) => {
    const busy = pendingKey === item.key;
    return (
      <div
        key={item.key}
        title={item.desc}
        className="flex w-[104px] shrink-0 flex-col items-center gap-1 rounded-xl bg-white/5 p-2"
      >
        <span className="text-2xl">{item.emoji}</span>
        <span className="w-full truncate text-center text-[11px] leading-tight text-white/85">
          {item.name}
        </span>
        <span className="text-[10px] text-white/45">{t("owned", { n: item.owned })}</span>
        {item.owned > 0 ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onUse(item)}
            className="w-full rounded-full bg-emerald-400/90 px-2 py-1 text-[11px] font-semibold text-black transition hover:bg-emerald-300 disabled:opacity-40"
          >
            {busy ? "…" : t("useItem")}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => onBuy(item)}
            className="w-full rounded-full bg-amber-400/90 px-2 py-1 text-[11px] font-semibold text-black transition hover:bg-amber-300 disabled:opacity-40"
          >
            {busy ? "…" : `🪙${item.price} ${t("buy")}`}
          </button>
        )}
      </div>
    );
  };

  return (
    <>
      {/* 桌面端：右侧悬浮侧栏（hover 热区滑出；鼠标移出侧栏即收回——父组件控制 open） */}
      <aside
        className={`absolute top-[12%] right-0 z-30 hidden h-[76%] w-[128px] rounded-l-2xl border-y border-l border-white/10 bg-black/40 backdrop-blur-md transition-transform duration-300 md:block ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        onMouseLeave={onClose}
      >
        <div className="flex h-full flex-col items-center gap-3 overflow-y-auto py-3">
          <div className="text-[11px] font-medium tracking-wide text-white/50">{t("backpack")}</div>
          {items.map(card)}
        </div>
      </aside>

      {/* 移动端：底部抽屉（fixed bottom sheet；向上滑出，点遮罩/把手关闭） */}
      <div
        className={`fixed inset-0 z-40 md:hidden ${open ? "" : "pointer-events-none"}`}
        aria-hidden={!open}
      >
        <div
          className={`absolute inset-0 bg-black/50 transition-opacity duration-300 ${open ? "opacity-100" : "opacity-0"}`}
          onClick={onClose}
        />
        <div
          className={`absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-white/10 bg-zinc-900/95 pb-6 backdrop-blur-md transition-transform duration-300 ${
            open ? "translate-y-0" : "translate-y-full"
          }`}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label={t("backpack")}
            className="mx-auto mt-2 block h-1.5 w-10 rounded-full bg-white/20"
          />
          <div className="px-4 pt-2 text-xs font-medium text-white/50">{t("backpack")}</div>
          <div className="flex gap-3 overflow-x-auto px-4 pt-2 pb-1">{items.map(card)}</div>
        </div>
      </div>
    </>
  );
}
