"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type Visits = { total: number; unique: number };

/**
 * 页脚访问计数（增强社区人气感）：
 *  - 客户端加载时 fetch /api/visits；
 *  - 数字千分位格式化（如 1,234,567）；
 *  - 接口失败静默（返回 null，不影响页脚其他内容）。
 */
export function VisitCounter() {
  const t = useTranslations("footer");
  const [stats, setStats] = useState<Visits | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/visits")
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d?.ok && typeof d.total === "number") {
          setStats({ total: d.total, unique: d.unique ?? 0 });
        }
      })
      .catch(() => {
        // 静默失败：不展示计数
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!stats) return null;

  const fmt = (n: number) => n.toLocaleString("en-US");

  return (
    <p className="mt-2 text-[11px] text-zinc-400">
      {t("visitsLine", { total: fmt(stats.total), unique: fmt(stats.unique) })}
    </p>
  );
}
