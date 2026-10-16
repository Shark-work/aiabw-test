import type { CollectionConfig } from "payload";

/**
 * Users（任务书 二.1）：Payload CMS 后台登录用户，与 Neon 业务 users 表完全独立
 * （Payload 所有表都在 Turso/libSQL 库内，前缀 payload_*）。
 * 首个管理员经 scripts/payload-seed（migration 批次）以 overrideAccess 创建；
 * 此后用户管理仅 admin。任务书 · 四：后台仅 admin 可进入。
 */
export const Users: CollectionConfig = {
  slug: "users",
  auth: true, // 自带 email + password 字段与 /api/payload/users/login 端点
  admin: { useAsTitle: "email", group: "系统" },
  access: {
    admin: ({ req }) => req.user?.role === "admin", // 后台面板准入
    read: ({ req }) => !!req.user, // 登录用户可读用户列表（面板需要）
    create: ({ req }) => req.user?.role === "admin",
    update: ({ req }) => req.user?.role === "admin",
    delete: ({ req }) => req.user?.role === "admin",
  },
  fields: [
    {
      name: "role",
      type: "select",
      required: true,
      defaultValue: "editor",
      saveToJWT: true, // 权限判断直读 JWT，零额外查询
      options: [
        { label: "管理员", value: "admin" },
        { label: "编辑（预留）", value: "editor" },
      ],
    },
  ],
};
