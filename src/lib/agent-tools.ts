import { tool, zodSchema } from "ai";
import { z } from "zod";

/**
 * Mock weather tool. In production, swap for a real weather API
 * (OpenWeather, WeatherAPI, etc.) and do not log user-sensitive data.
 */
export const getWeather = tool({
  description:
    "Get the current weather for a given city. Returns temperature, condition, and humidity.",
  inputSchema: zodSchema(
    z.object({
      city: z.string().describe("The city name, e.g. 'Tokyo' or 'Paris'"),
    }),
  ),
  execute: async ({ city }) => {
    const MOCK: Record<string, { tempC: number; condition: string; humidity: number }> = {
      tokyo: { tempC: 18, condition: "Partly Cloudy", humidity: 62 },
      paris: { tempC: 12, condition: "Light Rain", humidity: 78 },
      "new york": { tempC: 9, condition: "Clear", humidity: 45 },
      london: { tempC: 10, condition: "Overcast", humidity: 70 },
      bengaluru: { tempC: 26, condition: "Sunny", humidity: 55 },
    };
    const key = city.trim().toLowerCase();
    const data = MOCK[key] ?? { tempC: 21, condition: "Clear", humidity: 50 };
    return {
      city,
      temperatureC: data.tempC,
      condition: data.condition,
      humidity: data.humidity,
      source: "mock_weather_api",
    };
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

/**
 * Mock web search tool. Returns canned snippets per query topic.
 * Swap for Tavily, Brave, SerpAPI, or Bing in production.
 */
export const webSearch = tool({
  description:
    "Search the web and return a list of result snippets. Use for recent news, docs, or facts beyond the model's training.",
  inputSchema: zodSchema(
    z.object({
      query: z.string().describe("The search query"),
    }),
  ),
  execute: async ({ query }) => {
    const snippets = [
      {
        title: `Overview: ${query}`,
        url: `https://example.com/overview?q=${encodeURIComponent(query)}`,
        snippet: `A concise overview covering the core ideas and current state of "${query}".`,
      },
      {
        title: `Latest updates on ${query}`,
        url: `https://example.com/news?q=${encodeURIComponent(query)}`,
        snippet: `Recent developments, releases, and community discussion related to "${query}".`,
      },
      {
        title: `Deep dive: ${query}`,
        url: `https://example.com/guide?q=${encodeURIComponent(query)}`,
        snippet: `A step-by-step guide with examples, tradeoffs, and practical tips for "${query}".`,
      },
    ];
    return { query, results: snippets, source: "mock_search_api" };
  },
});

export const agentTools = {
  get_weather: getWeather,
  calculator,
  web_search: webSearch,
};