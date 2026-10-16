"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";

import { useRouter } from "@/i18n/navigation";
import { PetStage } from "@/components/pet-play/pet-stage";
import { PetBackpack, type BackpackItemView } from "@/components/pet-play/pet-backpack";
import { InsufficientPointsModal } from "@/components/pet-play/insufficient-points-modal";
import { useAntiCopy } from "@/components/pet-play/use-anti-copy";
import { useAntiDebug } from "@/components/pet-play/use-anti-debug";
import { ChatBubble } from "@/components/pet-play/chat-bubble";
import { isPetMuted, playPetSound, setPetMuted } from "@/lib/pet-sound";
import { trackPet, trackPetExitOnce } from "@/lib/pet-track";
import { PET_CHAT_FREE_DAILY, type PetAction, type PetMood } from "@/lib/pet-play-config";
import type { SpeciesVisual } from "@/lib/pets/species-visuals";

interface MoviePet {
  id: string;
  name: string;
  petType: string;
  speciesId?: string | null;
  avatar: string;
  happiness: number;
  hungerLevel: number;
  level: number;
}

interface CharacterView {
  id: string;
  displayName: string;
  greeting: string;
}

/**
 * 电影式 AI 宠物互动页主客户端（/pet-movie）。
 * 防抄袭红线（需求四）：本组件只做「发请求 + 渲染」——
 * 状态判断 / 积分扣除 / 大模型调用 / 数值结算 100% 在服务端 API 完成
 * （/api/pet/movie 初始化聚合、/api/pet/chat 对话、/api/pet/play/buy|use 背包事务），
 * 客户端 bundle 零密钥、零 System Prompt、零业务规则。
 * 统一契约（需求三.3）：{ text, mood, intensity }；侧栏 = 背包模式（需求四，与 play 页一致）。
 */
