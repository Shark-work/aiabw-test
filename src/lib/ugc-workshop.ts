/**
 * 宠物旅行日记 · UGC 内容创作工坊（纯常量与纯函数）
 *
 * 零 DB / 零 React 依赖：Node 单测可直接 import。
 *  - AI 宠物写真：10 种风格预设、prompt 构建、上传照片校验、外部服务响应解析
 *  - 宠物日记卡片：3 种主题、心情映射、画布尺寸、站点水印
 *  - 通用：creation / content / submission 枚举（与 drizzle/0023 CHECK 约束一致）
 */

// ─────────────────── 通用枚举（与 drizzle/0023 CHECK 约束一致） ───────────────────

export const UGC_CREATION_TYPES = ["portrait", "diary_card", "sticker"] as const;
export type UgcCreationType = (typeof UGC_CREATION_TYPES)[number];

export const UGC_CONTENT_TYPES = ["image", "video", "text"] as const;
export const UGC_SUBMISSION_STATUS = ["pending", "approved", "rejected", "featured"] as const;

// ─────────────────── AI 宠物写真 ───────────────────

export interface PortraitStyle {
  id: string;
  emoji: string;
  /** 追加给生图模型的英文风格关键词（模型侧稳定，不随 UI 语言变化） */
  promptHint: string;
}

/** 10 种写真风格预设（顺序即前端网格展示顺序；双语名称见 messages.workshop.portrait.styles） */
export const PORTRAIT_STYLES: readonly PortraitStyle[] = [
  { id: "hanfu",        emoji: "🏮", promptHint: "wearing elegant traditional Chinese hanfu, ancient palace garden, oriental aesthetic" },
  { id: "wedding",      emoji: "👰", promptHint: "wearing a white western wedding dress, romantic church, soft dreamy light" },
  { id: "japanese",     emoji: "🌸", promptHint: "fresh Japanese mori style, cherry blossom garden, pastel film tones" },
  { id: "hk-retro",     emoji: "🌃", promptHint: "1990s Hong Kong retro film look, neon street signs, cinematic grain" },
  { id: "cyberpunk",    emoji: "🤖", promptHint: "cyberpunk city night, neon blue and magenta rim light, futuristic techwear" },
  { id: "oil-painting", emoji: "🎨", promptHint: "classical baroque oil painting portrait, museum lighting, rich texture" },
  { id: "astronaut",    emoji: "🚀", promptHint: "wearing a cute astronaut suit floating in space, planet earth behind" },
  { id: "royal",        emoji: "👑", promptHint: "royal pet portrait with tiny crown and velvet cape, grand palace hall" },
  { id: "knight",       emoji: "⚔️", promptHint: "shiny medieval knight armor, castle courtyard, heroic fantasy light" },
  { id: "plush",        emoji: "🧸", promptHint: "transformed into a fluffy plush toy, soft studio lighting, kawaii" },
] as const;

export const PORTRAIT_STYLE_IDS: readonly string[] = PORTRAIT_STYLES.map((s) => s.id);

/** 校验风格 id 是否在预设内（API 入参防注入） */
export function isPortraitStyle(id: unknown): id is string {
  return typeof id === "string" && PORTRAIT_STYLE_IDS.includes(id);
}

/** 组装完整生图 prompt：主体（宠物）+ 风格 + 质量词 */
export function buildPortraitPrompt(styleId: string, petName?: string): string {
  const style = PORTRAIT_STYLES.find((s) => s.id === styleId);
  const subject = petName ? `the pet "${petName}"` : "the pet in the photo";
  const hint = style ? style.promptHint : "";
  return [
    `cute high-quality portrait of ${subject}`,
    hint,
    "fluffy fur detail, expressive eyes, masterpiece, best quality",
  ]
    .filter(Boolean)
    .join(", ");
}

/** 免费用户每日写真生成上限；VIP 无限（API 侧 dailyLimit=-1 表示无限） */
export const FREE_DAILY_PORTRAIT_LIMIT = 1;

/** 单次生成成本（元，透明化标注在生成按钮旁，降低用户预期） */
export const PORTRAIT_COST_YUAN = 0.1;

