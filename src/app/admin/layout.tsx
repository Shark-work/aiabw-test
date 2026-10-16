import "@payloadcms/next/css";

import { handleServerFunctions, RootLayout } from "@payloadcms/next/layouts";
import configPromise from "@payload-config";
import type { ServerFunctionClient } from "payload";
import type { ReactNode } from "react";

import { importMap } from "./importMap";

/** Admin UI 的服务端函数桥（表单提交/抽屉等全部经此 Server Action）。 */
const serverFunction: ServerFunctionClient = async function (args) {
  "use server";
  return handleServerFunctions({ ...args, config: configPromise, importMap });
};

/**
 * Payload CMS 后台布局（任务书：src/app/admin/[[...segments]]/page.tsx + layout.tsx）。
 * /admin 树与 /[locale] 树一样自带根 layout（app/ 无公共根 layout），
 * 故可直接放 src/app/admin 而无需 (payload) 路由组——URL 与任务书一致。
 */
export default function PayloadAdminLayout({ children }: { children: ReactNode }) {
  return (
    <RootLayout config={configPromise} importMap={importMap} serverFunction={serverFunction}>
      {children}
    </RootLayout>
  );
}
