"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge, Table, Td } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";

type AdminReport = {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  detail: string | null;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
  reporterEmail: string | null;
};

const PAGE_SIZE = 20;

const REASON_LABEL: Record<string, string> = {
  spam: "垃圾信息",
  nsfw: "色情/成人",
  abuse: "辱骂/攻击",
  illegal: "违法违规",
  other: "其他",
};

const TARGET_LABEL: Record<string, string> = {
  chat: "聊天",
  pet_name: "宠物名",
  ugc_pet: "UGC 宠物",
  postcard: "明信片",
  news: "资讯",
};

type AiStats = {
  cache: { entries: number; hits: number; hitRate: number; expired: number };
  concurrency: { inFlight: number; max: number };
};

/** 🛡️ 内容审核：用户举报队列（pending 先报先审）+ 确认违规 / 驳回处置 + AI 成本监控条。 */
export default function AdminModerationPage() {
  const { toast, toastsNode } = useToast();
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("pending");
  const [aiStats, setAiStats] = useState<AiStats | null>(null);

  const load = useCallback(async () => {
    const token = localStorage.getItem("aiabw_token");
    const headers = { Authorization: `Bearer ${token}` };
    const qs = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), status });
    const [d, stats] = await Promise.all([
      fetch(`/api/admin/reports?${qs}`, { headers }).then((r) => r.json()),
      fetch("/api/admin/ai-stats", { headers }).then((r) => r.json()).catch(() => null),
    ]);
    if (d?.ok) {
      setReports(d.reports);
      setTotal(d.total);
    } else {
      toast.error(d?.error ?? "加载失败");
    }
    if (stats?.ok) setAiStats(stats as AiStats);
  }, [page, status, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = async (r: AdminReport, action: "resolve" | "dismiss") => {
    const token = localStorage.getItem("aiabw_token");
    const d = await fetch(`/api/admin/reports/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action }),
    }).then((res) => res.json());
    if (d?.ok) {
      toast.success(action === "resolve" ? "已确认违规" : "已驳回举报");
      void load();
    } else {
      toast.error(d?.error ?? "操作失败");
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));


  return (
    <div>
      {toastsNode}
      <h1 className="text-lg font-bold text-zinc-900">🛡️ 内容审核</h1>
      <p className="mt-0.5 text-xs text-zinc-400">
        用户举报队列 · 待处理按时间正序（先报先审）· 处置写审计（操作人 + 时间）
      </p>

      {/* AI 成本监控条（Phase 8：缓存命中率 + 在途并发；数据源 /api/admin/ai-stats） */}
      {aiStats && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[11px] text-zinc-500">
          <span className="font-semibold text-zinc-700">🤖 AI 成本</span>
          <span>
            缓存命中率{" "}
            <b className={aiStats.cache.hitRate >= 0.3 ? "text-green-600" : "text-amber-600"}>
              {(aiStats.cache.hitRate * 100).toFixed(1)}%
            </b>
          </span>
          <span>缓存条目 {aiStats.cache.entries}（命中 {aiStats.cache.hits} 次）</span>
          <span>待过期清理 {aiStats.cache.expired}</span>
          <span>
            在途并发 {aiStats.concurrency.inFlight}/{aiStats.concurrency.max}（本实例）
          </span>
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs"
        >
          <option value="pending">待处理</option>
          <option value="resolved">已确认违规</option>
          <option value="dismissed">已驳回</option>
          <option value="all">全部</option>
        </select>
        <span className="text-xs text-zinc-400">共 {total} 条</span>
      </div>

      <div className="mt-3">
        <Table head={["时间", "举报人", "举报对象", "原因", "详情", "状态", "操作"]}>
          {reports.map((r) => (
            <tr key={r.id}>
              <Td className="whitespace-nowrap text-[11px] text-zinc-500">
                {new Date(r.createdAt).toLocaleString("zh-CN", { hour12: false })}
              </Td>
              <Td className="max-w-[160px] truncate text-[11px]">{r.reporterEmail ?? "—"}</Td>
              <Td className="max-w-[180px]">
                <span className="mr-1">{TARGET_LABEL[r.targetType] ?? r.targetType}</span>
                <span className="font-mono text-[10px] text-zinc-400" title={r.targetId}>
                  {r.targetId.slice(0, 20)}
                </span>
              </Td>
              <Td>
                <Badge tone={r.reason === "illegal" || r.reason === "nsfw" ? "red" : "amber"}>
                  {REASON_LABEL[r.reason] ?? r.reason}
                </Badge>
              </Td>
              <Td className="max-w-[220px]">
                <p className="line-clamp-2 text-[11px] text-zinc-600">{r.detail ?? "—"}</p>
              </Td>
              <Td>
                {r.status === "pending" ? (
                  <Badge tone="amber">待处理</Badge>
                ) : r.status === "resolved" ? (
                  <Badge tone="red">已确认违规</Badge>
                ) : (
                  <Badge tone="green">已驳回</Badge>
                )}
              </Td>
              <Td className="whitespace-nowrap">
                {r.status === "pending" ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void patch(r, "resolve")}
                      className="rounded-full border border-red-200 px-2.5 py-1 text-[11px] text-red-600 hover:bg-red-50"
                    >
                      确认违规
                    </button>
                    <button
                      type="button"
                      onClick={() => void patch(r, "dismiss")}
                      className="ml-1.5 rounded-full border border-zinc-200 px-2.5 py-1 text-[11px] text-zinc-600 hover:bg-zinc-50"
                    >
                      驳回
                    </button>
                  </>
                ) : (
                  <span className="text-[10px] text-zinc-400">
                    {r.resolvedAt ? new Date(r.resolvedAt).toLocaleDateString("zh-CN") : "—"}
                  </span>
                )}
              </Td>
            </tr>
          ))}
          {reports.length === 0 && (
            <tr>
              <Td className="py-8 text-center text-xs text-zinc-400">
                暂无举报{status === "pending" ? "（队列已清空 🎉）" : ""}
              </Td>
            </tr>
          )}
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="mt-3 flex items-center gap-2 text-xs text-zinc-500">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-full border border-zinc-200 px-2.5 py-1 disabled:opacity-40"
          >
            上一页
          </button>
          <span>
            {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="rounded-full border border-zinc-200 px-2.5 py-1 disabled:opacity-40"
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}