export function PetMovieClient() {
  const t = useTranslations("petMovie");
  const router = useRouter();

  const [token, setToken] = useState<string | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [pet, setPet] = useState<MoviePet | null>(null);
  const [character, setCharacter] = useState<CharacterView | null>(null);
  const [points, setPoints] = useState(0);
  const [items, setItems] = useState<BackpackItemView[]>([]);
  // Rive 上架探测（聚合响应下发；false = 零请求直降静态立绘，无 404 噪音）
  const [riveAvailable, setRiveAvailable] = useState(false);
  // CMS 物种视觉覆写（任务四：聚合响应下发 → PetStage 优先消费；null = 客户端注册表兜底）
  const [visualOverride, setVisualOverride] = useState<SpeciesVisual | null>(null);
  const [mood, setMood] = useState<PetMood>("idle");
  // 情绪强度 0-1（Rive Number 输入「intensity」）
  const [intensity, setIntensity] = useState<number>(0.5);
  const [action, setAction] = useState<PetAction>("idle");
  // 互动意图（契约 Trigger 五值 pet/eat/play/sleep/wake；服务端下发，驱动一次性动作）
  const [intent, setIntent] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [freeRemaining, setFreeRemaining] = useState<number | null>(null);
  // 每日免费句数总额（任务三：服务端 CMS TokenRule 下发，缺省回退代码常量——total 不硬编码）
  const [chatFreeDaily, setChatFreeDaily] = useState(PET_CHAT_FREE_DAILY);
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [muted, setMuted] = useState(true);

  // 打字中状态（ChatBubble 上报）：打字期间发送锁，防连点刷句刷费
  const [typing, setTyping] = useState(false);

  // 防调试 + 防拷贝（需求四.1）：生产环境 DevTools 开启 → 跳离本页；禁右键/F12 快捷键
  useAntiDebug(useCallback(() => router.replace("/"), [router]));
  useAntiCopy();

  // 挂载后读静音偏好
  useEffect(() => {
    setMuted(isPetMuted());
  }, []);

  // toast 自动消隐
  useEffect(() => {
    if (!toast) return;
    const tm = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(tm);
  }, [toast]);

  // 初始化：登录态检查 + 聚合加载（/api/pet/movie 单请求下发宠物/角色/积分/背包；
  // 无宠物的用户由服务端自动创建打工橘猫）+ 埋点（访问/退出）
  useEffect(() => {
    const tk = localStorage.getItem("aiabw_token");
    if (!tk) {
      router.push("/login?redirect=/pet-movie");
      return;
    }
    setToken(tk);
    const cleanupExit = trackPetExitOnce("movie");
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
        setCharacter(data.character ?? null);
        setPoints(data.points);
        setItems(data.items ?? []);
        setRiveAvailable(data.riveAvailable === true);
        setVisualOverride(data.visual ?? null);
        if (typeof data.chatFreeDaily === "number" && data.chatFreeDaily > 0) {
          setChatFreeDaily(data.chatFreeDaily);
        }
        setPhase("ready");
        setReply(data.character?.greeting ?? "");
        if (data.hungry) {
          setMood("hungry");
          setAction("eat");
          setIntent("eat");
          setToast(t("hungryHint"));
        } else if (data.returning) {
          // 久别重逢（服务端 returning 标记）：没睡醒的 sleepy 态进场，wake 唤醒一次
          setMood("sleepy");
          setAction("sleep");
          setIntent("wake");
        } else {
          setMood("happy");
          setAction("wave");
        }
        trackPet("pet_page_view", { page: "movie", character: data.character?.id ?? "" });
      } catch {
        setPhase("error");
      }
    })();
    return cleanupExit;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // 情绪脉冲：动作播放 4.5s 后回待机（thinking 由下一次回复接管，不参与）
  useEffect(() => {
    if (mood === "idle" || mood === "thinking") return;
    const tm = setTimeout(() => {
      setMood("idle");
      setAction("idle");
      setIntent(null);
      setIntensity(0.5);
    }, 4500);
    return () => clearTimeout(tm);
  }, [mood]);

  // ─── 发送对话（扣费/生成全部在服务端 /api/pet/chat；前端仅渲染契约 JSON） ───
  const sendMessage = async (e: FormEvent) => {
    e.preventDefault();
    const message = input.trim();
    if (!message || sending || typing || !token || !pet) return;
    setSending(true);
    setInput("");
    // 需求三.4：用户输入时立即 thinking，回复结束后由契约 mood 接管
    setMood("thinking");
    setAction("think");
    setIntent(null);
    setReply(t("thinking"));
    playPetSound("send");
    trackPet("pet_chat_send", { page: "movie", len: message.length });
    try {
      const res = await fetch("/api/pet/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ adoptionId: pet.id, message }),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 401) {
        router.push("/login?redirect=/pet-movie");
        return;
      }
      if (res.status === 402) {
        // 需求五.1：余额不足 → 充值引导弹窗（不静默失败）
        if (typeof data?.points === "number") setPoints(data.points);
        setRechargeOpen(true);
        setMood("sad");
        setAction("idle");
        setReply("");
        return;
      }
      if (res.status === 429) {
        setToast(data?.error ?? t("dailyCap"));
        setMood("idle");
        setAction("idle");
        setReply("");
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
      setIntent(typeof data.intent === "string" ? data.intent : null);
      setIntensity(typeof data.intensity === "number" ? data.intensity : 0.5);
      setPoints(data.points);
      if (typeof data.freeRemaining === "number") setFreeRemaining(data.freeRemaining);
      if (typeof data.freeDaily === "number" && data.freeDaily > 0) setChatFreeDaily(data.freeDaily);
      setPet((p) => (p ? { ...p, happiness: data.happiness, hungerLevel: data.hungerLevel } : p));
      if (data.hungry) setToast(t("hungryHint"));
      playPetSound("reply");
    } catch {
      setToast(t("sendFailed"));
      setMood("idle");
      setAction("idle");
    } finally {
      setSending(false);
    }
  };

  // ─── 购买道具（积分事务在服务端 /api/pet/play/buy；402 → 充值弹窗） ───
  const buyItem = async (item: BackpackItemView) => {
    if (!token || pendingKey) return;
    setPendingKey(item.key);
    try {
      const res = await fetch("/api/pet/play/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ itemKey: item.key }),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 401) {
        router.push("/login?redirect=/pet-movie");
        return;
      }
      if (res.status === 402) {
        if (typeof data?.points === "number") setPoints(data.points);
        setRechargeOpen(true);
        return;
      }
      if (!res.ok || !data?.ok) {
        setToast(data?.error ?? t("buyFailed"));
        return;
      }
      setPoints(data.points);
      setItems((list) => list.map((i) => (i.key === item.key ? { ...i, owned: data.owned } : i)));
      setToast(t("buyOk"));
      playPetSound("buy");
      trackPet("pet_item_buy", { page: "movie", item: item.key, price: item.price });
    } catch {
      setToast(t("buyFailed"));
    } finally {
      setPendingKey(null);
    }
  };

  // ─── 使用道具（需求四.3：扣道具 → 播 eat/play 动画 → 恢复饥饿度；服务端写交互记录） ───
  const consumeItem = async (item: BackpackItemView) => {
    if (!token || !pet || pendingKey) return;
    setPendingKey(item.key);
    trackPet("pet_feed_click", { page: "movie", item: item.key });
    try {
      const res = await fetch("/api/pet/play/use", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ itemKey: item.key, adoptionId: pet.id }),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 401) {
        router.push("/login?redirect=/pet-movie");
        return;
      }
      if (res.status === 409) {
        setToast(t("itemEmpty"));
        setItems((list) => list.map((i) => (i.key === item.key ? { ...i, owned: 0 } : i)));
        return;
      }
      if (!res.ok || !data?.ok) {
        setToast(data?.error ?? t("useFailed"));
        return;
      }
      setItems((list) => list.map((i) => (i.key === item.key ? { ...i, owned: data.remaining } : i)));
      setPet((p) => (p ? { ...p, happiness: data.happiness, hungerLevel: data.hungerLevel } : p));
      setReply(data.text ?? "");
      setMood(data.mood ?? (item.effect === "eat" ? "hungry" : "happy"));
      setAction(data.action ?? (item.effect === "eat" ? "eat" : "happy"));
      setIntent(item.effect);
      setIntensity(1);
      playPetSound("feed");
    } catch {
      setToast(t("useFailed"));
    } finally {
      setPendingKey(null);
    }
  };

  // 资源失败（需求二.2：控制台错误已由 PetStage 输出，这里做页面轻提示）
  const handleAssetFailed = useCallback(() => setToast(t("assetFallback")), [t]);

  // 静音开关（需求七.2；localStorage 持久化）
  const toggleMute = () => {
    setMuted((m) => {
      setPetMuted(!m);
      return !m;
    });
  };

  // 蹭蹭（rub 动作位：点击宠物直接 fire；配短音效）
  const handlePetTap = () => {
    playPetSound("reply");
  };

  // ─── 加载 / 错误态（同 Stage 壳，电影沉浸感不破框） ───
  if (phase !== "ready" || !pet) {
    return (
      <div className="relative flex h-dvh min-h-[560px] w-full select-none items-center justify-center overflow-hidden bg-[#121212]">
        <div className="text-center text-white/70">
          <div className="text-4xl">{phase === "error" ? "🐾" : "🎬"}</div>
          <p className="mt-3 text-sm">{phase === "error" ? t("loadFailed") : t("loading")}</p>
          {phase === "error" && (
            <button
              type="button"
              onClick={() => router.push("/")}
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
    /* 全屏沉浸舞台（需求七.1：主站导航已由 layout 隐藏；深色全局 / 隐藏滚动 / 禁止选中） */
    <div className="relative h-dvh min-h-[560px] w-full overflow-hidden bg-[#121212] select-none">
      {/* 顶部：返回 + 宠物名/状态 + 免费次数 + 积分 + 工具条（需求七.2 静音/退出沉浸） */}
      <header className="absolute top-0 left-0 z-20 flex w-full items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => router.push("/")}
          aria-label={t("back")}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
        >
          ←
        </button>
        <div className="font-semibold text-white">
          {pet.name}
          <span className="ml-2 text-xs font-normal text-white/50">
            {t("level")}{pet.level}
            {character && <span className="ml-1 text-white/35">· {character.displayName}</span>}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-1.5" title={t("hunger")}>
            <span aria-hidden>🍗</span>
            <div className="h-2 w-16 overflow-hidden rounded-full bg-white/10 sm:w-32">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  pet.hungerLevel <= 20 ? "bg-red-400" : "bg-gradient-to-r from-orange-400 to-amber-300"
                }`}
                style={{ width: `${pet.hungerLevel}%` }}
              />
            </div>
            <span className="w-8 text-xs text-white/60">{pet.hungerLevel}</span>
          </div>
          <div className="hidden items-center gap-1 text-xs text-white/70 sm:flex" title={t("mood")}>
            ❤️ {pet.happiness}
          </div>
          {freeRemaining !== null && (
            <div className="hidden rounded-full bg-emerald-400/15 px-2.5 py-1 text-xs font-medium text-emerald-300 sm:block">
              {t("freeToday", { left: freeRemaining, total: chatFreeDaily })}
            </div>
          )}
          <div className="flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold text-amber-300">
            🪙 {points}
          </div>
          <button
            type="button"
            onClick={toggleMute}
            title={muted ? t("soundOff") : t("soundOn")}
            aria-label={muted ? t("soundOff") : t("soundOn")}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-sm text-white transition hover:bg-white/20"
          >
            {muted ? "🔇" : "🔊"}
          </button>
          <button
            type="button"
            onClick={() => router.push("/")}
            title={t("exitImmersive")}
            aria-label={t("exitImmersive")}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-sm text-white transition hover:bg-white/20"
          >
            ⏻
          </button>
        </div>
      </header>

      {/* 中央舞台：Rive 状态机（资产缺席降级 CSS 动画立绘）；点击宠物 = 蹭蹭 */}
      <main className="absolute inset-0 z-10 flex items-center justify-center">
        <PetStage
          token={token}
          speciesId={pet.speciesId}
          visualOverride={visualOverride}
          riveAvailable={riveAvailable}
          avatar={pet.avatar}
          alt={pet.name}
          mood={mood}
          action={action}
          intent={intent}
          intensity={intensity}
          onAssetFailed={handleAssetFailed}
          onPetTap={handlePetTap}
        />
      </main>

      {/* 底部字幕：打字机逐字（台词由角色配置经服务端下发，需求一） */}
      {/* 对话气泡（单轮展示：打字机 + 淡入 + 打字状态上报发送锁） */}
      <ChatBubble text={reply} onTypingChange={setTyping} />

      {/* 桌面端：右缘 5% 热区（hover 滑出背包侧栏） */}
      <div
        className="absolute top-0 right-0 z-[25] hidden h-full w-[5%] min-w-[24px] md:block"
        onMouseEnter={() => setSidebarOpen(true)}
        aria-hidden
      />
      {/* 移动端：右下 🎒 浮动按钮（弹出底部抽屉——hover 在触屏不可用，需求四.2） */}
      <button
        type="button"
        onClick={() => setSidebarOpen(true)}
        aria-label={t("backpack")}
        className="absolute right-4 bottom-[118px] z-30 flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-xl shadow-lg backdrop-blur-md transition hover:bg-white/20 md:hidden"
      >
        🎒
      </button>
      <PetBackpack
        ns="petMovie"
        items={items}
        open={sidebarOpen}
        pendingKey={pendingKey}
        onClose={() => setSidebarOpen(false)}
        onBuy={(item) => void buyItem(item)}
        onUse={(item) => void consumeItem(item)}
      />

      {/* 底部输入框：半透明圆角长条 + 发送按钮（占位符含宠物名，需求一.2） */}
      <form
        onSubmit={sendMessage}
        className="absolute bottom-[30px] left-1/2 z-20 flex w-[92%] max-w-[800px] -translate-x-1/2 items-center gap-2 sm:w-[60%]"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("inputPlaceholder", { name: pet.name })}
          maxLength={500}
          className="flex-1 rounded-full border border-white/15 bg-white/10 px-5 py-3 text-white outline-none backdrop-blur-md placeholder-white/40 focus:border-orange-400/60"
        />
        <button
          type="submit"
          disabled={sending || typing || !input.trim()}
          className="shrink-0 rounded-full bg-orange-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-orange-400 disabled:opacity-40"
        >
          {sending ? t("sending") : t("send")}
        </button>
      </form>

      {/* 轻提示（资源失败/饥饿提示/操作结果） */}
      {toast && (
        <div className="absolute top-16 left-1/2 z-40 -translate-x-1/2 rounded-full bg-white/90 px-4 py-1.5 text-sm font-medium text-zinc-900 shadow-lg">
          {toast}
        </div>
      )}

      {/* 积分不足引导弹窗（需求五.1） */}
      <InsufficientPointsModal
        ns="petMovie"
        open={rechargeOpen}
        points={points}
        onClose={() => setRechargeOpen(false)}
      />
    </div>
  );
}
