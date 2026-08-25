"use client";

import type { ReactNode } from "react";

/** 轻量弹窗（Modal）：覆盖层 + 居中面板，点击遮罩关闭。 */
export function Dialog({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-zinc-900/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-zinc-900">{title}</h3>
          <button type="button" onClick={onClose} className="text-lg leading-none text-zinc-400 hover:text-zinc-600" aria-label="close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
