import { NextResponse } from "next/server";

import { getUserFromRequest } from "@/lib/auth";
import { generateCached } from "@/lib/llm-fallback";
import { filterClean } from "@/lib/content-moderation";
import { apiError, resolveLocale } from "@/i18n/api-errors";

export const runtime = "nodejs";

/**
 * POST /api/onboarding/name-suggestions — 新手引导 Step 3「起名」AI 建议名
 * 请求体：{ speciesName?, category?, element? }（均为可选上下文，帮助生成更贴合的名字）
 * 响应：{ ok, names: string[3], source: "ai" | "fallback" }
 *  - LLM 链路（Phase 8）：generateCached 单点——相同物种上下文命中 ai_response_cache
 *    （TTL 7 天，起名是离散度低的 prompt，缓存收益高）+ 高峰并发限速 +
 *    跨 provider 自动降级（temperature 0.9 / maxOutputTokens 80，单次成本极低）；
 *  - LLM 失败/高峰占满/解析不足 3 个 → 本地预设池随机 3 个兜底（source='fallback'），
 *    保证引导流程永不被 AI 故障阻断；
 *  - 纯生成接口，除缓存行外不落库、无副作用。
 */

/** 本地预设名兜底池（zh/en 各 8 个，随机取 3）。 */
const FALLBACK_NAMES: Record<string, string[]> = {
  zh: ["布丁", "奶糖", "栗子", "团子", "星星", "可可", "雪球", "阿福"],
  en: ["Pudding", "Mochi", "Coco", "Biscuit", "Luna", "Pepper", "Sunny", "Noodle"],
};

const NAME_MAX_LEN = 12;

function pickFallback(locale: string): string[] {
  const pool = FALLBACK_NAMES[locale === "en" ? "en" : "zh"];
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 3);
}

/** 从 LLM 文本中解析名字候选：按行/逗号/顿号切分，去序号与引号，滤长度。 */
function parseNames(text: string): string[] {
  return text
    .split(/[\n,，、;；]/)
    .map((s) =>
      s
        .replace(/^\s*\d+[.、)]?\s*/, "")
        .replace(/^[\s"'「『]+|[\s"'」』。!.?？]+$/g, "")
        .trim(),
    )
    .filter((s) => s.length >= 1 && s.length <= NAME_MAX_LEN)
    .slice(0, 3);
}

export async function POST(req: Request) {
  const locale = resolveLocale(req);
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: apiError(locale, "signInFirst") },
      { status: 401 },
    );
  }
  const body = await req.json().catch(() => ({}));
  const speciesName =
    typeof body?.speciesName === "string" ? body.speciesName.trim() : "";
  const category =
    typeof body?.category === "string" ? body.category.trim() : "";
  const element =
    typeof body?.element === "string" ? body.element.trim() : "";

  const isEn = locale === "en";
  const ctx = [
    speciesName ? (isEn ? `species: ${speciesName}` : `物种：${speciesName}`) : "",
    category ? (isEn ? `category: ${category}` : `类别：${category}`) : "",
    element ? (isEn ? `element: ${element}` : `元素属性：${element}`) : "",
  ]
    .filter(Boolean)
    .join(isEn ? ", " : "，");

  try {
    const { text } = await generateCached({
      scope: "name-suggestions",
      cacheTtlDays: 7,
      system: isEn
        ? "You suggest cute pet names. Output exactly 3 names, one per line, no numbering, no explanations."
        : "你为灵宠建议可爱的名字。严格输出 3 个名字，每行一个，不要编号，不要任何解释。",
      prompt: isEn
        ? `Suggest 3 cute names (1-12 characters each) for a virtual pet${ctx ? ` (${ctx})` : ""}.`
        : `为一只灵宠起 3 个可爱的名字（每个 1-12 字）${ctx ? `，它的信息：${ctx}` : "。"}`,
      temperature: 0.9,
      maxOutputTokens: 80,
    });
    // Phase 8 输出审核：AI 生成名过敏感词过滤；过滤后不足 3 个 → 走预设池兜底
    const names = filterClean(parseNames(text ?? ""), (s) => s);
    if (names.length >= 3) {
      return NextResponse.json({ ok: true, names, source: "ai" });
    }
    // 解析不足 3 个（模型未按格式输出）→ 兜底池
    return NextResponse.json({
      ok: true,
      names: pickFallback(locale),
      source: "fallback",
    });
  } catch (err) {
    console.error("[onboarding/name-suggestions] LLM failed, fallback:", err);
    return NextResponse.json({
      ok: true,
      names: pickFallback(locale),
      source: "fallback",
    });
  }
}
