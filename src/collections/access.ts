import type { Access, CollectionConfig } from "payload";

/** 仅 admin 角色可写（role 已 saveToJWT，权限判断零查询）。 */
export const isAdmin: Access = ({ req }) => req.user?.role === "admin";

/**
 * 内容类 Collection 统一访问策略（「改表即改站」红线）：
 *  - 读公开：物种/故事/横幅等本就是前台公开展示内容；前台 loader 走
 *    Local API（src/lib/cms/payload.ts，Commit 4）服务端读取，REST 公开读亦可；
 *  - 写仅 admin：写入口收敛在 /admin 后台面板与一次性迁移脚本（Commit 5），
 *    任何登录用户不得经 REST 改内容表。
 */
export const publicReadAdminWrite: NonNullable<CollectionConfig["access"]> = {
  read: () => true,
  create: isAdmin,
  update: isAdmin,
  delete: isAdmin,
};
