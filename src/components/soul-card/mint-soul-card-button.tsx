"use client";

/**
 * 铸造按钮：为指定宠物铸造灵魂卡（可选自定义卡名）。
 * 成功后回调 onMinted(card)；业务错误码（SOUL_CARD_EXISTS 等）内联展示。
 */

import { useState } from "react";
import { useTranslations } from "next-intl";

import type { MintablePetDto, SoulCardDto } from "./soul-card-types";

export function MintSoulCardButton({
  pet,
  locale,
  onMinted,
}: {
  pet: MintablePetDto;
  locale: string;
  onMinted: (card: SoulCardDto) => void;
}) {
  const t = useTranslations("soulCards");
  const [name, setName] = useState("");
  const [minting, setMinting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleMint() {
    if (minting) return;
    const token =
      typeof window !== "undefined" ? localStorage.getItem("aiabw_token") : null;
    if (!token) {
      setError(t("signInFirst"));
      return;
    }
    setMinting(true);
    setError(null);
    try {
      const res = await fetch("/api/soul-cards/mint", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "x-locale": locale,
        },
        body: JSON.stringify({ petId: pet.petId, name: name.trim() || undefined }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        card?: SoulCardDto;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.card) {
        setError(data.error ?? t("mintFailed"));
        return;
      }
      setName("");
      onMinted(data.card);
    } catch {
      setError(t("mintFailed"));
    } finally {
      setMinting(false);
    }
  }

  return (
    <div className="mt-2 space-y-1.5">
      <input
        type="text"
        value={name}
        maxLength={24}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("mint.namePlaceholder", {
          species: locale === "en" ? pet.speciesNameEn : pet.speciesNameZh,
        })}
        className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-orange-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      />
      <button
        type="button"
        onClick={handleMint}
        disabled={minting}
        className="w-full rounded-full bg-gradient-to-r from-orange-500 to-amber-500 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {minting ? t("mint.minting") : t("mint.button")}
      </button>
      {error ? (
        <p className="text-[11px] text-red-500 dark:text-red-400">{error}</p>
      ) : null}
    </div>
  );
}
