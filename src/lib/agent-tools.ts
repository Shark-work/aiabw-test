import { tool, zodSchema } from "ai";
import { z } from "zod";

/**
 * Real-World Tools（真实世界工具）：
 *  - get_weather：天气查询。优先 OpenWeatherMap（配置 OPENWEATHER_API_KEY 时），
 *    否则回退 wttr.in 免费接口（无需 key，全球城市）。返回温度/天气状况/湿度。
 *  - web_search：联网搜索。使用 DuckDuckGo Instant Answer API（无需 key）。
 *    （如接入 Tavily/Brave/SerpAPI 可在此替换并读取对应环境变量）
 *  - calculator：数学计算。
 * 所有工具：8s 超时 + 异常容错，失败返回可读错误信息（由模型以宠物口吻转述），
 * 绝不抛出未捕获异常。
 */

const TIMEOUT_MS = 8_000;
const fetchWithTimeout = (url: string, init?: RequestInit) =>
  fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });

/** OpenWeatherMap API Key（可选，配置后优先使用）。 */
const openWeatherKey = () => process.env.OPENWEATHER_API_KEY ?? "";

async function fetchWeather(city: string): Promise<{
  city: string;
  temperatureC: number | null;
  condition: string;
  humidity: number | null;
  source: string;
}> {
  // ① OpenWeatherMap（免费层级，需 key）
  if (openWeatherKey()) {
    const url =
      `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}` +
      `&appid=${encodeURIComponent(openWeatherKey())}&units=metric`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`OpenWeather status ${res.status}`);
    const d = (await res.json()) as {
      name?: string;
      main?: { temp?: number; humidity?: number };
      weather?: Array<{ description?: string }>;
    };
    return {
      city: d.name ?? city,
      temperatureC: d.main?.temp ?? null,
      condition: d.weather?.[0]?.description ?? "unknown",
      humidity: d.main?.humidity ?? null,
      source: "openweathermap",
    };
  }
  // ② wttr.in 免费接口（无需 key）
  const res = await fetchWithTimeout(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
  if (!res.ok) throw new Error(`wttr.in status ${res.status}`);
  const d = (await res.json()) as {
    current_condition?: Array<{ temp_C?: string; humidity?: string; weatherDesc?: Array<{ value?: string }> }>;
    nearest_area?: Array<{ areaName?: Array<{ value?: string }> }>;
  };
  const cur = d.current_condition?.[0];
  const area = d.nearest_area?.[0];
  return {
    city: area?.areaName?.[0]?.value ?? city,
    temperatureC: cur?.temp_C ? Number(cur.temp_C) : null,
    condition: cur?.weatherDesc?.[0]?.value ?? "unknown",
    humidity: cur?.humidity ? Number(cur.humidity) : null,
    source: "wttr.in",
  };
}

export const getWeather = tool({
  description:
    "Get the current weather for a given city (real-time, real data). Returns temperature (°C), condition, and humidity. Use when the user asks about today's weather or forecasts for a specific place.",
  inputSchema: zodSchema(
    z.object({
      city: z.string().describe("The city name, e.g. 'Shenzhen', 'Beijing' or 'Tokyo'"),
    }),
  ),
  execute: async ({ city }) => {
    try {
      return await fetchWeather(city.trim() || "Shenzhen");
    } catch (err) {
      return {
        city,
        error: err instanceof Error ? err.message : "weather service unavailable",
      };
    }
  },
});

/**
 * Calculator tool. Parser is intentionally strict: accepts only digits,
 * whitespace, operators, parentheses, and decimal points.
 */
export const calculator = tool({
  description:
    "Evaluate a basic math expression. Supports + - * / % ** and parentheses. Example: '47 * 23'",
  inputSchema: zodSchema(
    z.object({
      expression: z
        .string()
        .describe("The arithmetic expression to evaluate, e.g. '47 * 23'"),
    }),
  ),
  execute: async ({ expression }) => {
    if (!/^[\d\s+\-*/%().]+$/.test(expression)) {
      return { error: "Invalid characters in expression", expression };
    }
    try {
      const fn = new Function(`return (${expression});`);
      const value = fn();
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return { error: "Expression did not yield a finite number", expression };
      }
      return { expression, result: value };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : "Evaluation failed",
        expression,
      };
    }
  },
});

/** DuckDuckGo Instant Answer API（无需 key；结果受限时提示模型无法检索到实时新闻）。 */
async function searchWeb(query: string) {
  const url =
    `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}` +
    `&format=json&no_html=1&skip_disambig=1`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`search status ${res.status}`);
  const d = (await res.json()) as {
    Heading?: string;
    AbstractText?: string;
    AbstractURL?: string;
    RelatedTopics?: Array<{ Text?: string; FirstURL?: string } | { Topics?: Array<{ Text?: string; FirstURL?: string }> }>;
  };
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  if (d.AbstractText) {
    results.push({
      title: d.Heading || query,
      url: d.AbstractURL || "",
      snippet: d.AbstractText,
    });
  }
  for (const raw of d.RelatedTopics ?? []) {
    const grouped = raw as { Topics?: Array<{ Text?: string; FirstURL?: string }> };
    if (Array.isArray(grouped.Topics)) {
      for (const sub of grouped.Topics) {
        if (sub.Text && results.length < 6) {
          results.push({ title: sub.Text.split(" - ")[0] || query, url: sub.FirstURL || "", snippet: sub.Text });
        }
      }
    } else {
      const single = raw as { Text?: string; FirstURL?: string };
      if (single.Text && results.length < 6) {
        results.push({ title: single.Text.split(" - ")[0] || query, url: single.FirstURL || "", snippet: single.Text });
      }
    }
  }
  return { query, results, source: "duckduckgo" };
}

export const webSearch = tool({
  description:
    "Search the web and return real result snippets. Use for recent news, events, docs or facts beyond the model's training. If the API returns no results, honestly tell the user you could not fetch it.",
  inputSchema: zodSchema(
    z.object({
      query: z.string().describe("The web search query"),
    }),
  ),
  execute: async ({ query }) => {
    try {
      const r = await searchWeb(query);
      if (r.results.length === 0) {
        return { ...r, note: "no_results" };
      }
      return r;
    } catch (err) {
      return {
        query,
        results: [],
        error: err instanceof Error ? err.message : "search service unavailable",
      };
    }
  },
});

export const agentTools = {
  get_weather: getWeather,
  calculator,
  web_search: webSearch,
};
