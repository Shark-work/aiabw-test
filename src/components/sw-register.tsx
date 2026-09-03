"use client";

import { useEffect } from "react";

/**
 * 注册 Service Worker（/sw.js）：
 * - 仅生产环境注册：dev 下 SW 缓存 _next/static 会与 HMR 冲突；
 * - SW 职责：Web Push（召回通知）+ 静态资源离线缓存（PWA）；
 * - 与 push-optin.tsx 的注册指向同一 scope，重复注册无副作用。
 */
export function SwRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* 注册失败不影响页面功能，静默降级 */
      });
    };
    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
