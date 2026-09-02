/* AIABW Web Push Service Worker（P2 召回）
 *  - push：            解析服务端 JSON 载荷并弹出系统通知
 *  - notificationclick：聚焦已打开的窗口，否则打开落地页
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
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