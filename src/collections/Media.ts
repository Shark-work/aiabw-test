import type { CollectionConfig } from "payload";

/**
 * Media（任务书 二.9）：媒体库——宠物立绘、Rive 文件、剧情封面、Banner 图。
 * 生产走 Vercel Blob（@payloadcms/storage-vercel-blob，见 payload.config.ts）；
 * 本地无 BLOB token 时插件禁用，回退项目根 media/ 目录（已 gitignore）。
 * 不做 mimeTypes 白名单：.riv 等二进制素材 MIME 不可控；上传入口已限登录管理员。
 */
export const Media: CollectionConfig = {
  slug: "media",
  upload: true,
  admin: { useAsTitle: "filename", group: "内容" },
  access: {
    read: () => true, // 素材 URL 公开可读（任务书 · 四）
    create: ({ req }) => !!req.user,
    update: ({ req }) => !!req.user,
    delete: ({ req }) => req.user?.role === "admin",
  },
  fields: [
    { name: "alt", type: "text", admin: { description: "无障碍替代文本 / 素材备注" } },
  ],
};
