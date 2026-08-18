"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Link, useRouter } from "@/i18n/navigation";
import { getAnonymousId } from "@/lib/anon-id";

export default function RegisterPage() {
  const router = useRouter();
  const t = useTranslations("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError(t("mismatch"));
      return;
    }
    setLoading(true);
    try {
      // 邀请码：来自 ？ref= 参数（好友分享的注册链接）；deviceId 用于防刷
      const ref = new URLSearchParams(window.location.search).get("ref") || "";
      const body: Record<string, unknown> = { email, password };
      if (ref) body.ref = ref;
      const anonymousId = getAnonymousId();
      if (anonymousId) body.deviceId = anonymousId;
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || t("failed"));
      }
      localStorage.setItem("aiabw_token", data.token);

      // 游客数据迁移：后台异步执行，不阻塞跳转（提升注册体验）
      if (anonymousId) {
        void (async () => {
          try {
            const migRes = await fetch("/api/auth/migrate", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${data.token}`,
              },
              body: JSON.stringify({ anonymousId }),
            });
            if (migRes.ok) {
              const migData = await migRes.json().catch(() => null);
              const migrated = migData?.migrated;
              if (migrated && migrated.adoptions + migrated.threads > 0) {
                sessionStorage.setItem("aiabw_migrated_toast", "1");
              }
            }
          } catch {
            // 迁移失败不影响注册
          }
        })();
      }

      const redirect =
        new URLSearchParams(window.location.search).get("redirect") || "/";
      router.push(redirect);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failed"));
      setLoading(false);
    }
  };

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden p-4">
      <div
        aria-hidden
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url('/resources/background_clothing/bg1.png')" }}
      />
      <div aria-hidden className="absolute inset-0 bg-white/60" />

      <div className="relative z-10 w-full max-w-sm rounded-2xl border border-zinc-200 bg-white/90 p-6 shadow-lg backdrop-blur">
        <h1 className="text-center text-2xl font-semibold text-zinc-900">
          {t("title")}
        </h1>
        <p className="mt-1 text-center text-sm text-zinc-500">
          {t("subtitle")}
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="mb-1 block text-sm text-zinc-600">{t("email")}</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-200"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-zinc-600">{t("password")}</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("passwordPlaceholder")}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-200"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-zinc-600">{t("confirm")}</label>
            <input
              type="password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={t("confirmPlaceholder")}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-200"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full bg-orange-500 px-4 py-2.5 font-semibold text-white shadow transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? t("submitting") : t("submit")}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-zinc-500">
          {t("hasAccount")}{" "}
          <Link href="/login" className="font-medium text-orange-600 hover:underline">
            {t("signIn")}
          </Link>
        </p>
      </div>
    </main>
  );
}
