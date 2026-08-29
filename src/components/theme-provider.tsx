"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type Theme = "cute" | "wild";

const ThemeCtx = createContext<{ theme: Theme; toggle: () => void }>({
  theme: "cute",
  toggle: () => {},
});

/**
 * 主题上下文（cute 默认 / wild 野性山林）：
 *  - localStorage 持久化（aiabw_theme）；html[data-theme] 驱动 CSS 变量；
 *  - 首帧防闪烁由 layout.tsx 的 <head> 内联脚本完成（渲染前读取 localStorage）。
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("cute");

  useEffect(() => {
    // 与 head 内联脚本保持一致：同步 DOM 状态到 React state
    const t = document.documentElement.getAttribute("data-theme");
    if (t === "wild") setTheme("wild");
  }, []);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === "cute" ? "wild" : "cute";
      document.documentElement.setAttribute("data-theme", next);
      try {
        localStorage.setItem("aiabw_theme", next);
      } catch {
        // 隐私模式等异常：忽略持久化
      }
      return next;
    });
  }, []);

  return <ThemeCtx.Provider value={{ theme, toggle }}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);
