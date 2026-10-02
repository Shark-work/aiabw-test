"use client";

import { useState, type ReactNode } from "react";

type Props = {
  /** 主版权行（始终显示，加粗样式由本组件统一渲染）。 */
  copyrightLine: string;
  /** 折叠态按钮文案（如「展开」/ Expand）。 */
  expandLabel: string;
  /** 展开态按钮文案（如「收起」/ Collapse）。 */
  collapseLabel: string;
  children: ReactNode;
};

/**
 * 页脚折叠容器：默认仅显示主版权行 + 展开/收起按钮（▸/▾）。
 *  - 折叠内容始终保留在 DOM（grid-rows 0fr→1fr + opacity 平滑过渡，不做条件卸载），
 *    保证 SEO 与法务条目可被爬虫索引；
 *  - inert 阻止折叠态下键盘 Tab 聚焦到不可见链接（a11y）；
 *  - 按钮 aria-expanded 同步当前状态。
 */
export function FooterCollapsible({
  copyrightLine,
  expandLabel,
  collapseLabel,
  children,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <div
        inert={!expanded}
        className={`grid transition-all duration-300 ease-in-out ${
          expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="min-h-0 overflow-hidden">{children}</div>
      </div>
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-x-2 gap-y-1 px-6 pb-2 pt-1">
        <p className="text-sm font-semibold text-zinc-600">{copyrightLine}</p>
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-0.5 rounded px-1 text-[11px] text-slate-400 transition hover:text-orange-600"
        >
          {expanded ? collapseLabel : expandLabel}
          <span aria-hidden className="text-[9px]">
            {expanded ? "▾" : "▸"}
          </span>
        </button>
      </div>
    </>
  );
}
