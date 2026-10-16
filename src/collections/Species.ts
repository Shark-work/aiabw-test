import type { CollectionConfig } from "payload";

import { publicReadAdminWrite } from "./access.ts";
import { revalidateAfterChange } from "./revalidate.ts";

/**
 * 物种 Collection（后台化目标：species-visuals.ts 注册表 + characters.ts 角色人设
 * 的「展示层字段」迁移进库，改表即改站）。
 *
 * 与现有代码的映射（Commit 5 迁移脚本按此导入）：
 *  - speciesId = pet_type "species:<id>" 的 id 部分（如 persian / snow-leopard）；
 *  - rivePath / staticImage / sceneTheme ← SPECIES_VISUALS 注册表（视觉层）；
 *  - personality / greetingZh / greetingEn ← PET_CHARACTERS 人设展示字段
 *    （⚠️ System Prompt 与台词库不进 CMS——防抄袭红线，仍留服务端代码）；
 *  - loader 读不到（空表/Turso 未配置）时回退现有硬编码注册表，前台永不空白。
 */
export const Species: CollectionConfig = {
  slug: "species",
  labels: { singular: "物种", plural: "物种" },
  admin: {
    useAsTitle: "nameZh",
    description: "宠物物种：视觉资产 / 场景主题 / 展示人设。改表即改站，无需发版。",
  },
  defaultSort: "sortOrder",
  access: publicReadAdminWrite,
  // 任务六：后台保存 → revalidateTag("species")，前台 60s ISR 变下次请求即新
  hooks: { afterChange: [revalidateAfterChange("species")] },
  fields: [
    {
      name: "speciesId",
      type: "text",
      required: true,
      unique: true,
      index: true,
      label: "物种 ID",
      admin: { description: 'pet_type "species:<id>" 的 id 部分，如 persian / snow-leopard。' },
    },
    { name: "nameZh", type: "text", required: true, label: "中文名" },
    { name: "nameEn", type: "text", required: true, label: "英文名" },
    {
      name: "personality",
      type: "textarea",
      label: "人设一句话",
      admin: { description: "展示用（文档/卡片）。System Prompt 不入库，仍由服务端代码构建。" },
    },
    { name: "greetingZh", type: "textarea", label: "开场白（中）" },
    { name: "greetingEn", type: "textarea", label: "开场白（英）" },
    {
      name: "rivePath",
      type: "text",
      label: "Rive 资产 key",
      admin: { description: "留空 = 该物种无 Rive 素材，直用静态立绘（绝不复用其他物种素材）。" },
    },
    {
      name: "staticImage",
      type: "text",
      label: "静态立绘路径",
      admin: { description: "public 下路径如 /avatars/persian.png；留空 = 运行时按物种头像派生。" },
    },
    {
      name: "sceneTheme",
      type: "text",
      defaultValue: "meadow",
      label: "场景主题",
      admin: { description: "舞台背景氛围，CSS 类 pet-scene-<theme>；未识别回退 meadow。" },
    },
    { name: "sortOrder", type: "number", defaultValue: 0, label: "排序" },
  ],
};
