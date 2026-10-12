"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";

import { useRouter } from "@/i18n/navigation";
import { PetStage } from "@/components/pet-play/pet-stage";
import { useAntiCopy } from "@/components/pet-play/use-anti-copy";
import { useAntiDebug } from "@/components/pet-play/use-anti-debug";
import { useTypewriter } from "@/components/pet-play/use-typewriter";
import {
  movieActionToAction,
  movieMoodToEmotion,
  type MovieAction,
  type MovieMood,
} from "@/lib/pet-play-config";

interface MoviePet {
  id: string;
  name: string;
  petType: string;
  avatar: string;
  happiness: number;
  hungerLevel: number;
  level: number;
}

interface MovieInteractionView {
  kind: "food" | "toy";
  emoji: string;
  cost: number;
  hungerDelta: number;
  happinessDelta: number;
}

/**
 * 电影式 AI 宠物互动页主客户端（/pet-movie）。
 * 防抄袭红线（需求四）：本组件只做「发请求 + 渲染」——
 * 状态判断 / 积分扣除 / 大模型调用 / 数值结算 100% 在服务端 API 完成
 * （/api/pet/movie 初始化聚合、/api/pet/chat mode=movie 对话、/api/pet/feed 侧栏互动），
 * 客户端 bundle 零密钥、零 System Prompt、零业务规则。
 */
