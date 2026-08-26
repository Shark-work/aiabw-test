import { test } from "node:test";
import assert from "node:assert/strict";
import { getWeather, webSearch, calculator } from "../src/lib/agent-tools.ts";

test("tools: getWeather parses wttr.in response (real fetch mocked)", async () => {
  const orig = global.fetch;
  global.fetch = async (url) => {
    assert.match(String(url), /wttr\.in/);
    return new Response(
      JSON.stringify({
        current_condition: [{ temp_C: "28", humidity: "65", weatherDesc: [{ value: "Sunny" }] }],
        nearest_area: [{ areaName: [{ value: "Shenzhen" }] }],
      }),
      { status: 200 },
    );
  };
  try {
    const r = await getWeather.execute({ city: "Shenzhen" });
    assert.equal(r.city, "Shenzhen");
    assert.equal(r.temperatureC, 28);
    assert.equal(r.condition, "Sunny");
    assert.equal(r.humidity, 65);
    assert.equal(r.source, "wttr.in");
  } finally {
    global.fetch = orig;
  }
});

test("tools: getWeather failure returns error (no throw)", async () => {
  const orig = global.fetch;
  global.fetch = async () => {
    throw new Error("weather timeout");
  };
  try {
    const r = await getWeather.execute({ city: "Beijing" });
    assert.ok("error" in r && r.error, "返回 error 字段");
    assert.match(String(r.error), /timeout/);
  } finally {
    global.fetch = orig;
  }
});

test("tools: webSearch parses DuckDuckGo response", async () => {
  const orig = global.fetch;
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        AbstractText: "AIABW is a virtual pet platform.",
        Heading: "AIABW",
        AbstractURL: "https://aiabw.com",
        RelatedTopics: [],
      }),
      { status: 200 },
    );
  try {
    const r = await webSearch.execute({ query: "AIABW" });
    assert.equal(r.results.length, 1);
    assert.ok(r.results[0].snippet.includes("virtual pet"));
    assert.equal(r.source, "duckduckgo");
  } finally {
    global.fetch = orig;
  }
});

test("tools: webSearch no results returns note", async () => {
  const orig = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({}), { status: 200 });
  try {
    const r = await webSearch.execute({ query: "zzzz_nonexistent_xyz" });
    assert.equal(r.results.length, 0);
    assert.equal(r.note, "no_results");
  } finally {
    global.fetch = orig;
  }
});

test("tools: calculator evaluates expression", async () => {
  const r = await calculator.execute({ expression: "47 * 23" });
  assert.equal(r.result, 1081);
});

test("tools: calculator rejects invalid chars", async () => {
  const r = await calculator.execute({ expression: "1 + eval(x)" });
  assert.ok("error" in r && r.error);
});
