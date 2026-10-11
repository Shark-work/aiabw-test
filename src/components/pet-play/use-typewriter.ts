"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 打字机特效 hook（需求 1.1：宠物回复字幕逐字显示）。
 *  - text 变化即重置重打；speed 毫秒/字；
 *  - done=true 表示整段打完（前端可据此决定是否继续显示光标）；
 *  - 组件卸载/文本切换时清理定时器，无泄漏。
 */
export function useTypewriter(text: string, speed = 45): { typed: string; done: boolean } {
  const [typed, setTyped] = useState("");
  const [done, setDone] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (timerRef.current !== null) clearInterval(timerRef.current);
    if (!text) {
      setTyped("");
      setDone(true);
      return;
    }
    setTyped("");
    setDone(false);
    let i = 0;
    timerRef.current = setInterval(() => {
      i += 1;
      setTyped(text.slice(0, i));
      if (i >= text.length) {
        if (timerRef.current !== null) clearInterval(timerRef.current);
        timerRef.current = null;
        setDone(true);
      }
    }, speed);
    return () => {
      if (timerRef.current !== null) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [text, speed]);

  return { typed, done };
}
