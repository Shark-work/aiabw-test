"use client";

import { useEffect } from "react";

import { useTypewriter } from "@/components/pet-play/use-typewriter";

interface ChatBubbleProps {
  /** 单轮回复全文（变化即重打 + 气泡淡入；空串 = 隐藏气泡） */
  text: string;
  /** 打字中状态上报（父组件发送锁：打字期间禁止再发，防连点刷句刷费） */
  onTypingChange?: (typing: boolean) => void;
}

/**
 * 宠物对话气泡（单轮展示：只呈现当前一轮回复，新回复整体覆盖旧回复）。
 *  - 打字机逐字（useTypewriter 内聚）+ 光标脉冲；打字状态上报父组件做发送锁；
 *  - 淡入：key=全文重挂载触发 CSS 动画 pet-bubble-in（globals.css；
 *    prefers-reduced-motion 豁免——直接整句出现，无动画）；
 *  - 无障碍：aria-live=polite，屏幕阅读器朗读新回复；
 *  - 双页共用：play / movie 两客户端同一驱动接口（服务端契约 text → 本组件）。
 */
export function ChatBubble({ text, onTypingChange }: ChatBubbleProps) {
  const { typed, done } = useTypewriter(text);
  const typing = !done;

  useEffect(() => {
    onTypingChange?.(typing);
  }, [typing, onTypingChange]);

  return (
    <div
      className="absolute bottom-[120px] left-0 z-20 w-full px-6 text-center text-lg text-white pointer-events-none"
      style={{ textShadow: "0 2px 10px rgba(0,0,0,0.85), 0 0 24px rgba(0,0,0,0.6)" }}
      aria-live="polite"
    >
      {typed && (
        <span
          key={text}
          className="pet-bubble-in inline-block max-w-[720px] rounded-2xl bg-black/45 px-5 py-2.5 backdrop-blur-sm"
        >
          {typed}
          {typing && <span className="animate-pulse">▍</span>}
        </span>
      )}
    </div>
  );
}
