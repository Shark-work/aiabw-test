import type { CollectionConfig } from "payload";

import { publicReadAdminWrite } from "./access.ts";
import { revalidateAfterChange } from "./revalidate.ts";

/**
 * 宠物动画映射 Collection（后台化目标：sm-contract.ts 的 MOOD_ACTION_MAP 可按物种
 * 覆写进库；契约枚举值与 Rive 状态机输入名保持代码侧单一事实源——此处只是数据映射）。
 *
 * 红线：
 *  - mood/action/riveTrigger 的**可选值**锁死为契约枚举（PET_MOODS 7 / PET_ACTIONS 9 /
 *    PET_SM_TRIGGERS 5），后台不能发明新枚举——新枚举必须改代码契约 + 美术资产同步；
 *  - species 留空 = 全局默认映射（等价于代码 MOOD_ACTION_MAP）；
 *    指定物种 = 该物种的个性化覆写（loader 优先取覆写）；
 *  - 情绪无 Trigger（Number 输入驱动），Trigger 仅动作位（pet/eat/play/sleep/wake）。
 */
export const PetAnimations: CollectionConfig = {
  slug: "pet-animations",
  labels: { singular: "宠物动画映射", plural: "宠物动画映射" },
  admin: {
    useAsTitle: "mood",
    defaultColumns: ["species", "mood", "action", "riveTrigger", "intensityDefault"],
    description: "情绪 → 动作 → Rive 输入的映射；留空物种 = 全局默认。",
  },
  access: publicReadAdminWrite,
  hooks: { afterChange: [revalidateAfterChange("pet-animations")] },
  fields: [
    {
      name: "species",
      type: "relationship",
      relationTo: "species",
      label: "物种（留空 = 全局默认）",
    },
    {
      name: "mood",
      type: "select",
      required: true,
      label: "情绪（契约枚举）",
      options: [
        { label: "idle 待机", value: "idle" },
        { label: "happy 开心", value: "happy" },
        { label: "sad 难过", value: "sad" },
        { label: "angry 生气", value: "angry" },
        { label: "hungry 饥饿", value: "hungry" },
        { label: "thinking 思考", value: "thinking" },
        { label: "sleepy 困倦", value: "sleepy" },
      ],
    },
    {
      name: "action",
      type: "select",
      required: true,
      label: "动作（契约枚举）",
      options: [
        { label: "idle", value: "idle" },
        { label: "eat 进食", value: "eat" },
        { label: "sleep 睡觉", value: "sleep" },
        { label: "think 思考", value: "think" },
        { label: "wave 挥手", value: "wave" },
        { label: "happy 开心", value: "happy" },
        { label: "sad 难过", value: "sad" },
        { label: "angry 生气", value: "angry" },
        { label: "rub 蹭蹭", value: "rub" },
      ],
    },
    {
      name: "riveTrigger",
      type: "select",
      label: "Rive Trigger（仅动作位）",
      options: [
        { label: "pet 抚摸", value: "pet" },
        { label: "eat 进食", value: "eat" },
        { label: "play 玩耍", value: "play" },
        { label: "sleep 入睡", value: "sleep" },
        { label: "wake 唤醒", value: "wake" },
      ],
      admin: { description: "留空 = 仅 Number 输入（emotion/intensity）驱动，无 Trigger。" },
    },
    {
      name: "intensityDefault",
      type: "number",
      min: 0,
      max: 2,
      defaultValue: 1,
      label: "默认强度（0-2）",
    },
    { name: "note", type: "text", label: "备注" },
  ],
};
