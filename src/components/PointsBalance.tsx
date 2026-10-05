"use client";

import { Link } from "@/i18n/navigation";

type Props = {
  points: number;
  className?: string;
  /** 移动端菜单等场景的点击回调（如关闭抽屉） */
  onClick?: () => void;
};

/**
 * 全局积分余额徽章（产品升级 Phase 4）：header 集成，点击进 /points 充值中心。
 * 余额数据由父组件（SiteHeader）自 /api/auth/me 供给；充值到账后经
 * PointsRechargeHost.onPointsChanged 回写刷新。
 */
export function PointsBalance({ points, className = "", onClick }: Props) {
  return (
    <Link
      href="/points"
      data-testid="points-balance"
      onClick={onClick}
      className={`flex items-center justify-center rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700 transition hover:bg-amber-200 ${className}`}
    >
      ⭐ {points}
    </Link>
  );
}
