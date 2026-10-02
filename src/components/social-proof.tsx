"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

/**
 * 🌱 社交证明小字（首页 Hero）：「已有 N+ 位收藏家在培育他们的 AI 伙伴」。
 *  - 数据源 /api/visits 的 unique（独立访客，cookie 去重；接口带 60s 缓存 + 同 IP 防刷，
 *    与页脚 VisitCounter 并存不会重复计数）；
 *  - 千位格式化（按当前 locale）；加载中 / 接口失败 / 计数为 0 时降级为固定文案；
 *  - 纯展示组件，失败静默不影响页面其他模块。
 */
export function SocialProof({ className = "" }: { className?: string }) {
  const t = useTranslations("home");
  const locale = useLocale();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/visits")
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d?.ok && typeof d.unique === "number" && d.unique > 0) {
          setCount(d.unique);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const text =
    count != null
      ? t("socialProof", {
          count: new Intl.NumberFormat(locale === "en" ? "en-US" : "zh-CN").format(count),
        })
      : t("socialProofFallback");

  return <p className={className}>{text}</p>;
}
