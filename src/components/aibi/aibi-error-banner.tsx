"use client";

/**
 * 统一错误提示条（Phase 5 · 技术要求 2）：
 * 展示 Phase 4 错误码 + 服务端本地化 message（中英双语由 x-locale 决定）。
 */
export function AibiErrorBanner({
  code,
  message,
  onClose,
}: {
  code?: string | null;
  message: string;
  onClose?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex items-start justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
    >
      <div className="min-w-0">
        {code ? (
          <span className="mr-2 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold tracking-wide text-red-600 dark:bg-red-900/60 dark:text-red-300">
            {code}
          </span>
        ) : null}
        <span className="break-words">{message}</span>
      </div>
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          aria-label="close"
          className="shrink-0 rounded-full px-2 text-red-400 hover:text-red-600"
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}
