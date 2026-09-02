"use client";

import { useLocale, useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { LivingPet } from "@/components/LivingPet";
import { getRarityMeta } from "@/lib/pet-status";
import { buildInteractSuggestions } from "@/lib/species-prompt";

export type KnowledgePet = {
  id: string;
  speciesId: string;
  speciesName: string;
  category?: string;
  habitat?: string | null;
  imageUrl: string;
  traits: { element?: string; rarity?: string; personality?: string; [k: string]: unknown };
  defaultDescription: string;
  /** 领养成功后传入：可跳转专属 AI 对话 */
  threadId?: string | null;
  adoptionId?: string | null;
  /** 游客领养（anonymousId 设备暂存）：展示「登录云同步」CTA 而非直接进聊天 */
  guest?: boolean;
};

/**
 * 宠物知识百科弹窗（领养成功后弹出）：
 *  - 真实物种介绍（来自 pet_dictionary，非虚构设定）；
 *  - AI 性格标签（元素 / 稀有度 / 性格）；
 *  - 「如何与它互动」话题建议（基于性格生成）；
 *  - 领养后可直接进入专属 AI 对话（System Prompt 由该物种动态构建）。
 */
export function PetKnowledgeModal({
  pet,
  onClose,
  onGoChat,
}: {
  pet: KnowledgePet;
  onClose: () => void;
  onGoChat?: (threadId: string, adoptionId: string) => void;
}) {
  const t = useTranslations("petsCatalog");
  const locale = useLocale() as "zh" | "en";
  const meta = getRarityMeta(String(pet.traits.rarity ?? "common"));
  const trait = String(pet.traits.personality ?? (locale === "en" ? "friendly" : "温柔"));
  const element = String(pet.traits.element ?? "?");
  const suggestions = buildInteractSuggestions(
    trait,
    element,
    locale,
  );

  const canChat = !!pet.threadId && !!pet.adoptionId;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-900/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-2xl border border-orange-200 bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部：大图 + 名称 + 稀有度 */}
        <div className="flex items-center gap-4">
          <LivingPet
            src={pet.imageUrl}
            alt={pet.speciesName}
            className="h-16 w-16 shrink-0 rounded-2xl border-2 border-orange-200 bg-orange-50 object-cover shadow"
          />
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-zinc-900">{t("knowledgeTitle")}</h3>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <span className="font-semibold text-zinc-700">{pet.speciesName}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.badgeClass}`}>
                {meta.emoji} {locale === "en" ? meta.labelEn : meta.labelZh}
              </span>
            </div>
          </div>
        </div>

        {/* 真实物种百科 */}
        <section className="mt-4 rounded-xl border border-zinc-100 bg-orange-50/50 p-3">
          <h4 className="text-xs font-bold text-orange-700">📖 {t("knowledgeSpecies")}</h4>
          <p className="mt-1 text-xs leading-relaxed text-zinc-600">{pet.defaultDescription}</p>
          {pet.habitat ? (
            <p className="mt-1 text-[11px] text-zinc-400">
              🏞️ {t("knowledgeHabitat")}：{pet.habitat}
            </p>
          ) : null}
        </section>

        {/* AI 性格标签 */}
        <section className="mt-3 rounded-xl border border-zinc-100 bg-violet-50/50 p-3">
          <h4 className="text-xs font-bold text-violet-700">✨ {t("knowledgeTraits")}</h4>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-700">
              ❤️ {trait}
            </span>
            <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-700">
              ⚡ {element}
            </span>
            <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-700">
              {meta.emoji} {locale === "en" ? meta.labelEn : meta.labelZh}
            </span>
          </div>
        </section>

        {/* 如何与它互动 */}
        <section className="mt-3 rounded-xl border border-zinc-100 bg-sky-50/50 p-3">
          <h4 className="text-xs font-bold text-sky-700">💬 {t("knowledgeInteract")}</h4>
          <p className="mt-1 text-[11px] text-zinc-400">{t("interactSay")}：</p>
          <ul className="mt-1 space-y-1">
            {suggestions.map((s, i) => (
              <li
                key={i}
                className="rounded-lg bg-white px-2 py-1.5 text-xs text-zinc-600"
              >
                {s}
              </li>
            ))}
          </ul>
        </section>

        {/* 操作 */}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-full bg-zinc-100 px-4 py-2.5 text-sm text-zinc-600 transition hover:bg-zinc-200"
          >
            {t("knowledgeLater")}
          </button>
          {pet.guest ? (
            /* 游客领养：宠物已存到本设备，登录仅在需要云同步 / AI 对话时引导 */
            <Link
              href="/login"
              className="flex-1 rounded-full bg-orange-500 px-4 py-2.5 text-center text-sm font-semibold text-white shadow transition hover:bg-orange-600"
            >
              {t("loginToChat")}
            </Link>
          ) : canChat ? (
            <button
              type="button"
              onClick={() => onGoChat?.(pet.threadId as string, pet.adoptionId as string)}
              className="flex-1 rounded-full bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white shadow transition hover:bg-orange-600"
            >
              {t("goChat")}
            </button>
          ) : null}
        </div>
        {pet.guest && <p className="mt-2 text-center text-[11px] text-zinc-400">{t("guestSavedHint")}</p>}
      </div>
    </div>
  );
}
