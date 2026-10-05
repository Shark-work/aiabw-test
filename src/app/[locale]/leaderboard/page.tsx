"use client";

import { LeaderboardV2 } from "@/components/leaderboard-v2";

/**
 * 排行榜独立页（产品升级 Phase 5）：
 * 多维分类 × 周期榜单 + 付费推荐位 + 我的排名 + 条目分享。
 * （pets 页内嵌的旧版 LeaderboardPanel 双榜 Tab 保留不动，向后兼容。）
 */
export default function LeaderboardPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-amber-50 via-orange-50 to-rose-50 px-4 py-6">
      <div className="mx-auto max-w-3xl">
        <LeaderboardV2 />
      </div>
    </main>
  );
}
