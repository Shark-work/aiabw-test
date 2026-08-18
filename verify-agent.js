// Live verification of the digital-human agent against https://www.aiabw.com
// A) /api/agent/memories/verify            -> dedup works on the live DB (2 similar -> 1 stored)
// B) /api/agent/post-to-social (no creds)  -> graceful 500 error, NO crash
// C) /api/agent/post-to-social (bad auth)  -> 401
// D) /api/agent/post-to-social (bad body)  -> 400
const fs = require("fs");
const path = require("path");

const BASE = "https://www.aiabw.com";
const env = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
const CRON_SECRET = (env.match(/^CRON_SECRET=(.*)$/m) || [])[1]?.trim() || "";

async function req(method, apiPath, body, token) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60000);
  try {
    const res = await fetch(BASE + apiPath, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, text };
  } finally { clearTimeout(t); }
}

const results = [];
function ok(cond, label, extra) {
  console.log((cond ? "PASS" : "FAIL") + "  " + label + (extra ? "  [" + extra + "]" : ""));
  results.push(cond);
}

(async () => {
  // A) memory self-test on the live DB: dedup + important flag + cross-day protection
  let r = await req("POST", "/api/agent/memories/verify", {}, CRON_SECRET);
  ok(
    r.status === 200 && r.json?.ok === true &&
      r.json?.dedupWorks === true &&
      r.json?.importantWorks === true &&
      r.json?.protectionWorks === true,
    "memory verify: dedup + important flag + cross-day protection all pass on live DB",
    "status=" + r.status + " msg=" + (r.json?.message ?? ""),
  );

  // B) post-to-social with missing credentials -> graceful 500, no crash
  r = await req("POST", "/api/agent/post-to-social", { platform: "x", text: "test post" }, CRON_SECRET);
  ok(
    r.status === 500 && r.json?.ok === false && typeof r.json?.error === "string" && r.json?.error.length > 0,
    "post-to-social missing credentials -> graceful 500 error (no crash)",
    "status=" + r.status + " error=" + (r.json?.error ?? "").slice(0, 80),
  );

  // C) post-to-social without CRON_SECRET -> 401
  r = await req("POST", "/api/agent/post-to-social", { platform: "x", text: "test" }, null);
  ok(r.status === 401, "post-to-social without auth -> 401", "status=" + r.status);

  // D) post-to-social with invalid platform -> 400
  r = await req("POST", "/api/agent/post-to-social", { platform: "weibo", text: "test" }, CRON_SECRET);
  ok(r.status === 400, "post-to-social invalid platform -> 400", "status=" + r.status);

  // E) unified memory API: GET list (auth) works on live
  r = await req("GET", "/api/agent/memories?limit=5", null, CRON_SECRET);
  ok(
    r.status === 200 && r.json?.ok === true && Array.isArray(r.json?.memories),
    "unified memory API: GET /api/agent/memories works (read-only, no pollution)",
    "status=" + r.status + " count=" + r.json?.count,
  );

  // F) unified memory API: bad action -> 400
  r = await req("POST", "/api/agent/memories", { action: "explode" }, CRON_SECRET);
  ok(r.status === 400, "unified memory API: unknown action -> 400", "status=" + r.status);

  // G) unified memory API: without auth -> 401
  r = await req("GET", "/api/agent/memories", null, null);
  ok(r.status === 401, "unified memory API: without auth -> 401", "status=" + r.status);

  console.log("----------------------------------");
  const passed = results.filter(Boolean).length;
  console.log(`SUMMARY: ${passed}/${results.length} passed (live=${BASE})`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error("FATAL: " + e.message); process.exit(2); });
