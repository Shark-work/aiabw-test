import type { CollectionConfig } from "payload";

import { publicReadAdminWrite } from "./access.ts";

/**
 * 商品 Collection（后台化目标：aibi-catalog.ts 道具 / 装扮商城 skin×effect / 卡包
 * 等可购买项的价格与描述，运营调价不发版）。
 *
 * 红线：
 *  - priceCny 最低 1 元（全站价格红线：运营硬校验，防 0.x 元残留）；留空 = 仅积分售卖；
 *  - pricePoints 为积分价；0 = 免费（仅活动商品，慎用）；
 *  - effectPayload 为效果负载 JSON（与 aibi-catalog effectPayload 同构，
 *    如 { growthExp: 50 } / { evolve: true }），购买/使用路由按 kind+payload 结算；
 *  - 库存/订单/抽奖概率不进本表（业务表仍归 Neon 主库——本表只是「商品目录配置」）。
 */
export const Products: CollectionConfig = {
  slug: "products",
  labels: { singular: "商品", plural: "商品" },
  admin: {
    useAsTitle: "nameZh",
    description: "可购买项目录：道具 / 装扮 / 特效 / 卡包。改价即改站。",
  },
  defaultSort: "sortOrder",
  access: publicReadAdminWrite,
  fields: [
    {
      name: "productId",
      type: "text",
      required: true,
      unique: true,
      index: true,
      label: "商品 ID",
      admin: { description: "与业务路由引用一致，如 evolution_stone / skin_starry。" },
    },
    {
      name: "kind",
      type: "select",
      required: true,
      index: true,
      label: "类型",
      options: [
        { label: "消耗道具", value: "consumable" },
        { label: "装扮皮肤", value: "skin" },
        { label: "特效", value: "effect" },
        { label: "卡包", value: "pack" },
        { label: "组合礼包", value: "bundle" },
      ],
    },
    { name: "nameZh", type: "text", required: true, label: "名称（中）" },
    { name: "nameEn", type: "text", required: true, label: "名称（英）" },
    { name: "descriptionZh", type: "textarea", label: "描述（中）" },
    { name: "descriptionEn", type: "textarea", label: "描述（英）" },
    {
      name: "effectPayload",
      type: "json",
      label: "效果负载（JSON）",
      admin: { description: "如 { \"growthExp\": 50 } / { \"evolve\": true }；无效果留空。" },
    },
    {
      name: "pricePoints",
      type: "number",
      required: true,
      min: 0,
      defaultValue: 0,
      label: "积分价",
    },
    {
      name: "priceCny",
      type: "number",
      min: 1,
      label: "人民币价（元，空 = 仅积分）",
      admin: { description: "红线：最低 1 元，禁止 0.x 元。" },
    },
    {
      name: "rarity",
      type: "select",
      label: "稀有度",
      options: [
        { label: "common 普通", value: "common" },
        { label: "rare 稀有", value: "rare" },
        { label: "epic 史诗", value: "epic" },
        { label: "legendary 传说", value: "legendary" },
      ],
    },
    { name: "enabled", type: "checkbox", defaultValue: true, label: "上架" },
    { name: "sortOrder", type: "number", defaultValue: 0, label: "排序" },
  ],
};
