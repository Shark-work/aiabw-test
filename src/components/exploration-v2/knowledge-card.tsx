"use client";

/**
 * 探索 v2 · 动物知识卡（Modal）
 */

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { X, MapPin, Heart, Utensils, Sparkles, Clock, Weight } from "lucide-react";

export type KnowledgeCardData = {
  id: string;
  species: string;
  category: string;
  origin: string | null;
  lifespan: string | null;
  weight: string | null;
  traits: string[];
  funFacts: string[];
  habitat: string | null;
  diet: string | null;
  conservationStatus: string | null;
};

type Props = {
  knowledge: KnowledgeCardData | null;
  onClose: () => void;
};

export function KnowledgeCard({ knowledge, onClose }: Props) {
  const t = useTranslations("knowledge");

  useEffect(() => {
    if (!knowledge) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [knowledge, onClose]);

  if (!knowledge) return null;

  const hasField = (v: string | null | undefined) =>
    typeof v === "string" && v.trim().length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      data-testid="knowledge-card-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t("title")}
    >
      <div
        className="relative max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        data-testid="knowledge-card"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 rounded-full p-1.5 text-zinc-500 transition hover:bg-zinc-100"
          aria-label="close"
        >
          <X className="h-4 w-4" />
        </button>

        <header className="mb-3 flex items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-amber-100 to-pink-100 text-3xl">🐾</div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-bold text-zinc-900" data-testid="knowledge-species">
              {knowledge.species || knowledge.id}
            </h2>
            <p className="text-xs text-zinc-500">{knowledge.category}</p>
          </div>
        </header>

        {knowledge.traits.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5" data-testid="knowledge-traits">
            {knowledge.traits.map((trait, i) => (
              <span key={i} className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                #{trait}
              </span>
            ))}
          </div>
        )}

        <dl className="mb-3 grid grid-cols-1 gap-2 rounded-xl bg-zinc-50 p-3 text-xs">
          {hasField(knowledge.origin) && (
            <div className="flex items-start gap-2">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
              <div><dt className="font-semibold text-zinc-700">{t("origin")}</dt><dd className="text-zinc-600">{knowledge.origin}</dd></div>
            </div>
          )}
          {hasField(knowledge.lifespan) && (
            <div className="flex items-start gap-2">
              <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
              <div><dt className="font-semibold text-zinc-700">{t("lifespan")}</dt><dd className="text-zinc-600">{knowledge.lifespan}</dd></div>
            </div>
          )}
          {hasField(knowledge.weight) && (
            <div className="flex items-start gap-2">
              <Weight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
              <div><dt className="font-semibold text-zinc-700">{t("weight")}</dt><dd className="text-zinc-600">{knowledge.weight}</dd></div>
            </div>
          )}
          {hasField(knowledge.habitat) && (
            <div className="flex items-start gap-2">
              <Heart className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
              <div><dt className="font-semibold text-zinc-700">{t("habitat")}</dt><dd className="text-zinc-600">{knowledge.habitat}</dd></div>
            </div>
          )}
          {hasField(knowledge.diet) && (
            <div className="flex items-start gap-2">
              <Utensils className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
              <div><dt className="font-semibold text-zinc-700">{t("diet")}</dt><dd className="text-zinc-600">{knowledge.diet}</dd></div>
            </div>
          )}
          {hasField(knowledge.conservationStatus) && (
            <div className="flex items-start gap-2">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
              <div><dt className="font-semibold text-zinc-700">{t("conservation")}</dt><dd className="text-zinc-600">{knowledge.conservationStatus}</dd></div>
            </div>
          )}
        </dl>

        {knowledge.funFacts.length > 0 && (
          <section data-testid="knowledge-fun-facts">
            <h3 className="mb-2 text-sm font-semibold text-zinc-800">✨ {t("funFactsTitle")}</h3>
            <ul className="space-y-1.5 text-xs text-zinc-700">
              {knowledge.funFacts.map((fact, i) => (
                <li key={i} className="flex items-start gap-2 rounded-lg bg-amber-50 px-2.5 py-1.5">
                  <span className="text-amber-600">•</span>
                  <span>{fact}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

export default KnowledgeCard;
