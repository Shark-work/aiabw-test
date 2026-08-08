"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { DiagnosticForm } from "@/components/diagnostic-form";
import { PETS, type PetType } from "@/lib/pet-config";

export default function Home() {
  const router = useRouter();
  const [adoptingType, setAdoptingType] = useState<PetType | null>(null);
  const [error, setError] = useState("");
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);

  // 从 localStorage 恢复登录态
  useEffect(() => {
    const token = localStorage.getItem("aiabw_token");
    if (!token) return;
    fetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        if (data?.ok && data.user) setUser(data.user);
        else localStorage.removeItem("aiabw_token");
      })
      .catch(() => {});
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("aiabw_token");
    setUser(null);
  };

  const handleAdopt = async (petType: PetType) => {
    if (adoptingType) return;
    setAdoptingType(petType);
    setError("");

    try {
      const token = localStorage.getItem("aiabw_token");
      const res = await fetch("/api/adopt", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          petType,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "领养失败，请稍后重试");
      }

      // 领养成功 → 带着新线程与领养记录进入独立聊天页面
      if (data.ok && data.threadId) {
        router.push(
          `/chat?thread=${data.threadId}&adopt=${data.adoption?.id ?? ""}`,
        );
      } else {
        router.push("/chat");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "领养失败，请稍后重试");
      setAdoptingType(null);
    }
  };

  const petEntries = Object.entries(PETS) as [PetType, (typeof PETS)[PetType]][];

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden p-4 sm:p-6">
      {/* 艾比世界背景图 */}
      <div
        aria-hidden
        className="absolute inset-0 bg-cover bg-center"
        style={{
          backgroundImage: "url('/resources/background_clothing/bg1.png')",
        }}
      />
      {/* 半透明白色遮罩，保证内容可读 */}
      <div aria-hidden className="absolute inset-0 bg-white/60" />

      {/* 账号入口 */}
      <div className="relative z-20 flex justify-end px-2 pt-2">
        {user ? (
          <div className="flex items-center gap-3 rounded-full border border-zinc-200 bg-white/80 px-4 py-1.5 text-sm shadow-sm backdrop-blur">
            <span className="text-zinc-600">{user.email}</span>
            <button
              type="button"
              onClick={handleLogout}
              className="font-medium text-orange-600 hover:underline"
            >
              退出
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-full border border-zinc-200 bg-white/80 px-4 py-1.5 text-sm shadow-sm backdrop-blur">
            <Link href="/login" className="font-medium text-zinc-600 hover:text-orange-600">
              登录
            </Link>
            <span className="text-zinc-300">|</span>
            <Link href="/register" className="font-medium text-orange-600 hover:underline">
              注册
            </Link>
          </div>
        )}
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-6 text-center">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl">
            艾比世界 · 多宠图鉴
          </h1>
          <p className="text-sm text-zinc-600">
            选一只你喜欢的艾比伙伴，陪它聊天、帮它成长~
          </p>
        </div>

        {/* 宠物选择卡片 */}
        <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-3">
          {petEntries.map(([petType, pet]) => {
            const busy = adoptingType === petType;
            return (
              <button
                key={petType}
                type="button"
                onClick={() => handleAdopt(petType)}
                disabled={adoptingType !== null}
                className="group flex flex-col items-center gap-3 rounded-2xl border border-zinc-200 bg-white/80 p-5 text-center shadow-sm backdrop-blur transition hover:scale-[1.03] hover:border-orange-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={pet.avatar}
                  alt={`艾比-${pet.name}`}
                  className="h-24 w-24 rounded-full border-4 border-orange-200 bg-orange-50 object-cover shadow-lg transition group-hover:scale-105"
                />
                <div className="space-y-1">
                  <div className="text-lg font-semibold text-zinc-900">
                    {pet.name}
                  </div>
                  <div className="text-xs text-zinc-500">{pet.personality}</div>
                </div>
                <span className="rounded-full bg-orange-500 px-5 py-2 text-sm font-semibold text-white shadow transition group-hover:bg-orange-600">
                  {busy ? "⏳ 打造中..." : "🐾 领养"}
                </span>
              </button>
            );
          })}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <p className="text-xs text-zinc-400">
          领养后将进入艾比世界，和你的伙伴开始聊天
        </p>

        {/* 次要功能：旧版 AI 工具诊断 */}
        <details className="mt-6 w-full max-w-2xl rounded-2xl border border-zinc-200 bg-white/70 p-4 text-left shadow-sm backdrop-blur">
          <summary className="cursor-pointer text-sm font-medium text-zinc-700">
            🔧 高级：工具诊断（旧版）
          </summary>
          <div className="mt-4">
            <DiagnosticForm />
          </div>
        </details>
      </div>
    </main>
  );
}