/** base64 照片长度上限（≈5MB 原图 → base64 约 7M 字符） */
export const MAX_PHOTO_BASE64_LEN = 7_000_000;
/** URL 照片长度上限 */
export const MAX_PHOTO_URL_LEN = 2048;

/**
 * 校验用户上传照片入参：
 *  - data:image/(png|jpeg|webp);base64,...（≤ MAX_PHOTO_BASE64_LEN）
 *  - 或 http(s) 图片 URL（≤ MAX_PHOTO_URL_LEN）
 */
export function isValidPhotoInput(photo: unknown): photo is string {
  if (typeof photo !== "string" || photo.length === 0) return false;
  if (photo.startsWith("data:")) {
    return (
      /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=\s]+$/.test(photo) &&
      photo.length <= MAX_PHOTO_BASE64_LEN
    );
  }
  return /^https?:\/\/\S+$/.test(photo) && photo.length <= MAX_PHOTO_URL_LEN;
}

/**
 * 从外部生图服务（阿里云 FC ComfyUI / 现成 Skill API）响应中宽容提取图片 URL。
 * 兼容：imageUrl / image_url / url / image / data.{imageUrl,image_url,url}
 *       / result.{url,imageUrl} / output.images[0]
 */
export function extractPortraitImageUrl(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const nested: unknown[] = [
    d.imageUrl,
    d.image_url,
    d.url,
    d.image,
    (d.data as Record<string, unknown> | undefined)?.imageUrl,
    (d.data as Record<string, unknown> | undefined)?.image_url,
    (d.data as Record<string, unknown> | undefined)?.url,
    (d.result as Record<string, unknown> | undefined)?.url,
    (d.result as Record<string, unknown> | undefined)?.imageUrl,
  ];
  const outputImages = (d.output as Record<string, unknown> | undefined)?.images;
  if (Array.isArray(outputImages) && typeof outputImages[0] === "string") {
    nested.push(outputImages[0]);
  }
  for (const c of nested) {
    if (typeof c === "string" && /^https?:\/\/\S+$/.test(c)) return c;
  }
  return null;
}

// ─────────────────── 宠物日记卡片 ───────────────────

export type DiaryThemeId = "fresh" | "vintage" | "cute";

export interface DiaryTheme {
  id: DiaryThemeId;
  /** 背景渐变起止色 */
  bgFrom: string;
  bgTo: string;
  /** 独白卡片底色 */
  cardBg: string;
  /** 主标题色 / 正文色 / 点缀色 */
  textMain: string;
  textSub: string;
  accent: string;
}

/** 3 种卡片主题（id 与 messages.workshop.diary.theme* 一一对应） */
export const DIARY_THEMES: readonly DiaryTheme[] = [
  { id: "fresh",   bgFrom: "#E8F7EE", bgTo: "#CDEEDD", cardBg: "#FFFFFF", textMain: "#2D5A45", textSub: "#5B7F6E", accent: "#58B98B" },
  { id: "vintage", bgFrom: "#F5E9D3", bgTo: "#E7D3B0", cardBg: "#FDF7EA", textMain: "#6B4F2E", textSub: "#8C7250", accent: "#B98A45" },
  { id: "cute",    bgFrom: "#FFE3F1", bgTo: "#F3E0FF", cardBg: "#FFFFFF", textMain: "#8A3B6E", textSub: "#A56A93", accent: "#F07FB8" },
] as const;

export function isDiaryTheme(id: unknown): id is DiaryThemeId {
  return DIARY_THEMES.some((t) => t.id === id);
}

/** 卡片画布尺寸：1080×1350（4:5 竖版，朋友圈/小红书友好） */
export const DIARY_CARD_WIDTH = 1080;
export const DIARY_CARD_HEIGHT = 1350;

/** 卡片底部固定站点域名水印（裂变引流） */
export const SITE_WATERMARK = "aiabw.com";
/** 卡片二维码指向的站点落地页 */
export const SITE_URL_FOR_QR = "https://www.aiabw.com";

/** 心情值（adoptions.happiness 0-100）→ 卡片心情 emoji */
export function moodEmojiOf(happiness: number | null | undefined): string {
  if (happiness == null || Number.isNaN(happiness)) return "🙂";
  if (happiness >= 80) return "😄";
  if (happiness >= 50) return "🙂";
  if (happiness >= 30) return "😐";
  return "😢";
}