export function PetMovieClient() {
  const t = useTranslations("petMovie");
  const router = useRouter();

  const [token, setToken] = useState<string | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [pet, setPet] = useState<MoviePet | null>(null);
  const [points, setPoints] = useState(0);
  const [interactions, setInteractions] = useState<MovieInteractionView[]>([]);
  const [mood, setMood] = useState<MovieMood>("bored");
  const [action, setAction] = useState<MovieAction>("idle");
  const [reply, setReply] = useState("");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toast, setToast] = useState("");

  const { typed, done } = useTypewriter(reply);

  // 防调试 + 防拷贝（需求四.1）：生产环境 DevTools 开启 → 跳离本页；禁右键/F12 快捷键
  useAntiDebug(useCallback(() => router.replace("/"), [router]));
  useAntiCopy();

  // toast 自动消隐
  useEffect(() => {
    if (!toast) return;
    const tm = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(tm);
  }, [toast]);

  // 初始化：登录态检查 + 聚合加载（/api/pet/movie 单请求下发宠物/积分/互动配置；
  // 无宠物的用户由服务端自动创建打工橘猫）
  useEffect(() => {
    const tk = localStorage.getItem("aiabw_token");
    if (!tk) {
      router.push("/login?redirect=/pet-movie");
      return;
    }
    setToken(tk);
    void (async () => {
      try {
        const res = await fetch("/api/pet/movie", {
          headers: { Authorization: `Bearer ${tk}` },
        });
        if (res.status === 401) {
          router.push("/login?redirect=/pet-movie");
          return;
        }
        const data = await res.json();
        if (!res.ok || !data?.ok) throw new Error(data?.error || "load failed");
        setPet(data.pet);
        setPoints(data.points);
        setInteractions(data.interactions);
        setPhase("ready");
        setReply(t("greeting"));
        setMood("happy");
        setAction("jump");
      } catch {
        setPhase("error");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // 情绪脉冲：动作播放 4.5s 后回剧场待机（bored/idle，打工猫日常摸鱼态）
  useEffect(() => {
    if (mood === "bored" && action === "idle") return;
    const tm = setTimeout(() => {
      setMood("bored");
      setAction("idle");
    }, 4500);
    return () => clearTimeout(tm);
  }, [mood, action]);


  // ─── 发送对话（扣费/生成全部在服务端 /api/pet/chat mode=movie；前端仅渲染契约 JSON）───
  const sendMessage = async (e: FormEvent) => {
    e.preventDefault();
    const message = input.trim();
    if (!message || sending || !token || !pet) return;
    setSending(true);
    setInput("");
    setReply(t("thinking"));
    try {
      const res = await fetch("/api/pet/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ adoptionId: pet.id, message, mode: "movie" }),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 401) {
        router.push("/login?redirect=/pet-movie");
        return;
      }
      if (res.status === 402) {
        if (typeof data?.points === "number") setPoints(data.points);
        setReply(t("hungryForPoints"));
        setMood("sad");
        setAction("idle");
        return;
      }
      if (!res.ok || !data?.ok) {
        setToast(data?.error ?? t("sendFailed"));
        setReply(t("sendFailed"));
        setMood("sad");
        setAction("idle");
        return;
      }
      setReply(data.text);
      setMood(data.mood);
      setAction(data.action);
      setPoints(data.points);
      setPet((p) => (p ? { ...p, happiness: data.happiness, hungerLevel: data.hungerLevel } : p));
    } catch {
      setToast(t("sendFailed"));
      setMood("bored");
      setAction("idle");
    } finally {
      setSending(false);
    }
  };

  // ─── 侧栏互动（需求二.3：扣余额 / 数值结算在服务端 /api/pet/feed 事务完成）───
  const interact = async (item: MovieInteractionView) => {
    if (!token || !pet) return;
    try {
      const res = await fetch("/api/pet/feed", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ adoptionId: pet.id, kind: item.kind }),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 401) {
        router.push("/login?redirect=/pet-movie");
        return;
      }
      if (res.status === 402) {
        if (typeof data?.points === "number") setPoints(data.points);
        setToast(t("insufficientPoints"));
        return;
      }
      if (!res.ok || !data?.ok) {
        setToast(data?.error ?? t("feedFailed"));
        return;
      }
      setPoints(data.points);
      setPet((p) => (p ? { ...p, happiness: data.happiness, hungerLevel: data.hungerLevel } : p));
      // 喂食 → 触发 eat 动作（需求二.3）；玩具 → jump
      setReply(item.kind === "food" ? t("feedReply") : t("playReply"));
      setMood("happy");
      setAction(item.kind === "food" ? "eat" : "jump");
    } catch {
      setToast(t("feedFailed"));
    }
  };


  // ─── 加载 / 错误态（同 Stage 壳，电影沉浸感不破框）───
  if (phase !== "ready" || !pet) {
    return (
      <div className="relative flex h-[calc(100dvh-220px)] min-h-[560px] w-full select-none items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-[#121212]">
        <div className="text-center text-white/70">
          <div className="text-4xl">{phase === "error" ? "🐾" : "🎬"}</div>
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
    /* <Stage> 电影舞台：深色全局背景 / 隐藏滚动 / 禁止选中（需求一.2）。
       高度扣除主站 Header/Footer（[locale]/layout.tsx 全局自带，需求一.1 主站 chrome 保留） */
    <div className="relative h-[calc(100dvh-220px)] min-h-[560px] w-full overflow-hidden rounded-2xl border border-white/10 bg-[#121212] select-none">
      {/* <Navbar> 顶部：宠物名 + 饥饿度进度条 + 心情 + 积分 */}
      <header className="absolute top-0 left-0 z-20 flex w-full items-center gap-3 px-4 py-3">
        <div className="font-semibold text-white">
          {pet.name}
          <span className="ml-2 text-xs font-normal text-white/50">
            {t("level")} {pet.level}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-1.5" title={t("hunger")}>
            <span aria-hidden>🍗</span>
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

      {/* <PetContainer> 中央舞台：Rive 组件居中（资产缺席时降级 CSS 动画立绘）；
          mood/action 经映射喂给双模共用的 { emotion, action } 驱动接口 */}
      <main className="absolute inset-0 z-10 flex items-center justify-center">
        <PetStage
          token={token}
          avatar={pet.avatar}
          alt={pet.name}
          emotion={movieMoodToEmotion(mood)}
          action={movieActionToAction(action)}
        />
      </main>

      {/* <Subtitle> 底部字幕：打字机逐字，默认隐藏、说话时显示 */}
      <div
        className="absolute bottom-[120px] left-0 z-20 w-full px-6 text-center text-lg text-white pointer-events-none"
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


      {/* 右缘 5% 热区（需求一.2）：悬停滑出侧边栏（z 低于 Sidebar，保证 Sidebar 可驻留 hover） */}
      <div
        className="absolute top-0 right-0 z-[25] h-full w-[5%] min-w-[24px]"
        onMouseEnter={() => setSidebarOpen(true)}
        aria-hidden
      />
      {/* <Sidebar> 右侧悬浮背包：默认收隐蔽于屏外，悬停滑出；猫粮/玩具一键互动 */}
      <aside
        className={`absolute top-[20%] right-0 z-30 h-[60%] w-[80px] rounded-l-2xl border-y border-l border-white/10 bg-black/40 backdrop-blur-md transition-transform duration-300 ${
          sidebarOpen ? "translate-x-0" : "translate-x-full"
        }`}
        onMouseLeave={() => setSidebarOpen(false)}
      >
        <div className="flex h-full flex-col items-center justify-center gap-3 overflow-y-auto py-3">
          {interactions.map((item) => (
            <button
              key={item.kind}
              type="button"
              onClick={() => void interact(item)}
              title={item.kind === "food" ? t("feed") : t("toy")}
              className="flex w-[64px] shrink-0 flex-col items-center gap-1 rounded-xl bg-white/5 p-2 transition hover:bg-white/15"
            >
              <span className="text-2xl">{item.emoji}</span>
              <span className="w-full truncate text-center text-[10px] leading-tight text-white/80">
                {item.kind === "food" ? t("feed") : t("toy")}
              </span>
              <span className="rounded-full bg-amber-400 px-1.5 text-[10px] font-semibold text-black">
                🪙{item.cost}
              </span>
            </button>
          ))}
        </div>
      </aside>

      {/* <ChatInput> 底部输入框：半透明圆角长条 + 发送按钮 */}
      <form
        onSubmit={sendMessage}
        className="absolute bottom-[30px] left-1/2 z-20 flex w-[60%] max-w-[800px] -translate-x-1/2 items-center gap-2"
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

      {/* 轻提示（积分不足/失败） */}
      {toast && (
        <div className="absolute top-16 left-1/2 z-40 -translate-x-1/2 rounded-full bg-white/90 px-4 py-1.5 text-sm font-medium text-zinc-900 shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
