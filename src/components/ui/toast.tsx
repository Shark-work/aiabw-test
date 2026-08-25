"use client";

import { useCallback, useState } from "react";

export type ToastKind = "success" | "error";

type ToastItem = { id: number; kind: ToastKind; text: string };

/** 轻量 Toast（成功/失败提示）：右上角堆叠，3s 自动消失。 */
export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const push = useCallback((kind: ToastKind, text: string) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000);
  }, []);

  const toast = {
    success: (text: string) => push("success", text),
    error: (text: string) => push("error", text),
  };

  const node = (
    <div className="pointer-events-none fixed right-4 top-16 z-[80] space-y-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto rounded-lg px-4 py-2 text-xs font-medium shadow-lg ${
            t.kind === "success" ? "bg-emerald-600 text-white" : "bg-red-500 text-white"
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );

  return { toast, toastsNode: node };
}
