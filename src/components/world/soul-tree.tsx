"use client";

/**
 * 灵魂树彩蛋（2026-10-16 世界观体系 · 产出物 5）
 *  - 🌳 发光按钮（soul-tree-glow CSS 呼吸光芒）→ 弹窗：
 *    创世神话短文案 + 大陆实时统计 + 树叶飘落动画（soul-tree-leaf ×4）；
 *  - 统计：GET /api/world/stats（图鉴物种 / 灵宠物种 / 开放区域 / 总共鸣次数），
 *    接口失败静默降级为仅展示创世短文案（不影响主功能）；
 *  - 挂载：首页 Hero 区 + /world 百科页顶部；
 *  - 动效遵守 prefers-reduced-motion（globals.css 统一停用）。
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type WorldStats = {
  speciesTotal: number;
  soulPetSpeciesTotal: number;
  regionsTotal: number;
  resonancesTotal: number;
};

/** 树叶飘落配置（left 位置 + 动画延迟错峰，纯 CSS 驱动） */
const LEAVES = [
  { left: "18%", delay: "0s", emoji: "🍃" },
  { left: "38%", delay: "1.1s", emoji: "🍂" },
  { left: "58%", delay: "2.2s", emoji: "🍃" },
  { left: "76%", delay: "0.6s", emoji: "🍂" },
] as const;

export function SoulTreeEgg() {
  const t = useTranslations("worldview");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState<WorldStats | null>(null);

  useEffect(() => {
    if (!open) return;
    fetch("/api/world/stats", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok && d.stats) setStats(d.stats as WorldStats);
      })
      .catch(() => {
        /* 静默降级：统计拉取失败仅隐藏统计区 */
      });
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="soul-tree-glow inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50/80 px-4 py-1.5 text-sm font-semibold text-emerald-700 shadow-sm transition hover:bg-emerald-100"
        aria-haspopup="dialog"
      >
        {t("soulTreeCta")}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-zinc-900/50 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-label={t("soulTreeTitle")}
            className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-emerald-100 bg-gradient-to-b from-emerald-50 via-white to-amber-50 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 树叶飘落装饰（globals.css .soul-tree-leaf，reduced-motion 停用） */}
            {LEAVES.map((leaf, i) => (
              <span
                key={i}
                aria-hidden
                className="soul-tree-leaf text-base"
                style={{ left: leaf.left, animationDelay: leaf.delay }}
              >
                {leaf.emoji}
              </span>
            ))}

            <div className="flex items-start justify-between gap-2">
              <h3 className="text-base font-bold text-emerald-800">{t("soulTreeTitle")}</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={tc("close")}
                className="rounded-full border border-emerald-200 px-2 py-0.5 text-xs text-emerald-500 transition hover:bg-emerald-50"
              >
                ✕
              </button>
            </div>

            <p className="mt-2 text-center text-5xl" aria-hidden>🌳</p>
            <p className="mt-3 text-xs leading-relaxed text-zinc-600">{t("soulTreeMyth")}</p>

            {/* 大陆实时统计（接口失败时整块隐藏，静默降级） */}
            {stats && (
              <div className="mt-4">
                <p className="text-center text-[11px] font-semibold uppercase tracking-wider text-emerald-600">
                  {t("statsTitle")}
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2 text-center">
                  <div className="rounded-xl bg-white/80 px-2 py-2 shadow-sm">
                    <p className="text-lg font-black text-emerald-700">
                      {(stats.speciesTotal + stats.soulPetSpeciesTotal).toLocaleString()}
                    </p>
                    <p className="text-[10px] text-zinc-500">🐾 {t("statsSpecies")}</p>
                  </div>
                  <div className="rounded-xl bg-white/80 px-2 py-2 shadow-sm">
                    <p className="text-lg font-black text-emerald-700">{stats.regionsTotal.toLocaleString()}</p>
                    <p className="text-[10px] text-zinc-500">🗺️ {t("statsRegions")}</p>
                  </div>
                  <div className="col-span-2 rounded-xl bg-white/80 px-2 py-2 shadow-sm">
                    <p className="text-lg font-black text-amber-600">{stats.resonancesTotal.toLocaleString()}</p>
                    <p className="text-[10px] text-zinc-500">💞 {t("statsResonances")}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
