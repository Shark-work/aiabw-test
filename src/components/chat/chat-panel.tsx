"use client";

import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Send, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { PetAvatar } from "@/components/PetAvatar";
import { ToolCallCard } from "@/components/chat/tool-call-card";
import { EXAMPLE_PROMPTS } from "@/lib/utils";
import type { PetConfig } from "@/lib/pet-config";
import { useTranslations } from "next-intl";
import { QRCodeSVG } from "qrcode.react";

function AgentAvatar({
  pet,
  className = "h-8 w-8",
}: {
  pet: PetConfig;
  className?: string;
}) {
  return (
    <PetAvatar
      src={pet.avatar}
      alt={pet.name}
      className={`${className} shrink-0 rounded-full border border-orange-200 bg-orange-50 object-cover`}
    />
  );
}

type UIPart = {
  type: string;
  text?: string;
  toolInvocation?: {
    toolName: string;
    args?: unknown;
    result?: unknown;
    state?: string;
  };
};

type ChatPanelProps = {
  threadId?: string;
  initialMessages?: UIMessage[];
  /** 覆盖默认欢迎语。例如领养成功后展示专属领养欢迎语。 */
  welcomeMessage?: string;
  /** 关联的领养记录 id，随请求发给 /api/chat 用于提升心情。 */
  adoptionId?: string;
  /** 宠物类型，随请求发给 /api/chat 用于切换系统提示词。 */
  petType: string;
  /** 当前宠物配置（头像、名字、欢迎语等）。 */
  pet: PetConfig;
  /** 一次用户互动（发出消息并收到回复）结束后回调，用于刷新心情。 */
  onInteractionComplete?: () => void;
  /** 渲染在输入框上方的附加信息（例如心情条）。 */
  footerInfo?: React.ReactNode;
};

