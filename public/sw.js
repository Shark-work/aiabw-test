/* AIABW Service Worker（PWA：Web Push 召回 + 离线缓存）
 *  - push：            解析服务端 JSON 载荷并弹出系统通知
 *  - notificationclick：聚焦已打开的窗口，否则打开落地页
 *  - fetch：           静态资源离线缓存（P2）
 *
 * 缓存策略（刻意保守，防止“陈旧的宠物/领养状态”回归）：
 *  - /api/*、所有 HTML 页面导航 —— 一律网络优先、绝不写缓存（本站全站动态渲染），
 *    仅在断网时导航回退到内置离线提示页；
 *  - /_next/static/*（带内容哈希）—— 缓存优先，永久复用；
 *  - /icons/*、/icon.svg、/manifest.webmanifest（自有静态资源）—— 缓存优先；
 *  - /images/*（public 图片，重发版可能同名更新）—— stale-while-revalidate。
 *
 * 发版更新缓存：改 CACHE_VERSION 即可，activate 时自动清掉旧版本缓存。
 */
const CACHE_VERSION = "aiabw-offline-v1";
const STATIC_CACHE = `${CACHE_VERSION}-static`;

/* 安装时预缓存：应用外壳最基础的静态资源（个别 404 不阻塞安装） */
const PRECACHE_URLS = [
  "/icon.svg",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }
  const title = (data && data.title) || "艾比世界";
  const options = {
    body: (data && data.body) || "",
    icon: (data && data.icon) || "/icon.svg",
    tag: (data && data.tag) || "aiabw-recall",
    data: { url: (data && data.url) || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(target) && "focus" in client) {
            return client.focus();
          }
        }
        return self.clients.openWindow(target);
      }),
  );
});

/* ============================ 离线缓存（P2） ============================ */

/* 断网时导航请求的兜底页（内联，不依赖缓存命中） */
const OFFLINE_HTML = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>离线了 - 艾比世界</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
    background:linear-gradient(135deg,#fff7ed,#ffe4e6);color:#431407;}
  .card{text-align:center;padding:40px 24px;max-width:420px;}
  .paw{font-size:64px;line-height:1;}
  h1{font-size:20px;margin:16px 0 8px;}
  p{font-size:14px;line-height:1.7;color:#7c2d12;margin:0 0 24px;}
  a{display:inline-block;padding:10px 28px;border-radius:9999px;text-decoration:none;
    color:#fff;background:linear-gradient(135deg,#fb923c,#f43f5e);font-size:14px;}
</style>
</head>
<body>
<div class="card">
  <div class="paw">🐾</div>
  <h1>艾比现在够不到你</h1>
  <p>网络连接似乎断开了。<br>你的宠物和聊天记录都好好的，恢复网络后再来看看它吧。</p>
  <a href="/">重新连接</a>
</div>
</body>
</html>`;

/** 缓存优先：命中直接返回；未命中则拉取并写入缓存（不可变资源）。 */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(STATIC_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

/** stale-while-revalidate：先回缓存（若有），后台静默更新。 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached || network || new Response("", { status: 504 });
}

/** 页面导航：网络优先；绝不缓存 HTML；断网回退离线提示页。 */
async function networkFirstNavigation(request) {
  try {
    return await fetch(request);
  } catch (e) {
    return new Response(OFFLINE_HTML, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  /* API 与其余动态请求：不拦截（绝不缓存，防止宠物/领养状态陈旧） */
  if (url.pathname.startsWith("/api/")) return;

  /* 带内容哈希的构建产物 + 自有静态图标/清单：缓存优先 */
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/icon.svg" ||
    url.pathname === "/manifest.webmanifest"
  ) {
    event.respondWith(cacheFirst(request).catch(() => new Response("", { status: 504 })));
    return;
  }

  /* public 图片（重发版可能同名更新）：stale-while-revalidate */
  if (url.pathname.startsWith("/images/")) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  /* 页面导航：网络优先 + 离线兜底页 */
  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
  }
});
