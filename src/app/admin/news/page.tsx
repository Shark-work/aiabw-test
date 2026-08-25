"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge, Table, Td } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";

type AdminNews = {
  id: number;
  source: string;
  title: string;
  hot: number;
  timestamp: number;
  status: string;
  pinned: boolean;
};

const PAGE_SIZE = 20;

/** 📰 内容/新闻管理：查看自动抓取列表 + 置顶 / 隐藏 / 删除。 */
export default function AdminNewsPage() {
  const { toast, toastsNode } = useToast();
  const [news, setNews] = useState<AdminNews[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    const token = localStorage.getItem("aiabw_token");
    const qs = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (status) qs.set("status", status);
    const d = await fetch(`/api/admin/news?${qs}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
    if (d?.ok) {
      setNews(d.news);
      setTotal(d.total);
    } else {
      toast.error(d?.error ?? "加载失败");
    }
  }, [page, status, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = async (n: AdminNews, body: Record<string, unknown>, successMsg: string) => {
    const token = localStorage.getItem("aiabw_token");
    const d = await fetch(`/api/admin/news/${n.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }).then((r) => r.json());
    if (d?.ok) {
      toast.success(successMsg);
      void load();
    } else {
      toast.error(d?.error ?? "操作失败");
    }
  };

  const remove = async (n: AdminNews) => {
    const token = localStorage.getItem("aiabw_token");
    const d = await fetch(`/api/admin/news/${n.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => r.json());
    if (d?.ok) {
      toast.success("已删除");
      void load();
    } else {
      toast.error(d?.error ?? "删除失败");
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      {toastsNode}
      <h1 className="text-lg font-bold text-zinc-900">📰 内容/新闻管理</h1>
      <p className="mt-0.5 text-xs text-zinc-400">自动抓取的动物新闻头条 · 支持置顶/隐藏/删除</p>

      <div className="mt-4 flex items-center gap-2">
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs"
        >
          <option value="">全部状态</option>
          <option value="visible">可见</option>
          <option value="hidden">已隐藏</option>
        </select>
        <span className="text-xs text-zinc-400">共 {total} 条</span>
      </div>

      <div className="mt-3">
        <Table head={["ID", "标题", "来源", "热度", "状态", "操作"]}>
          {news.map((n) => (
            <tr key={n.id}>
              <Td className="font-mono text-[11px]">{n.id}</Td>
              <Td className="max-w-[260px]">
                <p className="line-clamp-1 font-medium text-zinc-800">{n.title}</p>
              </Td>
              <Td className="text-[11px] text-zinc-500">{n.source}</Td>
              <Td className="font-semibold text-orange-600">{n.hot.toFixed(1)}</Td>
              <Td>
                {n.pinned && <Badge tone="amber">置顶</Badge>}
                {n.status === "visible" ? <Badge tone="green">可见</Badge> : <Badge tone="red">隐藏</Badge>}
              </Td>
              <Td className="whitespace-nowrap">
                <button
                  type="button"
                  onClick={() => void patch(n, { pinned: !n.pinned }, n.pinned ? "已取消置顶" : "已置顶")}
                  className="rounded-full border border-zinc-200 px-2.5 py-1 text-[11px] text-zinc-600 hover:bg-zinc-50"
                >
                  {n.pinned ? "取消置顶" : "置顶"}
                </button>
                <button
                  type="button"
                  onClick={() => void patch(n, { status: n.status === "visible" ? "hidden" : "visible" }, n.status === "visible" ? "已隐藏" : "已恢复可见")}
                  className="ml-1.5 rounded-full border border-zinc-200 px-2.5 py-1 text-[11px] text-zinc-600 hover:bg-zinc-50"
                >
                  {n.status === "visible" ? "隐藏" : "恢复"}
                </button>
                <button
                  type="button"
                  onClick={() => void remove(n)}
                  className="ml-1.5 rounded-full border border-red-200 px-2.5 py-1 text-[11px] text-red-600 hover:bg-red-50"
                >
                  删除
                </button>
              </Td>
            </tr>
          ))}
        </Table>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
        <span>
          第 {page} / {totalPages} 页
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-lg border border-zinc-200 px-3 py-1 disabled:opacity-40"
          >
            ← 上一页
          </button>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-lg border border-zinc-200 px-3 py-1 disabled:opacity-40"
          >
            下一页 →
          </button>
        </div>
      </div>
    </div>
  );
}
