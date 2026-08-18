"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

/** 旧版「AI 工具诊断」表单，降级为次要功能（高级入口），保留原逻辑。 */
export function DiagnosticForm() {
  const t = useTranslations("diagnostic");
  const [coreNeed, setCoreNeed] = useState("");
  const [expectation, setExpectation] = useState("");
  const [skillLevel, setSkillLevel] = useState("");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setResult("");

    try {
      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          coreNeed,
          expectation,
          techLevel: skillLevel,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || t("failed"));
      }

      setResult(data.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {/* 核心诉求 */}
        <div className="space-y-2">
          <label
            htmlFor="core-need"
            className="block text-sm font-medium text-zinc-800"
          >
            {t("coreNeed")}
          </label>
          <select
            id="core-need"
            value={coreNeed}
            onChange={(e) => setCoreNeed(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
          >
            <option value="" disabled>
              {t("coreNeedSelect")}
            </option>
            <option value="code">{t("code")}</option>
            <option value="writing">{t("writing")}</option>
            <option value="data">{t("data")}</option>
            <option value="other">{t("other")}</option>
          </select>
        </div>

        {/* 期望程度 */}
        <fieldset className="space-y-2">
          <legend className="block text-sm font-medium text-zinc-800">
            {t("expectation")}
          </legend>
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
            {[
              { value: "idea", label: t("idea") },
              { value: "draft", label: t("draft") },
              { value: "auto", label: t("auto") },
            ].map((option) => (
              <label
                key={option.value}
                className={`flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm transition ${
                  expectation === option.value
                    ? "border-orange-500 bg-orange-50 text-orange-700"
                    : "border-zinc-300 bg-white text-zinc-700 hover:border-orange-300"
                }`}
              >
                <input
                  type="radio"
                  name="expectation"
                  value={option.value}
                  checked={expectation === option.value}
                  onChange={() => setExpectation(option.value)}
                  className="sr-only"
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>

        {/* 技术基础 */}
        <fieldset className="space-y-2">
          <legend className="block text-sm font-medium text-zinc-800">
            {t("techLevel")}
          </legend>
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
            {[
              { value: "beginner", label: t("beginner") },
              { value: "basic", label: t("basic") },
              { value: "expert", label: t("expert") },
            ].map((option) => (
              <label
                key={option.value}
                className={`flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm transition ${
                  skillLevel === option.value
                    ? "border-orange-500 bg-orange-50 text-orange-700"
                    : "border-zinc-300 bg-white text-zinc-700 hover:border-orange-300"
                }`}
              >
                <input
                  type="radio"
                  name="skillLevel"
                  value={option.value}
                  checked={skillLevel === option.value}
                  onChange={() => setSkillLevel(option.value)}
                  className="sr-only"
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>

        {/* 提交按钮 */}
        <button
          type="submit"
          className="w-full rounded-lg bg-orange-500 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-600 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 active:scale-95"
          disabled={!coreNeed || !expectation || !skillLevel || loading}
        >
          {loading ? t("submitting") : t("submit")}
        </button>
      </form>

      {/* 推荐结果 */}
      {(result || error || loading) && (
        <div className="mt-6 rounded-2xl border border-zinc-200 bg-white/80 p-6 shadow-sm backdrop-blur">
          {loading && (
            <div className="flex items-center justify-center gap-3 py-4 text-sm text-zinc-600">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
              {t("analyzing")}
            </div>
          )}

          {error && !loading && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          )}

          {result && !loading && (
            <div className="animate-in slide-in-from-bottom-4 fade-in duration-500 space-y-3">
              <h2 className="text-lg font-semibold text-zinc-900">
                {t("resultTitle")}
              </h2>
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700">
                {result}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
