"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";

import { useRouter } from "@/i18n/navigation";
import { PetStage } from "@/components/pet-play/pet-stage";
import { PetBackpack, type BackpackItemView } from "@/components/pet-play/pet-backpack";
import { InsufficientPointsModal } from "@/components/pet-play/insufficient-points-modal";
import { useAntiDebug } from "@/components/pet-play/use-anti-debug";
import { useTypewriter } from "@/components/pet-play/use-typewriter";
import { isPetMuted, playPetSound, setPetMuted } from "@/lib/pet-sound";
import { trackPet, trackPetExitOnce } from "@/lib/pet-track";
import type { PetAction, PetMood } from "@/lib/pet-play-config";

interface PlayPet {
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
 * AI 宠物互动页主客户端（/pets/my/[id]/play）。
 * 防抄袭红线（需求 2.1）：本组件只做「发请求 + 渲染」——
 * 状态判断 / 积分扣除 / 大模型调用 / 道具数值结算 100% 在服务端 API 完成，
 * 客户端 bundle 零密钥、零 System Prompt、零业务规则。
 * 统一契约（需求三.3）：{ text, mood, intensity }；动作由服务端映射表推导。
 */
export function PetPlayClient({ adoptionId }: { adoptionId: string }) {
  const t = useTranslations("petPlay");
  const router = useRouter();

  const [token, setToken] = useState<string | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error" | "no-pet">("loading");
  const [pet, setPet] = useState<PlayPet | null>(null);
  const [character, setCharacter] = useState<CharacterView | null>(null);
  const [points, setPoints] = useState(0);
  const [items, setItems] = useState<BackpackItemView[]>([]);
  // Rive 上架探测（聚合响应下发；false = 零请求直降静态立绘，无 404 噪音）
  const [riveAvailable, setRiveAvailable] = useState(false);
  const [mood, setMood] = useState<PetMood>("idle");
  const [intensity, setIntensity] = useState<0 | 1 | 2>(1);
  const [action, setAction] = useState<PetAction>("idle");
  const [reply, setReply] = useState("");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [freeRemaining, setFreeRemaining] = useState<number | null>(null);
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [muted, setMuted] = useState(true);

  const { typed, done } = useTypewriter(reply);

  // 防调试（需求 2.1）：生产环境 DevTools 开启 → 跳离互动页（逻辑全在服务端，跳离即切断）
  useAntiDebug(useCallback(() => router.replace("/"), [router]));

  // 挂载后读静音偏好（SSR 期恒 true 不发音）
  useEffect(() => {
    setMuted(isPetMuted());
  }, []);

  // toast 自动消隐
  useEffect(() => {
    if (!toast) return;
    const tm = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(tm);
  }, [toast]);

  // 初始化：登录态检查 + 聚合数据加载（单请求拿全部初始状态）+ 埋点（访问/退出）
  useEffect(() => {
    const tk = localStorage.getItem("aiabw_token");
    if (!tk) {
      router.push(`/login?redirect=/pets/my/${adoptionId}/play`);
      return;
    }
    setToken(tk);
    const cleanupExit = trackPetExitOnce("play");
    void (async () => {
      try {
        const res = await fetch(`/api/pet/play?adoptionId=${encodeURIComponent(adoptionId)}`, {
          headers: { Authorization: `Bearer ${tk}` },
        });
        if (res.status === 401) {
          router.push(`/login?redirect=/pets/my/${adoptionId}/play`);
          return;
        }
        if (res.status === 404) {
          setPhase("no-pet");
          return;
        }
        const data = await res.json();
        if (!res.ok || !data?.ok) throw new Error(data?.error || "load failed");
        setPet(data.pet);
        setCharacter(data.character ?? null);
        setPoints(data.points);
        setItems(data.items);
        setRiveAvailable(data.riveAvailable === true);
        setPhase("ready");
        // 开场白由角色配置下发（需求一：文案不硬编码）；饥饿宠物进场即 hungry 态 + 买粮提示
        setReply(data.character?.greeting ?? "");
        if (data.hungry) {
          setMood("hungry");
          setAction("eat");
          setToast(t("hungryHint"));
        } else {
          setMood("happy");
          setAction("wave");
        }
        trackPet("pet_page_view", { page: "play", character: data.character?.id ?? "" });
      } catch {
        setPhase("error");
      }
    })();
    return cleanupExit;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adoptionId, router]);

  // 情绪脉冲：动作播放 4s 后回待机（thinking 由下一次回复接管，不参与）
  useEffect(() => {
    if (mood === "idle" || mood === "thinking") return;
    const tm = setTimeout(() => {
      setMood("idle");
      setAction("idle");
      setIntensity(1);
    }, 4000);
    return () => clearTimeout(tm);
  }, [mood]);

  // ── 发送对话（状态/扣费/生成全部在服务端；前端仅渲染契约 JSON） ──
  const sendMessage = async (e: FormEvent) => {
    e.preventDefault();
    const message = input.trim();
    if (!message || sending || !token || !pet) return;
    setSending(true);
    setInput("");
    // 需求三.4：用户输入时立即 thinking，回复结束后由契约 mood 接管
    setMood("thinking");
    setAction("think");
    setReply(t("thinking"));
    playPetSound("send");
    trackPet("pet_chat_send", { page: "play", len: message.length });
    try {
      const res = await fetch("/api/pet/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ adoptionId: pet.id, message }),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 401) {
        router.push(`/login?redirect=/pets/my/${adoptionId}/play`);
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
      setIntensity(data.intensity ?? 1);
      setPoints(data.points);
      if (typeof data.freeRemaining === "number") setFreeRemaining(data.freeRemaining);
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

  // ── 购买道具（积分事务在服务端 /api/pet/play/buy；402 → 充值弹窗） ──
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
        router.push(`/login?redirect=/pets/my/${adoptionId}/play`);
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
      trackPet("pet_item_buy", { page: "play", item: item.key, price: item.price });
    } catch {
      setToast(t("buyFailed"));
    } finally {
      setPendingKey(null);
    }
  };

  // ── 使用道具（需求四.3：扣道具 → 播 eat/play 动画 → 恢复饥饿度；服务端写交互记录） ──
  const consumeItem = async (item: BackpackItemView) => {
    if (!token || !pet || pendingKey) return;
    setPendingKey(item.key);
    trackPet("pet_feed_click", { page: "play", item: item.key });
    try {
      const res = await fetch("/api/pet/play/use", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ itemKey: item.key, adoptionId: pet.id }),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 401) {
        router.push(`/login?redirect=/pets/my/${adoptionId}/play`);
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
      // 台词由角色配置经服务端下发（需求一）；eat/play 动作 + 情绪强度拉满
      setReply(data.text ?? "");
      setMood(data.mood ?? (item.effect === "eat" ? "hungry" : "happy"));
      setAction(data.action ?? (item.effect === "eat" ? "eat" : "happy"));
      setIntensity(2);
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

  // 蹭蹭（需求三.2 rub 动作位：点击宠物直接 fire；配短音效）
  const handlePetTap = () => {
    playPetSound("reply");
  };

  // ─── 加载 / 错误 / 空状态（需求七.3：未领养引导去领养页；沉浸壳不破框） ───
  if (phase !== "ready" || !pet) {
    return (
      <div className="relative flex h-dvh min-h-[560px] w-full select-none items-center justify-center overflow-hidden bg-[#121212]">
        {phase === "no-pet" ? (
          <div className="mx-4 max-w-sm rounded-2xl border border-white/10 bg-zinc-900/80 p-8 text-center">
            <div className="text-5xl">🐾</div>
            <h2 className="mt-4 text-lg font-semibold text-white">{t("adoptEmptyTitle")}</h2>
            <p className="mt-2 text-sm text-white/60">{t("adoptEmptyDesc")}</p>
            <button
              type="button"
              onClick={() => router.push("/pets/adopt")}
              className="mt-5 w-full rounded-full bg-emerald-400 py-2.5 text-sm font-semibold text-black transition hover:bg-emerald-300"
            >
              {t("adoptCta")}
            </button>
            <button
              type="button"
              onClick={() => router.push("/")}
              className="mt-3 text-xs text-white/40 transition hover:text-white/70"
            >
              {t("backHome")}
            </button>
          </div>
        ) : (
          <div className="text-center text-white/70">
            <div className="text-4xl">{phase === "error" ? "🐾" : "✨"}</div>
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
        )}
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
          onClick={() => router.push("/pets/my")}
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
              {t("freeToday", { left: freeRemaining, total: 5 })}
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
          riveAvailable={riveAvailable}
          avatar={pet.avatar}
          alt={pet.name}
          mood={mood}
          action={action}
          intensity={intensity}
          onAssetFailed={handleAssetFailed}
          onPetTap={handlePetTap}
        />
      </main>

      {/* 底部字幕：打字机逐字（台词由角色配置经服务端下发，需求一） */}
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
        ns="petPlay"
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
          disabled={sending || !input.trim()}
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
        ns="petPlay"
        open={rechargeOpen}
        points={points}
        onClose={() => setRechargeOpen(false)}
      />
    </div>
  );
}