export function ChatPanel({
  threadId,
  initialMessages,
  welcomeMessage,
  adoptionId,
  petType,
  pet,
  onInteractionComplete,
  footerInfo,
}: ChatPanelProps) {
  const t = useTranslations("chatPanel");
  const tc = useTranslations("common");
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error, clearError } = useChat({
    id: threadId,
    messages: initialMessages,
  });

  // 商业化变现：捕获 /api/chat 返回的 blocked 响应，弹出赞助/解锁卡片。
  const [blocked, setBlocked] = useState<{ message: string } | null>(null);
  const [blockedDismissed, setBlockedDismissed] = useState(false);

  // XorPay 下单状态：loading / 二维码 / 支付页链接 / 错误
  const [pay, setPay] = useState<{
    loading: boolean;
    qr?: string;
    payUrl?: string | null;
    error?: string;
  }>({ loading: false });

  // 重试风暴防护：请求在途时用 ref 锁定，杜绝重复点击 / 重复触发
  const payBusyRef = useRef(false);

  const handleStartPay = async () => {
    if (!adoptionId) return;
    // 状态锁：请求未结束前忽略后续点击
    if (payBusyRef.current || pay.loading) return;
    payBusyRef.current = true;
    setPay((prev) => ({ ...prev, loading: true, error: undefined }));
    try {
      const res = await fetch("/api/pay/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adoptionId, amount: 9.9 }),
      });
      const data = await res.json();
      if (data?.ok) {
        setPay({ loading: false, qr: data.qr, payUrl: data.payUrl ?? null });
      } else {
        setPay({ loading: false, error: data?.error ?? t("orderFailed") });
      }
    } catch {
      setPay({ loading: false, error: tc("networkError") });
    } finally {
      payBusyRef.current = false;
    }
  };

  // 支付完成后校验是否已解锁
  const handleVerifyPay = async () => {
    if (!adoptionId) return;
    try {
      const res = await fetch(`/api/pet/status?id=${adoptionId}`);
      const data = await res.json();
      if (data?.ok && data.isUnlocked) {
        stopPolling();
        setBlocked(null);
        setBlockedDismissed(false);
        setPay({ loading: false });
        clearError?.();
        alert(t("unlockedOk"));
      } else {
        alert(t("unlockNotDetected"));
      }
    } catch {
      alert(tc("networkError"));
    }
  };

  // —— 支付后自动轮询解锁 ——
  // 每 2 秒轮询一次 /api/pet/status，检测到 isUnlocked 后自动关闭卡片并继续聊天；
  // 最多轮询 90 次（约 3 分钟），超时则停止并提示手动确认。
  const POLL_INTERVAL_MS = 2000;
  const POLL_MAX_COUNT = 90;

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCountRef = useRef(0);
  const [payTimeout, setPayTimeout] = useState(false);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  // 看到二维码（pay.qr 就绪）后启动轮询
  useEffect(() => {
    if (!pay.qr || !adoptionId) return;

    pollCountRef.current = 0;
    setPayTimeout(false);

    if (pollTimerRef.current !== null) return; // 已有轮询在跑

    pollTimerRef.current = setInterval(async () => {
      pollCountRef.current += 1;

      try {
        const res = await fetch(`/api/pet/status?id=${adoptionId}`);
        const data = await res.json();
        if (data?.ok && data.isUnlocked) {
          stopPolling();
          setBlocked(null);
          setBlockedDismissed(false);
          setPay({ loading: false });
          // 清掉错误态，让聊天回到“就绪”，用户可直接继续发消息
          clearError?.();
          return;
        }
      } catch {
        // 单次轮询失败不中断，继续探测
      }

      // 超过 3 分钟仍未解锁 → 停止轮询，提示手动确认
      if (pollCountRef.current >= POLL_MAX_COUNT) {
        stopPolling();
        setPayTimeout(true);
      }
    }, POLL_INTERVAL_MS);

    // 组件卸载 / 依赖变化时清理
    return () => stopPolling();
  }, [pay.qr, adoptionId, clearError, stopPolling]);

  useEffect(() => {
    if (!error) return;
    try {
      const parsed = JSON.parse(error.message);
      if (
        parsed &&
        parsed.blocked === true &&
        typeof parsed.message === "string"
      ) {
        setBlocked({ message: parsed.message });
        setBlockedDismissed(false);
      }
    } catch {
      // 普通流式/网络错误，不视为被解锁拦截，忽略。
    }
  }, [error]);

  const isLoading = status === "submitted" || status === "streaming";
  const showBlockedCard = blocked !== null && !blockedDismissed;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    sendMessage({ text }, { body: { petType, adoptionId } });
    setInput("");

    // 互动反馈：不影响聊天流式，后台异步更新心情 / 等级 / 积分
    if (adoptionId) {
      fetch("/api/interact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adoptionId, message: text }),
      }).catch(() => {
        // 互动更新失败不影响聊天
      });
    }
  };

  // 检测一次互动结束（从“发送中/流式中”回到“就绪”），触发心情刷新。
  const prevStatusRef = useRef(status);
  const hasSentRef = useRef(false);
  useEffect(() => {
    const wasBusy =
      prevStatusRef.current === "streaming" ||
      prevStatusRef.current === "submitted";
    if (status === "ready" && wasBusy && hasSentRef.current) {
      onInteractionComplete?.();
      hasSentRef.current = false;
    }
    if (status === "streaming" || status === "submitted") {
      hasSentRef.current = true;
    }
    prevStatusRef.current = status;
  }, [status, onInteractionComplete]);

  // 还没有任何历史消息时（第一次打开聊天），本地渲染一条抱抱狐的欢迎语。
  // 这条消息只是前端展示用，不会发给后端、也不会写入数据库，
  // 等用户真正发送第一条消息后，会走正常的 useChat 流程。
  const showWelcome = messages.length === 0;
  const welcome = welcomeMessage ?? pet.welcome;

  return (
    <Card className="relative flex h-full w-full flex-col">
      <CardContent className="flex flex-1 flex-col gap-4 overflow-hidden p-4 sm:p-6">
        <div className="flex-1 space-y-4 overflow-y-auto pr-1">
          {showWelcome && (
            <div className="space-y-3">
              <div className="flex gap-3">
                <AgentAvatar pet={pet} />
                <div className="flex-1 space-y-1">
                  <div className="text-xs font-medium text-orange-600">
                    {pet.name}
                  </div>
                  <div className="rounded-2xl rounded-tl-sm bg-orange-50 px-3 py-2 text-sm text-zinc-800">
                    {welcome}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pl-11">
                {EXAMPLE_PROMPTS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => sendMessage({ text: p }, { body: { petType, adoptionId } })}
                    className="rounded-md border border-orange-200 bg-orange-50/60 px-3 py-1.5 text-xs text-orange-700 hover:bg-orange-100"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => {
            const parts = (m.parts ?? []) as UIPart[];
            return (
              <div key={m.id} className="flex gap-3">
                <div className="mt-0.5 text-zinc-500">
                  {m.role === "user" ? (
                    <User className="h-4 w-4" />
                  ) : (
                    <AgentAvatar pet={pet} className="h-6 w-6" />
                  )}
                </div>
                <div className="flex-1 space-y-2">
                  <div className="text-xs font-medium text-zinc-500">
                    {m.role === "user" ? t("you") : pet.name}
                  </div>
                  {parts.map((part, idx) => {
                    if (part.type === "text") {
                      return (
                        <div
                          key={idx}
                          className="whitespace-pre-wrap text-sm text-zinc-900"
                        >
                          {part.text}
                        </div>
                      );
                    }
                    if (
                      part.type === "tool-invocation" &&
                      part.toolInvocation
                    ) {
                      const ti = part.toolInvocation;
                      return (
                        <ToolCallCard
                          key={idx}
                          toolName={ti.toolName}
                          args={ti.args}
                          result={ti.result}
                          state={ti.state}
                        />
                      );
                    }
                    return null;
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {footerInfo}
        <form onSubmit={handleSubmit} className="flex gap-2 border-t pt-4">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("placeholder", { name: pet.name })}
            disabled={isLoading}
          />
          <Button type="submit" disabled={isLoading || !input.trim()}>
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {t("send")}
          </Button>
        </form>
      </CardContent>

      {/* 商业化变现：10 句免费门槛用尽后，弹出赞助/解锁卡片 */}
      {showBlockedCard && blocked && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-zinc-900/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-amber-200 bg-white p-6 text-center shadow-2xl">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-3xl">
              🧋
            </div>
            <h3 className="text-lg font-bold text-zinc-900">
              {t("needEnergy", { name: pet.name })}
            </h3>
            <p className="mt-2 text-sm text-zinc-600">{blocked.message}</p>
            <p className="mt-1 text-xs text-zinc-400">
              {t("sponsorHint")}
            </p>
            {/* 支付流程 */}
            {pay.qr ? (
              <div className="mt-4 space-y-3">
                <div className="mx-auto flex w-fit rounded-xl border border-zinc-200 bg-white p-3">
                  <QRCodeSVG value={pay.qr} size={176} />
                </div>
                <p className="text-xs text-zinc-500">
                  {t("scanHint")}
                </p>
                {payTimeout ? (
                  <p className="text-xs text-amber-600">
                    {t("timeoutHint")}
                  </p>
                ) : (
                  <p className="text-xs text-zinc-400">
                    {t("waiting")}
                  </p>
                )}
                {pay.payUrl && (
                  <a
                    href={pay.payUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block text-xs text-blue-600 underline"
                  >
                    {t("openPayUrl")}
                  </a>
                )}
                <button
                  type="button"
                  onClick={handleVerifyPay}
                  className="w-full rounded-full bg-amber-500 px-4 py-2.5 font-semibold text-white shadow transition hover:bg-amber-600"
                >
                  {t("confirmPaid")}
                </button>
                <button
                  type="button"
                  onClick={() => setPay({ loading: false })}
                  className="w-full rounded-full border border-zinc-200 px-4 py-2 text-sm text-zinc-500 transition hover:bg-zinc-50"
                >
                  {t("back")}
                </button>
              </div>
            ) : (
              <div className="mt-5 space-y-2">
                {pay.error && (
                  <p className="text-xs text-red-500">{pay.error}</p>
                )}
                <button
                  type="button"
                  onClick={handleStartPay}
                  disabled={pay.loading || !adoptionId}
                  className="w-full rounded-full bg-amber-500 px-4 py-2.5 font-semibold text-white shadow transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pay.loading ? t("generatingQr") : t("startPay")}
                </button>
                <button
                  type="button"
                  onClick={() => setBlockedDismissed(true)}
                  className="w-full rounded-full border border-zinc-200 px-4 py-2 text-sm text-zinc-500 transition hover:bg-zinc-50"
                >
                  {t("later")}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
