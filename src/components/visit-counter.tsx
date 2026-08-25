"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

/** 前端展示底数：真实访问数 + BASE_COUNT（仅展示层加法，不改数据库真实统计）。 */
const BASE_COUNT = 10000;

/**
 * 页脚访问计数（人气感）：
 *  - 客户端加载时 fetch /api/visits；
 *  - 展示值 = 数据库真实访问数 + 10000（前端加法）；
 *  - 仅显示「累计访问」，不显示独立访客；
 *  - 数字千分位格式化（如 10,023）；
 *  - 接口失败静默（返回 null，不影响页脚其他内容）。
 */
export function VisitCounter() {
  const t = useTranslations("footer");
  const [total, setTotal] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/visits")
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d?.ok && typeof d.total === "number") {
          setTotal(d.total);
        }
      })
      .catch(() => {
        // 静默失败：不展示计数
      });
    return () => {
      alive = false;
    };
  }, []);

  if (total === null) return null;

  const fmt = (n: number) => n.toLocaleString("en-US");
  const displayTotal = fmt(total + BASE_COUNT);

  return (
    <p className="mt-2 text-center text-[11px] text-slate-400">
      {t("visitsLine", { total: displayTotal })}
    </p>
  );
}

