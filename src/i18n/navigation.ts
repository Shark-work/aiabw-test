import { createNavigation } from "next-intl/navigation";

import { routing } from "./routing";

/** 语言感知的导航工具（Link / useRouter / usePathname 自动带语言前缀）。 */
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
