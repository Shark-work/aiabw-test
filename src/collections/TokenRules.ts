import type { CollectionConfig } from "payload";

import { publicReadAdminWrite } from "./access.ts";
import { revalidateAfterChange } from "./revalidate.ts";

/**
 * 积分规则 Collection（后台化目标：散落代码各处的积分奖励/消耗额度——签到、探索、
 * 分享、成就奖励、宠物每日免费额度等——收敛为可运营调整的一张规则表）。
 *
 *  - ruleKey 全站唯一，业务代码按键取值（如 checkin.daily / postcard.share /
 *    pet.chat.free-quota）；loader 取不到时回退代码默认值，经济系统永不崩；
 *  - points 正数 = 奖励入账，负数 = 消耗扣减，0 = 仅限额型规则（如每日免费句数）；
 *  - dailyLimit 0 = 不限次；cooldownMinutes 0 = 无冷却；
 *  - ⚠️ 只改「额度/限额」，规则**触发逻辑**仍在代码（防刷/事务在业务路由内）。
 */
export const TokenRules: CollectionConfig = {
  slug: "token-rules",
  labels: { singular: "积分规则", plural: "积分规则" },
  admin: {
    useAsTitle: "nameZh",
    description: "积分奖励/消耗额度与每日限额：改表即调经济参数。",
  },
  access: publicReadAdminWrite,
  hooks: { afterChange: [revalidateAfterChange("token-rules")] },
  fields: [
    {
      name: "ruleKey",
      type: "text",
      required: true,
      unique: true,
      index: true,
      label: "规则键",
      admin: { description: "如 checkin.daily / exploration.complete / postcard.share。" },
    },
    { name: "nameZh", type: "text", required: true, label: "名称（中）" },
    { name: "nameEn", type: "text", required: true, label: "名称（英）" },
    {
      name: "points",
      type: "number",
      required: true,
      defaultValue: 0,
      label: "积分（正奖 / 负扣 / 0 纯限额）",
    },
    {
      name: "dailyLimit",
      type: "number",
      min: 0,
      defaultValue: 0,
      label: "每日上限（0 = 不限）",
    },
    {
      name: "cooldownMinutes",
      type: "number",
      min: 0,
      defaultValue: 0,
      label: "冷却分钟（0 = 无冷却）",
    },
    { name: "enabled", type: "checkbox", defaultValue: true, label: "启用" },
    { name: "descriptionZh", type: "textarea", label: "说明（中）" },
    { name: "descriptionEn", type: "textarea", label: "说明（英）" },
  ],
};
