import "@/app/globals.css";

import { AdminShell } from "@/components/admin/admin-shell";

/**
 * 站长后台布局：/admin/* 统一走 AdminGuard（登录 + role=admin 校验）。
 * 后台面向运营，文案以中文为主（不依赖 i18n Provider）。
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
