import type { GlobalConfig } from "payload";

import { publicReadAdminWriteGlobal } from "../collections/access.ts";

/**
 * 积分经济 Global（单例）：经济系统全局参数的总控面板。
 * 与 TokenRules Collection 的分工：TokenRules = 逐条规则额度（签到 +5 这类）；
 * 本 Global = 全局宏观参数（注册赠送 / 连签上限 / 充值汇率 / 经济说明文案）。
 * loader 读不到时业务路由回退代码内置默认值，经济系统永不崩（Commit 4 接线）。
 */
export const PointsEconomy: GlobalConfig = {
  slug: "points-economy",
  label: "积分经济",
  admin: { description: "积分宏观参数：注册赠送 / 连签上限 / 充值汇率 / 经济说明。" },
  access: publicReadAdminWriteGlobal,
  fields: [
    {
      name: "signupBonus",
      type: "number",
      min: 0,
      defaultValue: 20,
      label: "新用户注册赠送积分",
      admin: { description: "与 api/auth/register 新手礼包口径一致（+20，reason='welcome'）。" },
    },
    {
      name: "checkinBase",
      type: "number",
      min: 0,
      defaultValue: 3,
      label: "签到积分基准（展示口径）",
      admin: { description: "加权随机 1-10 的期望取整；实际抽取逻辑见 src/lib/checkin-points.ts。" },
    },
    {
      name: "checkinStreakMax",
      type: "number",
      min: 1,
      defaultValue: 7,
      label: "连签加成封顶天数",
      admin: { description: "连签第 N 天起奖励不再增长（防通胀闸）。" },
    },
    {
      name: "pointsPerCny",
      type: "number",
      min: 1,
      defaultValue: 17,
      label: "充值汇率（1 元 ≈ N 积分，展示口径）",
      admin: { description: "基础档 100分/¥6 ≈ 16.7 取整；实际四档随量递增（src/lib/points-recharge.ts），改此值不改档位表。" },
    },
    { name: "descriptionZh", type: "richText", label: "经济说明（中，充值页/帮助页展示）" },
    { name: "descriptionEn", type: "richText", label: "经济说明（英）" },
  ],
};
