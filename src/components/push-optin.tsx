"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { getAnonymousId } from "@/lib/anon-id";

/**
 * P2 Web Push 召回订阅入口（游客与登录用户均可用）：
 *  - 注册 /sw.js 并向浏览器申请通知权限；
 *  - 订阅成功后 POST /api/push/subscribe（游客带 anonymousId；登录后再次调用自动转绑账号）；
 *  - 未配置 VAPID（enabled=false）或浏览器不支持时自动隐藏（返回 null）。
 */
export function PushOptIn() {
  const t = useTranslations("push");
  const [state, setState] = useState<"loading" | "hidden" | "off" | "on" | "busy">(
    "loading",
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (
        typeof window === "undefined" ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      ) {
        if (!cancelled) setState("hidden");
        return;
      }
      try {
        const cfg = await fetch("/api/push/config").then((r) => r.json());
        if (!cfg?.enabled) {
          if (!cancelled) setState("hidden");
          return;
        }
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        if (!cancelled) setState(sub ? "on" : "off");
      } catch {
        if (!cancelled) setState("off");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const urlBase64ToUint8Array = (b64: string): Uint8Array => {
    const padding = "=".repeat((4 - (b64.length % 4)) % 4);
    const base64 = (b64 + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = window.atob(base64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  };

  const enable = async () => {
    setState("busy");
    try {
      const cfg = await fetch("/api/push/config").then((r) => r.json());
      if (!cfg?.enabled || !cfg.publicKey) {
        setState("hidden");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState("off");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(cfg.publicKey),
        });
      }
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscription: sub.toJSON(),
          anonymousId: getAnonymousId() || undefined,
        }),
      });
      setState("on");
    } catch {
      setState("off");
    }
  };

  const disable = async () => {
    setState("busy");
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState("off");
    } catch {
      setState("off");
    }
  };

  if (state === "hidden" || state === "loading") return null;

  const on = state === "on";

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sky-200 bg-gradient-to-r from-sky-50 to-cyan-50 p-4">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-sky-900">
          {on ? t("enabled") : t("title")}
        </p>
        <p className="mt-0.5 text-xs text-sky-700">{t("hint")}</p>
      </div>
      <button
        type="button"
        disabled={state === "busy"}
        onClick={() => (on ? void disable() : void enable())}
        className="rounded-full bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-sky-600 disabled:opacity-60"
      >
        {on ? t("disable") : t("enable")}
      </button>
    </div>
  );
}