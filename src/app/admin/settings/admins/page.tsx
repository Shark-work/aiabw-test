"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge, Table, Td } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";

type AdminUser = {
  id: string;
  email: string;
  createdAt: string;
  lastLoginAt: string | null;
  locked: boolean;
};

/** 管理员管理：列表 + 修改密码 + 新增管理员（只有 admin 可访问，由 AdminShell 保障）。 */
export default function AdminSettingsAdminsPage() {
  const { toast, toastsNode } = useToast();
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"change" | "add">("change");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const token = localStorage.getItem("aiabw_token");
    setLoading(true);
    try {
      const d = await fetch("/api/admin/settings/admins", { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
      if (d?.ok) setAdmins(d.admins);
      else toast.error(d?.error ?? "加载失败");
    } catch {
      toast.error("网络错误");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const unlock = async (u: AdminUser) => {
    const token = localStorage.getItem("aiabw_token");
    const d = await fetch("/api/admin/users/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ userId: u.id }),
    }).then((r) => r.json());
    if (d?.ok) {
      toast.success(`已解锁 ${d.email}`);
      void load();
    } else {
      toast.error(d?.error ?? "解锁失败");
    }
  };

  const submit = async () => {
    if (!email || password.length < 6) {
      toast.error("请输入邮箱和至少 6 位密码");
      return;
    }
    const token = localStorage.getItem("aiabw_token");
    setBusy(true);
    try {
      const d = await fetch(mode === "change" ? "/api/admin/settings/change-password" : "/api/admin/settings/add-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(mode === "change" ? { email, newPassword: password } : { email, password }),
      }).then((r) => r.json());
      if (d?.ok) {
        toast.success(mode === "change" ? `密码已更新：${d.email}` : `已新增管理员：${d.email}`);
        setEmail("");
        setPassword("");
        void load();
      } else {
        toast.error(d?.error ?? "操作失败");
      }
    } catch {
      toast.error("网络错误");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {toastsNode}
      <h1 className="text-lg font-bold text-zinc-900">👑 管理员管理</h1>
      <p className="mt-0.5 text-xs text-zinc-400">仅限 admin 角色访问 · 禁止删除自己的管理员身份</p>

      {/* 管理员列表 */}
      <div className="mt-4">
        <Table head={["邮箱", "注册时间", "最后登录", "状态", "操作"]}>
          {admins.map((u) => (
            <tr key={u.id}>
              <Td className="font-mono text-[11px]">{u.email}</Td>
              <Td className="text-[11px] text-zinc-500">{new Date(u.createdAt).toLocaleString("zh-CN")}</Td>
              <Td className="text-[11px] text-zinc-500">
                {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString("zh-CN") : "从未登录"}
              </Td>
              <Td>{u.locked ? <Badge tone="red">已锁定</Badge> : <Badge tone="green">正常</Badge>}</Td>
              <Td>
                {u.locked && (
                  <button
                    type="button"
                    onClick={() => void unlock(u)}
                    className="rounded-full border border-amber-200 px-2.5 py-1 text-[11px] text-amber-700 hover:bg-amber-50"
                  >
                    解锁
                  </button>
                )}
              </Td>
            </tr>
          ))}
        </Table>
        {loading && <p className="mt-2 text-xs text-zinc-400">加载中…</p>}
      </div>

      {/* 修改密码 / 新增管理员 */}
      <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMode("change")}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${mode === "change" ? "bg-orange-500 text-white" : "bg-zinc-100 text-zinc-600"}`}
          >
            修改密码
          </button>
          <button
            type="button"
            onClick={() => setMode("add")}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${mode === "add" ? "bg-orange-500 text-white" : "bg-zinc-100 text-zinc-600"}`}
          >
            新增管理员
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="管理员邮箱"
            className="w-56 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs"
          />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="新密码（至少 6 位）"
            type="password"
            className="w-44 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit()}
            className="rounded-full bg-orange-500 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {busy ? "处理中…" : mode === "change" ? "确认修改" : "确认新增"}
          </button>
        </div>
      </div>
    </div>
  );
}
