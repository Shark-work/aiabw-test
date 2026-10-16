import { getPointsEconomy, getTokenRuleList } from "@/lib/cms/loaders";
import {
  PointsClient,
  type PointsEconomyView,
  type TokenRuleView,
} from "@/components/points/points-client";

/**
 * 积分中心（RSC 壳，任务三 PointsEconomy + 任务五 TokenRules 读取侧接线）：
 *  - PointsEconomy 宏观四参数（注册赠送/签到基准/连签封顶/充值汇率）；
 *  - TokenRules 规则列表（loader 仅取 enabled；白名单展示字段下发——
 *    内部 id/审计字段不进客户端 bundle，任务五敏感字段红线）；
 *  - CMS 空表/未配置 → economy=null、rules=[]，客户端区块整体隐藏，
 *    页面渲染与接入前完全一致（降级链红线）；
 *  - 缓存：unstable_cache 60s + afterChange revalidateTag 即新（任务六）。
 */
export default async function PointsPage() {
  const [economy, rules] = await Promise.all([getPointsEconomy(), getTokenRuleList()]);
  const ecoView: PointsEconomyView | null = economy
    ? {
        signupBonus: economy.signupBonus,
        checkinBase: economy.checkinBase,
        checkinStreakMax: economy.checkinStreakMax,
        pointsPerCny: economy.pointsPerCny,
      }
    : null;
  const ruleViews: TokenRuleView[] = rules.map((r) => ({
    ruleKey: r.ruleKey,
    nameZh: r.nameZh ?? null,
    nameEn: r.nameEn ?? null,
    points: r.points,
    dailyLimit: r.dailyLimit ?? null,
    descriptionZh: r.descriptionZh ?? null,
    descriptionEn: r.descriptionEn ?? null,
  }));
  return <PointsClient economy={ecoView} rules={ruleViews} />;
}
