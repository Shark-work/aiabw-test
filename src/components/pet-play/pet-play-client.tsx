"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";

import { useRouter } from "@/i18n/navigation";
import { PetStage } from "@/components/pet-play/pet-stage";
import { useAntiDebug } from "@/components/pet-play/use-anti-debug";
import { useTypewriter } from "@/components/pet-play/use-typewriter";
import type { PlayAction, PlayEmotion } from "@/lib/pet-play-config";

interface PlayPet {
  id: string;
  name: string;
  petType: string;
  avatar: string;
  happiness: number;
  hungerLevel: number;
  level: number;
}

interface PlayItemView {
  key: string;
  name: string;
  emoji: string;
  price: number;
  hungerDelta: number;
  happinessDelta: number;
  desc: string;
  owned: number;
}

/**
 * AI 宠物互动页主客户端（/pets/my/[id]/play）。
 * 防抄袭红线（需求 2.1）：本组件只做「发请求 + 渲染」——
 * 状态判断 / 积分扣除 / 大模型调用 / 道具数值结算 100% 在服务端 API 完成，
 * 客户端 bundle 零密钥、零 System Prompt、零业务规则。
 */
export function PetPlayClient({ adoptionId }: { adoptionId: string }) {
  const t = useTranslations("petPlay");
  const router = useRouter();

  const [token, setToken] = useState<string | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [pet, setPet] = useState<PlayPet | null>(null);
  const [points, setPoints] = useState(0);
  const [items, setItems] = useState<PlayItemView[]>([]);
  const [emotion, setEmotion] = useState<PlayEmotion>("idle");
  const [action, setAction] = useState<PlayAction>("idle");
  const [reply, setReply] = useState("");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toast, setToast] = useState("");

  const { typed, done } = useTypewriter(reply);

  // 防调试（需求 2.1）：生产环境 DevTools 开启 → 跳离互动页（逻辑全在服务端，跳离即切断）
  useAntiDebug(useCallback(() => router.replace("/"), [router]));

  // toast 自动消隐
  useEffect(() => {
    if (!toast) return;
    const tm = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(tm);
  }, [toast]);

  // 初始化：登录态检查 + 聚合数据加载（单请求拿全部初始状态）
  useEffect(() => {
    const tk = localStorage.getItem("aiabw_token");
    if (!tk) {
      router.push(`/login?redirect=/pets/my/${adoptionId}/play`);
      return;
    }
    setToken(tk);
    void (async () => {
      try {
        const res = await fetch(`/api/pet/play?adoptionId=${encodeURIComponent(adoptionId)}`, {
          headers: { Authorization: `Bearer ${tk}` },
        });
        if (res.status === 401) {
          router.push(`/login?redirect=/pets/my/${adoptionId}/play`);
          return;
        }
        const data = await res.json();
        if (!res.ok || !data?.ok) throw new Error(data?.error || "load failed");
        setPet(data.pet);
        setPoints(data.points);
        setItems(data.items);
        setPhase("ready");
        setReply(t("greeting"));
        setEmotion("happy");
        setAction("wave");
      } catch {
        setPhase("error");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adoptionId, router]);

  // 情绪脉冲：动作播放 4s 后回待机（thinking 由下一次回复接管，不参与）
  useEffect(() => {
    if (emotion === "idle" || emotion === "thinking") return;
    const tm = setTimeout(() => {
      setEmotion("idle");
      setAction("idle");
    }, 4000);
    return () => clearTimeout(tm);
  }, [emotion]);


  // ── 发送对话（状态/扣费/生成全部在服务端；前端仅渲染契约 JSON） ──
  const sendMessage = async (e: FormEvent) => {
    e.preventDefault();
    const message = input.trim();
    if (!message || sending || !token || !pet) return;
    setSending(true);
    setInput("");
    setEmotion("thinking");
    setAction("think");
    setReply(t("thinking"));
    try {
      const res = await fetch("/api/pet/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ adoptionId, message }),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 401) {
        router.push(`/login?redirect=/pets/my/${adoptionId}/play`);
        return;
      }
      if (res.status === 402) {
        if (typeof data?.points === "number") setPoints(data.points);
        setReply(t("hungryForPoints"));
        setEmotion("sad");
        setAction("sad");
        return;
      }
      if (!res.ok || !data?.ok) {
        setToast(data?.error ?? t("sendFailed"));
        setReply(t("sendFailed"));
        setEmotion("sad");
        setAction("sad");
        return;
      }
      setReply(data.reply);
      setEmotion(data.emotion);
      setAction(data.action);
      setPoints(data.points);
      setPet((p) => (p ? { ...p, happiness: data.happiness, hungerLevel: data.hungerLevel } : p));
    } catch {
      setToast(t("sendFailed"));
      setEmotion("idle");
      setAction("idle");
    } finally {
      setSending(false);
    }
  };

  // ── 购买道具（扣费在服务端事务完成） ──
  const buyItem = async (key: string) => {
    if (!token) return;
    try {
      const res = await fetch("/api/pet/play/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ itemKey: key }),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 402) {
        if (typeof data?.points === "number") setPoints(data.points);
        setToast(t("insufficientPoints"));
        return;
      }
      if (!res.ok || !data?.ok) {
        setToast(data?.error ?? t("buyFailed"));
        return;
      }
      setPoints(data.points);
      setItems((list) => list.map((i) => (i.key === key ? { ...i, owned: data.owned } : i)));
      setToast(t("buyOk"));
    } catch {
      setToast(t("buyFailed"));
    }
  };

  // ── 使用道具（数值结算在服务端事务完成；宠物反应按道具类型展示） ──
  const consumeItem = async (key: string) => {
    if (!token || !pet) return;
    try {
      const res = await fetch("/api/pet/play/use", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ itemKey: key, adoptionId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setToast(data?.error ?? t("useFailed"));
        return;
      }
      setPet((p) => (p ? { ...p, happiness: data.happiness, hungerLevel: data.hungerLevel } : p));
      setItems((list) => list.map((i) => (i.key === key ? { ...i, owned: data.remaining } : i)));
      const isFood = (items.find((i) => i.key === key)?.hungerDelta ?? 0) > 0;
      setReply(isFood ? t("feedReply") : t("playReply"));
      setEmotion(isFood ? "eating" : "happy");
      setAction(isFood ? "eat" : "happy");
    } catch {
      setToast(t("useFailed"));
    }
  };

  const onItemClick = (item: PlayItemView) =>
    item.owned > 0 ? void consumeItem(item.key) : void buyItem(item.key);


  // ── 加载 / 错误态（同 Stage 壳，电影沉浸感不破框） ──
  if (phase !== "ready" || !pet) {
    return (
      <div className="relative h-screen w-full overflow-hidden bg-[#121212] select-none flex items-center justify-center">
        <div className="text-center text-white/70">
          <div className="text-4xl">{phase === "error" ? "😿" : "🐾"}</div>
          <p className="mt-3 text-sm">{phase === "error" ? t("loadFailed") : t("loading")}</p>
          {phase === "error" && (
            <button
              type="button"
              onClick={() => router.push("/pets/my")}
              className="mt-4 rounded-full bg-white/10 px-4 py-1.5 text-sm text-white hover:bg-white/20"
            >
              {t("back")}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    /* <Stage> 全屏相对定位容器：深色背景 / 隐藏滚动 / 禁止选中（需求 3） */
    <div className="relative h-screen w-full overflow-hidden bg-[#121212] select-none">
      {/* <Navbar> 顶部：宠物名 + 饥饿度进度条 + 心情 + 积分 */}
      <header className="absolute top-0 left-0 w-full z-20 flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => router.push("/pets/my")}
          className="rounded-full bg-white/10 px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/20"
        >
          ‹ {t("back")}
        </button>
        <div className="font-semibold text-white">
          {pet.name}
          <span className="ml-2 text-xs font-normal text-white/50">
            {t("level")} {pet.level}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-1.5" title={t("hunger")}>
            <span aria-hidden>🍖</span>
            <div className="h-2 w-24 overflow-hidden rounded-full bg-white/10 sm:w-40">
              <div
                className="h-full rounded-full bg-gradient-to-r from-orange-400 to-amber-300 transition-all duration-500"
                style={{ width: `${pet.hungerLevel}%` }}
              />
            </div>
            <span className="w-8 text-xs text-white/60">{pet.hungerLevel}</span>
          </div>
          <div className="hidden items-center gap-1 text-xs text-white/70 sm:flex" title={t("mood")}>
            ❤️ {pet.happiness}
          </div>
          <div className="flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold text-amber-300">
            🪙 {points}
          </div>
        </div>
      </header>

      {/* <PetContainer> 中央舞台：Rive 组件居中（资产缺席时降级 CSS 动画立绘） */}
      <main className="absolute inset-0 flex items-center justify-center z-10">
        <PetStage token={token} avatar={pet.avatar} alt={pet.name} emotion={emotion} action={action} />
      </main>

      {/* <Subtitle> 底部字幕：打字机逐字，默认隐藏、说话时显示 */}
      <div
        className="absolute bottom-[120px] left-0 w-full text-center text-white text-lg z-20 px-6 pointer-events-none"
        style={{ textShadow: "0 2px 10px rgba(0,0,0,0.85), 0 0 24px rgba(0,0,0,0.6)" }}
        aria-live="polite"
      >
        {typed && (
          <span className="inline-block max-w-[720px] rounded-2xl bg-black/45 px-5 py-2.5 backdrop-blur-sm">
            {typed}
            {!done && <span className="animate-pulse">▍</span>}
          </span>
        )}
      </div>


      {/* 右缘 20px 热区：悬停滑出侧边栏（z 低于 Sidebar，保证 Sidebar 可驻留 hover） */}
      <div
        className="absolute top-0 right-0 h-full w-[20px] z-[25]"
        onMouseEnter={() => setSidebarOpen(true)}
        aria-hidden
      />
      {/* <Sidebar> 右侧悬浮背包：默认收隐蔽于屏外，悬停滑出 */}
      <aside
        className={`absolute top-[20%] right-0 w-[80px] h-[60%] bg-black/40 backdrop-blur-md z-30 rounded-l-2xl border-y border-l border-white/10 transition-transform duration-300 ${
          sidebarOpen ? "translate-x-0" : "translate-x-full"
        }`}
        onMouseLeave={() => setSidebarOpen(false)}
      >
        <div className="flex h-full flex-col items-center gap-2.5 overflow-y-auto py-3">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => onItemClick(item)}
              title={`${item.name} · ${item.desc}`}
              className="flex w-[64px] shrink-0 flex-col items-center gap-1 rounded-xl bg-white/5 p-1.5 transition hover:bg-white/15"
            >
              <span className="text-2xl">{item.emoji}</span>
              <span className="w-full truncate text-center text-[10px] leading-tight text-white/80">
                {item.name}
              </span>
              {item.owned > 0 ? (
                <span className="rounded-full bg-emerald-500/80 px-1.5 text-[10px] font-semibold text-white">
                  ×{item.owned}
                </span>
              ) : (
                <span className="rounded-full bg-amber-400 px-1.5 text-[10px] font-semibold text-black">
                  🪙{item.price}
                </span>
              )}
            </button>
          ))}
        </div>
      </aside>

      {/* <ChatInput> 底部输入框：半透明圆角长条 + 发送按钮 */}
      <form
        onSubmit={sendMessage}
        className="absolute bottom-[30px] left-1/2 -translate-x-1/2 w-[60%] max-w-[800px] z-20 flex items-center gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("inputPlaceholder")}
          maxLength={500}
          className="flex-1 rounded-full border border-white/15 bg-white/10 px-5 py-3 text-white outline-none backdrop-blur-md placeholder-white/40 focus:border-orange-400/60"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="shrink-0 rounded-full bg-orange-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-orange-400 disabled:opacity-40"
        >
          {sending ? t("sending") : t("send")}
        </button>
      </form>

      {/* 轻提示（购买/错误） */}
      {toast && (
        <div className="absolute top-16 left-1/2 z-40 -translate-x-1/2 rounded-full bg-white/90 px-4 py-1.5 text-sm font-medium text-zinc-900 shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
