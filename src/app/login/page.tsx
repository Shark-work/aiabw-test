"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { getAnonymousId } from "@/lib/anon-id";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Login failed");
      }
      localStorage.setItem("aiabw_token", data.token);

      // Guest data migration: run in the background, never blocks navigation
      const anonymousId = getAnonymousId();
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
            // Migration failure must not block login
          }
        })();
      }

      const redirect =
        new URLSearchParams(window.location.search).get("redirect") || "/";
      router.push(redirect);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed, please try again");
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
          Sign in to Aibi World
        </h1>
        <p className="mt-1 text-center text-sm text-zinc-500">
          Sign in to keep your pets&apos; memories forever.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="mb-1 block text-sm text-zinc-600">Email</label>
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
            <label className="mb-1 block text-sm text-zinc-600">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-200"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full bg-orange-500 px-4 py-2.5 font-semibold text-white shadow transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-zinc-500">
          No account yet?{" "}
          <Link href="/register" className="font-medium text-orange-600 hover:underline">
            Create one
          </Link>
        </p>
      </div>
    </main>
  );
}
