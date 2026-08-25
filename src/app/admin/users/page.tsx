"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge, Table, Td } from "@/components/ui/table";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

type AdminUser = {
  id: string;
  email: string;
  points: number;
  role: string;
  createdAt: string;
  petCount: number;
};

const PAGE_SIZE = 15;

/** 👥 用户管理：列表 + 手动加减积分 + 发放稀有宠物。 */
export default function AdminUsersPage() {
  const { toast, toastsNode } = useToast();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<AdminUser | null>(null);
  const [delta, setDelta] = useState("");
  const [grantOpen, setGrantOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const token = localStorage.getItem("aiabw_token");
    setLoading(true);
    try {
      const d = await fetch(`/api/admin/users?page=${page}&pageSize=${PAGE_SIZE}`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.json());
      if (d?.ok) {
        setUsers(d.users);
        setTotal(d.total);
      } else {
        toast.error(d?.error ?? "加载失败");
      }
    } catch {
      toast.error("网络错误");
    } finally {
      setLoading(false);
    }
  }, [page, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const applyPoints = async () => {
    if (!target) return;
    const n = Number(delta);
    if (!Number.isFinite(n) || n === 0) {
      toast.error("请输入非零整数积分");
      return;
    }
    const token = localStorage.getItem("aiabw_token");
    setBusy(true);
    try {
      const d = await fetch(`/api/admin/users/${target.id}/points`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ delta: n, reason: "admin-manual" }),
      }).then((r) => r.json());
      if (d?.ok) {
        toast.success(`已调整积分，当前 ${d.points}`);
        setTarget(null);
        setDelta("");
        void load();
      } else {
        toast.error(d?.error ?? "调整失败");
      }
    } catch {
      toast.error("网络错误");
    } finally {
      setBusy(false);
    }
  };

  const grantPet = async () => {
    if (!target) return;
    const token = localStorage.getItem("aiabw_token");
    setBusy(true);
    try {
      const d = await fetch(`/api/admin/users/${target.id}/grant-pet`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ rarity: "rare" }),
      }).then((r) => r.json());
      if (d?.ok) {
        toast.success(`已发放稀有宠物 ${d.petId}`);
        setGrantOpen(false);
        void load();
      } else {
        toast.error(d?.error ?? "发放失败");
      }
    } catch {
      toast.error("网络错误");
    } finally {
      setBusy(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <div>
      {toastsNode}
      <h1 className="text-lg font-bold text-zinc-900">👥 用户管理</h1>
      <p className="mt-0.5 text-xs text-zinc-400">
        共 {total} 位用户 · 支持积分调整与稀有宠物发放
        {loading && <span className="ml-2 text-zinc-400">加载中…</span>}
      </p>

      <div className="mt-4">
        <Table head={["邮箱", "角色", "宠物数", "积分", "注册时间", "操作"]}>
          {users.map((u) => (
            <tr key={u.id}>
              <Td className="font-mono text-[11px]">{u.email}</Td>
              <Td>
                {u.role === "admin" ? <Badge tone="violet">管理员</Badge> : <Badge tone="zinc">用户</Badge>}
              </Td>
              <Td>{u.petCount}</Td>
              <Td className="font-semibold text-orange-600">{u.points}</Td>
              <Td className="text-[11px] text-zinc-500">{new Date(u.createdAt).toLocaleString("zh-CN")}</Td>
              <Td className="whitespace-nowrap">
                <button
                  type="button"
                  onClick={() => {
                    setTarget(u);
                    setDelta("");
                  }}
                  className="rounded-full border border-zinc-200 px-2.5 py-1 text-[11px] text-zinc-600 hover:bg-zinc-50"
                >
                  调积分
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTarget(u);
                    setGrantOpen(true);
                  }}
                  className="ml-1.5 rounded-full border border-amber-200 px-2.5 py-1 text-[11px] text-amber-700 hover:bg-amber-50"
                >
                  发宠物
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

      {/* 调积分 */}
      <Dialog open={!!target && !grantOpen} title={`调整积分 · ${target?.email ?? ""}`} onClose={() => setTarget(null)}>
        <div className="space-y-3">
          <p className="text-xs text-zinc-500">
            当前积分：<span className="font-semibold text-orange-600">{target?.points}</span>（正数增加 / 负数扣除）
          </p>
          <input
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
            placeholder="如 100 或 -50"
            type="number"
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-xs"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setTarget(null)}
              className="rounded-full border border-zinc-200 px-4 py-1.5 text-xs text-zinc-600"
            >
              取消
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void applyPoints()}
              className="rounded-full bg-orange-500 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {busy ? "处理中…" : "确认调整"}
            </button>
          </div>
        </div>
      </Dialog>

      {/* 发宠物 */}
      <Dialog open={grantOpen} title={`发放稀有宠物 · ${target?.email ?? ""}`} onClose={() => setGrantOpen(false)}>
        <div className="space-y-3">
          <p className="text-xs text-zinc-500">为活动奖励 / 客诉补偿发放一只稀有宠物（rare 及以上）。</p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setGrantOpen(false)}
              className="rounded-full border border-zinc-200 px-4 py-1.5 text-xs text-zinc-600"
            >
              取消
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void grantPet()}
              className="rounded-full bg-amber-500 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {busy ? "发放中…" : "确认发放"}
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

