"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";

type Profile = { id: string; username: string; showInLeaderboard: boolean };

/**
 * 账号设置页（/settings）：
 *  - 公开昵称：站内唯一公开标识，可随时修改（唯一性/格式由服务端校验）；
 *  - 隐私设置：排行榜参与开关（默认参与；关闭 = opt-out，各榜单不再展示本人及其宠物）。
 * 页面不展示邮箱 —— 邮箱仅用于登录、找回与安全通知等后端用途。
 */
export default function SettingsPage() {
  const t = useTranslations("settings");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [username, setUsername] = useState("");
  const [showInLeaderboard, setShowInLeaderboard] = useState(true);
  const [loading, setLoading] = useState(true);
  const [needLogin, setNeedLogin] = useState(false);
  const [nameMsg, setNameMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [privacyMsg, setPrivacyMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [savingName, setSavingName] = useState(false);
  const [savingPrivacy, setSavingPrivacy] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("aiabw_token");
    if (!token) {
      setNeedLogin(true);
      setLoading(false);
      return;
    }
    fetch("/api/user/profile", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok && d.user) {
          setProfile(d.user as Profile);
          setUsername(d.user.username ?? "");
          setShowInLeaderboard(d.user.showInLeaderboard !== false);
        } else {
          localStorage.removeItem("aiabw_token");
          setNeedLogin(true);
        }
      })
      .catch(() => setNameMsg({ ok: false, text: t("loadFailed") }))
      .finally(() => setLoading(false));
  }, [t]);

  const patch = async (body: Record<string, unknown>): Promise<Profile> => {
    const token = localStorage.getItem("aiabw_token") ?? "";
    const res = await fetch("/api/user/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      throw new Error(typeof data?.error === "string" ? data.error : t("saveFailed"));
    }
    return data.user as Profile;
  };

  const saveUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingName(true);
    setNameMsg(null);
    try {
      const u = await patch({ username });
      setProfile(u);
      setUsername(u.username);
      setNameMsg({ ok: true, text: t("saved") });
    } catch (err) {
      setNameMsg({ ok: false, text: err instanceof Error ? err.message : t("saveFailed") });
    } finally {
      setSavingName(false);
    }
  };

  const toggleLeaderboard = async (next: boolean) => {
    setSavingPrivacy(true);
    setPrivacyMsg(null);
    const prev = showInLeaderboard;
    setShowInLeaderboard(next); // 乐观更新，失败回滚
    try {
      const u = await patch({ showInLeaderboard: next });
      setProfile(u);
      setShowInLeaderboard(u.showInLeaderboard !== false);
      setPrivacyMsg({ ok: true, text: t("saved") });
    } catch (err) {
      setShowInLeaderboard(prev);
      setPrivacyMsg({ ok: false, text: err instanceof Error ? err.message : t("saveFailed") });
    } finally {
      setSavingPrivacy(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-8">
      <h1 className="text-2xl font-bold text-zinc-900">⚙️ {t("title")}</h1>
      <p className="mt-1 text-sm text-zinc-500">{t("subtitle")}</p>

      {loading && <p className="mt-8 text-center text-sm text-zinc-400">{t("loading")}</p>}

      {!loading && needLogin && (
        <p className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-6 text-center text-sm text-amber-700">
          {t("loginRequired")}{" "}
          <Link href="/login" className="font-semibold text-orange-600 hover:underline">
            →
          </Link>
        </p>
      )}

      {!loading && profile && (
        <div className="mt-6 space-y-5">
          {/* 公开昵称 */}
          <section className="rounded-2xl border border-zinc-200 bg-white/90 p-5 shadow-sm">
            <h2 className="text-sm font-bold text-zinc-800">🏷️ {t("usernameTitle")}</h2>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">{t("usernameDesc")}</p>
            <form onSubmit={saveUsername} className="mt-3 flex items-center gap-2">
              <input
                type="text"
                required
                minLength={2}
                maxLength={24}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-200"
              />
              <button
                type="submit"
                disabled={savingName || username.trim() === profile.username}
                className="shrink-0 rounded-full bg-orange-500 px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingName ? t("saving") : t("save")}
              </button>
            </form>
            {nameMsg && (
              <p className={`mt-2 text-xs ${nameMsg.ok ? "text-emerald-600" : "text-red-600"}`}>
                {nameMsg.text}
              </p>
            )}
          </section>

          {/* 隐私设置 */}
          <section className="rounded-2xl border border-zinc-200 bg-white/90 p-5 shadow-sm">
            <h2 className="text-sm font-bold text-zinc-800">🔒 {t("privacyTitle")}</h2>
            <div className="mt-3 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-zinc-700">{t("leaderboardLabel")}</div>
                <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">{t("leaderboardDesc")}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={showInLeaderboard}
                disabled={savingPrivacy}
                onClick={() => void toggleLeaderboard(!showInLeaderboard)}
                className={`relative h-7 w-12 shrink-0 rounded-full transition ${
                  showInLeaderboard ? "bg-orange-500" : "bg-zinc-300"
                } disabled:cursor-not-allowed disabled:opacity-60`}
              >
                <span
                  className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${
                    showInLeaderboard ? "left-[22px]" : "left-0.5"
                  }`}
                />
              </button>
            </div>
            {privacyMsg && (
              <p className={`mt-2 text-xs ${privacyMsg.ok ? "text-emerald-600" : "text-red-600"}`}>
                {privacyMsg.text}
              </p>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
