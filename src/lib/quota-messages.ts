/**
 * 宠物旅行日记 · 聊天额度拟人化文案（按宠物种类 × 语言）
 *
 *  - 硬限制（hard_limit）：被挡后的撒娇 + 引导升级
 *  - 软提醒（soft_warn）：剩余条数的温柔提醒
 *
 * 软提醒文案含 {remaining} 占位符，由 getSoftWarnMessage 替换。
 * 硬限制文案不需替换。
 *
 * 宠物种类来自 src/lib/pet-config.ts 的 kind 字段；
 * 未知种类回退到 fox。
 */

export type PetKind = "cat" | "dog" | "fox" | "rabbit" | string;

export type Locale = "zh" | "en";

const FALLBACK_KIND: PetKind = "fox";

const HARD_LIMIT_MESSAGES: Record<string, Record<Locale, string>> = {
  cat: {
    zh: "哼…今天不想说话了。不过…如果你成为 VIP，我可以一直陪你哦 🥺",
    en: "Hmph... I don't want to talk anymore today. But... if you become VIP, I can stay with you forever 🥺",
  },
  dog: {
    zh: "汪汪！我今天好累啦～但是 VIP 的话我可以继续陪你玩！",
    en: "Woof! I'm so tired today~ But if you're VIP I can keep playing with you!",
  },
  fox: {
    zh: "嘻嘻，聊太多啦～想继续的话，要不要考虑一下 VIP 呀？",
    en: "Hehe, we've chatted so much~ Want to consider VIP to keep going?",
  },
  rabbit: {
    zh: "嗯…我有点累了…但是 VIP 的话，我可以再陪你一会儿…",
    en: "Mm... I'm a little tired... but if you're VIP, I can stay a bit longer...",
  },
};

const SOFT_WARN_MESSAGES: Record<string, Record<Locale, string>> = {
  cat: {
    zh: "喵…我还有 {remaining} 句话想说给你听…",
    en: "Meow... I still have {remaining} things to say to you...",
  },
  dog: {
    zh: "汪！我还能再聊 {remaining} 条！之后就要休息啦～",
    en: "Woof! I can still chat {remaining} more! Then I need a nap~",
  },
  fox: {
    zh: "嘻嘻，还剩 {remaining} 次机会哦，要好好珍惜～",
    en: "Hehe, only {remaining} chances left, make them count~",
  },
  rabbit: {
    zh: "嗯…还有 {remaining} 次…说完我就要睡觉了…",
    en: "Mm... {remaining} more... then I need to sleep...",
  },
};

/**
 * 硬限制文案（被挡后弹窗 + 顶部横幅）
 *  - petKind 未知时回退到 fox
 */
export function getHardLimitMessage(petKind: PetKind | undefined, locale: Locale): string {
  const key = petKind && HARD_LIMIT_MESSAGES[petKind] ? petKind : FALLBACK_KIND;
  return HARD_LIMIT_MESSAGES[key][locale];
}

/**
 * 软提醒文案（含 {remaining} 占位符）
 *  - 软提醒的剩余条数 = 硬限制上限 - 当前计数
 */
export function getSoftWarnMessage(
  petKind: PetKind | undefined,
  locale: Locale,
  remaining: number,
): string {
  const key = petKind && SOFT_WARN_MESSAGES[petKind] ? petKind : FALLBACK_KIND;
  return SOFT_WARN_MESSAGES[key][locale].replace("{remaining}", String(remaining));
}
