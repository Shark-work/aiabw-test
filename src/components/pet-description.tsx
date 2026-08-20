"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

type Props = {
  petId: string;
  /** 用户自定义介绍；NULL = 使用默认介绍 */
  customDescription: string | null;
  /** 基于“宠物字典 + Traits”生成的默认介绍 */
  defaultDescription: string;
  /** 是否当前用户拥有（拥有才可编辑） */
  owned: boolean;
  /** 保存成功后的回调（更新父级状态） */
  onSaved?: (customDescription: string | null) => void;
};

const MAX_LEN = 50;

/**
 * 宠物介绍 + 行内编辑：
 *  - 展示：custom_description 有值 → 用户写的；NULL → 字典默认介绍（带“默认”标记）；
 *  - 编辑：点击 ✏️ 原地展开 textarea（不跳页），右下角实时 12/50；
 *  - Enter 保存，Esc 取消；清空保存 = 恢复默认（custom_description 置 NULL）。
 */
export function PetDescription({
  petId,
  customDescription,
  defaultDescription,
  owned,
  onSaved,
}: Props) {
  const t = useTranslations("pets");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const showing = customDescription ?? defaultDescription;
  const isDefault = customDescription === null;

  useEffect(() => {
    if (editing) {
      setDraft(customDescription ?? "");
      setError("");
      inputRef.current?.focus();
    }
  }, [editing, customDescription]);

  const save = async () => {
    const token = localStorage.getItem("aiabw_token");
    if (!token) return;
    setSaving(true);
    setError("");
    try {
      // petId 形如 "#3D8B59"，# 在 URL 中是 fragment 分隔符，必须编码
      const res = await fetch(`/api/pets/${encodeURIComponent(petId)}/description`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ description: draft }),
      });
      const data = await res.json();
      if (res.ok && data?.ok) {
        onSaved?.(data.customDescription);
        setEditing(false);
      } else {
        setError(data?.error ?? t("saveFailed"));
      }
    } catch {
      setError(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className="group relative rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
        <p className="text-sm leading-relaxed text-zinc-700">{showing}</p>
        <div className="mt-1 flex items-center gap-2">
          {isDefault && (
            <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] text-zinc-500">
              {t("defaultDescription")}
            </span>
          )}
          {owned && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label={t("editDescription")}
              className="text-xs text-zinc-400 opacity-0 transition group-hover:opacity-100 hover:text-orange-500"
            >
              ✏️ {t("edit")}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-orange-300 bg-orange-50/60 px-3 py-2">
      <textarea
        ref={inputRef}
        value={draft}
        maxLength={MAX_LEN}
        rows={2}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void save();
          } else if (e.key === "Escape") {
            setEditing(false);
          }
        }}
        placeholder={t("descriptionPlaceholder")}
        className="w-full resize-none rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-200"
      />
      <div className="mt-1 flex items-center justify-between">
        <span className="text-xs text-zinc-400">
          {draft.length}/{MAX_LEN}
          {draft.length === 0 && <span className="ml-1 text-zinc-500">{t("emptyRestoresDefault")}</span>}
          {error && <span className="ml-1 text-red-500">{error}</span>}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded-full px-3 py-1 text-xs text-zinc-500 hover:bg-zinc-100"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="rounded-full bg-orange-500 px-3 py-1 text-xs font-medium text-white hover:bg-orange-600 disabled:opacity-60"
          >
            {saving ? t("saving") : t("save")}
          </button>
        </div>
      </div>
    </div>
  );
}
