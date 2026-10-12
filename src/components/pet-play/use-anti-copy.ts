"use client";

import { useEffect } from "react";

/**
 * 防拷贝基础层（需求四.1：反 F12 开发者工具 + 防右键）。
 *
 * 红线与取舍（与 use-anti-debug 同哲学）：
 *  - 仅生产环境启用，开发调试零干扰；
 *  - 拦截：右键菜单（contextmenu）、F12、Ctrl/Cmd+Shift+I/J/C（DevTools 三入口）、
 *    Ctrl/Cmd+U（查看源码）、Ctrl/Cmd+S（保存页面）；
 *  - 只是提高审查门槛——真正的防抄袭根基是「密钥/扣费/状态判断全在服务端」，
 *    客户端 bundle 本就不含业务逻辑（另经 next.config.ts webpack-obfuscator 生产混淆）。
 */
export function useAntiCopy(): void {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toUpperCase();
      const mod = e.ctrlKey || e.metaKey;
      const blocked =
        e.key === "F12" ||
        (mod && e.shiftKey && (k === "I" || k === "J" || k === "C")) ||
        (mod && (k === "U" || k === "S"));
      if (blocked) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    document.addEventListener("contextmenu", onContextMenu);
    // capture 阶段拦截，抢在页面其他快捷键/浏览器默认行为之前
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);
}
