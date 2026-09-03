// PWA 端点验证（对本地生产服务器 `npm run start`）：
//  manifest 路由与字段、PNG 图标、sw.js 缓存策略、页面 <link> 注入。
// Usage: node scripts/verify-pwa.cjs http://localhost:3000
const BASE = process.argv[2] || "http://localhost:3000";

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) {
    pass++;
    console.log("  PASS " + label);
  } else {
    fail++;
    console.log("  FAIL " + label);
  }
}

(async () => {
  // ---- 1) manifest 路由与字段 ----
  const m = await fetch(`${BASE}/manifest.webmanifest`);
  const mj = await m.json().catch(() => null);
  ok(m.status === 200 && !!mj, "/manifest.webmanifest 200 且为 JSON");
  ok(!!mj && mj.name && mj.name.includes("艾比世界"), "manifest.name 含「艾比世界」");
  ok(!!mj && mj.display === "standalone", "display: standalone");
  ok(!!mj && mj.start_url === "/", "start_url: /");
  ok(
    !!mj && (mj.icons || []).some((i) => i.purpose === "maskable"),
    "含 maskable 图标",
  );

  // ---- 2) PNG 图标全部可访问 ----
  for (const p of [
    "/icons/icon-192.png",
    "/icons/icon-512.png",
    "/icons/icon-maskable-192.png",
    "/icons/icon-maskable-512.png",
    "/apple-icon.png",
  ]) {
    const r = await fetch(BASE + p);
    ok(
      r.status === 200 && (r.headers.get("content-type") || "").includes("image/png"),
      p + " 200 image/png",
    );
  }

  // ---- 3) sw.js：push 保留 + 离线缓存策略 ----
  const sw = await (await fetch(`${BASE}/sw.js`)).text();
  ok(sw.includes('addEventListener("fetch"'), "sw.js 含 fetch 离线缓存");
  ok(sw.includes('"push"'), "sw.js 保留 Web Push");
  ok(sw.includes('startsWith("/api/")'), "sw.js 不拦截/缓存 /api（防宠物状态陈旧）");
  ok(sw.includes("OFFLINE_HTML"), "sw.js 含断网导航兜底页");

  // ---- 4) 页面注入 manifest / apple-touch-icon ----
  const html = await (await fetch(`${BASE}/zh`)).text();
  ok(/<link[^>]+rel="manifest"/.test(html), "/zh 注入 <link rel=manifest>");
  ok(/<link[^>]+rel="apple-touch-icon"/.test(html), "/zh 注入 <link rel=apple-touch-icon>");
  ok(html.includes("艾比世界"), "/zh 页面正常渲染");

  console.log(`\nPWA checks: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error("verify-pwa 执行异常:", e);
  process.exit(1);
});
