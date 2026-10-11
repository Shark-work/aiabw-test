"use client";

import { useEffect } from "react";

/**
 * 防调试检测（需求 2.1：生产环境检测 DevTools 开启时跳转离开互动页）。
 *
 * 红线与取舍：
 *  - 仅生产环境启用（process.env.NODE_ENV === "production"），开发调试零干扰；
 *  - 采用「窗口尺寸差」启发式（docked DevTools 撑开 outer/inner 差值 > 阈值），
 *    每 1.5s 轮询；触发后 router.replace("/") 跳离本页（互动逻辑全部在服务端，
 *    跳离即切断交互，配合生产 bundle 混淆提高审查门槛）；
 *  - 刻意不用 debugger 语句死循环（会误伤正常用户的性能与体验）；
 *  - 检测仅为提高门槛，不能替代服务端鉴权——密钥/扣费/状态判定本就不在客户端。
 */
export function useAntiDebug(onDetect: () => void): void {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;

    const THRESHOLD = 160;
    const detect = () => {
      const widthGap = window.outerWidth - window.innerWidth > THRESHOLD;
      const heightGap = window.outerHeight - window.innerHeight > THRESHOLD;
      if (widthGap || heightGap) onDetect();
    };
    const timer = setInterval(detect, 1500);
    window.addEventListener("resize", detect);
    return () => {
      clearInterval(timer);
      window.removeEventListener("resize", detect);
    };
  }, [onDetect]);
}
