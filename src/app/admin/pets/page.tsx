"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";

import { Badge, Table, Td } from "@/components/ui/table";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";

type AdminPet = {
  id: string;
  speciesId: string;
  speciesName: string;
  imageUrl: string;
  traits: { rarity?: string };
  generation: number;
  customDescription: string | null;
  visible: boolean;
  status: string;
  owned: boolean;
};

const PAGE_SIZE = 15;

/** 🐾 宠物管理：分页 + 物种/稀有度筛选 + 编辑 + 上架/下架。 */
export default function AdminPetsPage() {
  const { toast, toastsNode } = useToast();
  const [pets, setPets] = useState<AdminPet[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [species, setSpecies] = useState("");
  const [rarity, setRarity] = useState("");
  const [loading, setLoading] = useState(true);
  const [editPet, setEditPet] = useState<AdminPet | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const token = localStorage.getItem("aiabw_token");
    const qs = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (species) qs.set("species", species);
    if (rarity) qs.set("rarity", rarity);
    setLoading(true);
    try {
      const d = await fetch(`/api/admin/pets?${qs}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
      if (d?.ok) {
        setPets(d.pets);
        setTotal(d.total);
      } else {
        toast.error(d?.error ?? "加载失败");
      }
    } catch {
      toast.error("网络错误");
    } finally {
      setLoading(false);
    }
  }, [page, species, rarity, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleVisible = async (p: AdminPet) => {
    const token = localStorage.getItem("aiabw_token");
    const d = await fetch(`/api/admin/pets/${encodeURIComponent(p.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ visible: !p.visible }),
    }).then((r) => r.json());
    if (d?.ok) {
      toast.success(p.visible ? "已下架（普通用户图鉴不可见）" : "已上架");
      void load();
    } else {
      toast.error(d?.error ?? "操作失败");
    }
  };

  const saveEdit = async () => {
    if (!editPet) return;
    const token = localStorage.getItem("aiabw_token");
    setSaving(true);
    try {
      const d = await fetch(`/api/admin/pets/${encodeURIComponent(editPet.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          customDescription: editPet.customDescription ?? "",
          imageUrl: editPet.imageUrl,
        }),
      }).then((r) => r.json());
      if (d?.ok) {
        toast.success("保存成功");
        setEditPet(null);
        void load();
      } else {
        toast.error(d?.error ?? "保存失败");
      }
    } catch {
      toast.error("网络错误");
    } finally {
      setSaving(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <div>
      {toastsNode}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-zinc-900">🐾 宠物管理</h1>
          <p className="mt-0.5 text-xs text-zinc-400">共 {total} 只 · 支持筛选与编辑</p>
        </div>
      </div>

      {/* 筛选器 */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          value={species}
          onChange={(e) => {
            setSpecies(e.target.value);
            setPage(1);
          }}
          placeholder="物种 ID（如 golden_retriever）"
          className="w-56 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs focus:border-orange-400 focus:outline-none"
        />
        <select
          value={rarity}
          onChange={(e) => {
            setRarity(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs"
        >
          <option value="">全部稀有度</option>
          {["common", "uncommon", "rare", "epic", "legendary"].map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        {loading && <span className="text-xs text-zinc-400">加载中…</span>}
      </div>

      {/* 列表 */}
      <div className="mt-3">
        <Table head={["ID", "物种", "稀有度", "图片", "描述", "状态", "操作"]}>
          {pets.map((p) => (
            <tr key={p.id}>
              <Td className="font-mono text-[11px]">{p.id}</Td>
              <Td>{p.speciesName}</Td>
              <Td>
                <Badge tone="violet">{p.traits.rarity ?? "?"}</Badge>
              </Td>
              <Td>
                <Image src={p.imageUrl} alt="" width={36} height={36} className="h-9 w-9 rounded object-cover" />
              </Td>
              <Td className="max-w-[220px] truncate text-[11px] text-zinc-500">
                {p.customDescription ?? "—"}
              </Td>
              <Td>
                {p.visible ? <Badge tone="green">上架</Badge> : <Badge tone="red">下架</Badge>}
                {p.owned && <Badge tone="amber">已持有</Badge>}
              </Td>
              <Td className="whitespace-nowrap">
                <button
                  type="button"
                  onClick={() => setEditPet(p)}
                  className="rounded-full border border-zinc-200 px-2.5 py-1 text-[11px] text-zinc-600 hover:bg-zinc-50"
                >
                  编辑
                </button>
                <button
                  type="button"
                  onClick={() => void toggleVisible(p)}
                  className="ml-1.5 rounded-full border px-2.5 py-1 text-[11px] hover:bg-zinc-50"
                >
                  {p.visible ? "下架" : "上架"}
                </button>
              </Td>
            </tr>
          ))}
        </Table>
      </div>

      {/* 分页 */}
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

      {/* 编辑弹窗 */}
      <Dialog open={!!editPet} title={`编辑宠物 ${editPet?.id ?? ""}`} onClose={() => setEditPet(null)}>
        {editPet && (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-zinc-500">图片 URL</label>
              <input
                value={editPet.imageUrl}
                onChange={(e) => setEditPet({ ...editPet, imageUrl: e.target.value })}
                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500">描述（custom_description）</label>
              <textarea
                value={editPet.customDescription ?? ""}
                onChange={(e) => setEditPet({ ...editPet, customDescription: e.target.value })}
                rows={3}
                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-xs"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setEditPet(null)}
                className="rounded-full border border-zinc-200 px-4 py-1.5 text-xs text-zinc-600"
              >
                取消
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void saveEdit()}
                className="rounded-full bg-orange-500 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                {saving ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}

