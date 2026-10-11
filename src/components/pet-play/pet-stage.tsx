"use client";

import { useEffect, useState } from "react";
import { useRive } from "@rive-app/react-canvas";

import { LivingPet } from "@/components/LivingPet";
import {
  PLAY_EMOTIONS,
  RIVE_ASSET_NAME,
  RIVE_STATE_MACHINE,
  type PlayAction,
  type PlayEmotion,
} from "@/lib/pet-play-config";

/** emotion → Rive Number 输入索引（与 pet-play-config 白名单顺序一致，美术侧按此绑定）。 */
const EMOTION_INDEX = new Map<string, number>(PLAY_EMOTIONS.map((e, i) => [e, i]));

/** 降级模式 emotion → 外层 CSS 动画类（Rive 缺席时的情绪外显）。 */
const FALLBACK_ANIM: Record<PlayEmotion, string> = {
  idle: "",
  happy: "animate-bounce",
  sad: "animate-pulse opacity-75",
  angry: "pet-play-shake",
  eating: "animate-pulse",
  thinking: "animate-pulse",
};

interface PetStageProps {
  /** JWT（/api/pet/asset 鉴权下载 .riv 用；null 时直接走降级立绘） */
  token: string | null;
  /** 降级立绘（物种头像 / 官方宠物图） */
  avatar: string;
  alt: string;
  emotion: PlayEmotion;
  action: PlayAction;
}

/**
 * 宠物舞台（需求 1.1 核心）：Rive 渲染优先，CSS 动画立绘降级双模。
 *  - 资产通道：fetch /api/pet/asset（Bearer 鉴权 + 限流）→ ArrayBuffer → useRive；
 *    401/404/网络错误（.riv 未上架）自动降级 LivingPet（呼吸/眨眼/摇尾/点击撒娇）；
 *  - 状态机契约：emotion → Number 输入「emotion」（白名单索引）；action → 同名 Trigger fire；
 *  - 双模共用同一 { emotion, action } 驱动接口，上层零感知。
 */
export function PetStage({ token, avatar, alt, emotion, action }: PetStageProps) {
  const [riveUrl, setRiveUrl] = useState<string | null>(null);
  const [assetFailed, setAssetFailed] = useState(false);

  // 1) 经鉴权 API 拉取 .riv（防盗链：无公开 URL；失败即降级）→ Blob ObjectURL
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    void (async () => {
      try {
        const res = await fetch(`/api/pet/asset?name=${RIVE_ASSET_NAME}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`asset ${res.status}`);
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(new Blob([buf], { type: "application/octet-stream" }));
        setRiveUrl(objectUrl);
      } catch {
        if (!cancelled) setAssetFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [token]);

  // 2) Rive 初始化（react 4.x 类型契约 src:string → Blob URL；会话内私有、卸载即吊销）
  const { rive, RiveComponent } = useRive({
    src: riveUrl ?? undefined,
    stateMachines: RIVE_STATE_MACHINE,
    autoplay: true,
  });

  // 3) emotion → Number 输入同步（duck typing：数值输入有 value 属性）
  useEffect(() => {
    if (!rive) return;
    try {
      const input = (rive.stateMachineInputs(RIVE_STATE_MACHINE) ?? []).find(
        (i) => i.name === "emotion",
      );
      if (input && typeof input.value === "number") {
        input.value = EMOTION_INDEX.get(emotion) ?? 0;
      }
    } catch {
      // 状态机输入缺失（资产未按约定制作）时静默，不打断互动
    }
  }, [rive, emotion]);

  // 4) action → 同名 Trigger 触发（duck typing：Trigger 有 fire 方法）
  useEffect(() => {
    if (!rive || action === "idle") return;
    try {
      const trigger = (rive.stateMachineInputs(RIVE_STATE_MACHINE) ?? []).find(
        (i) => i.name === action,
      );
      if (trigger && typeof trigger.fire === "function") trigger.fire();
    } catch {
      // 同上：输入缺失静默
    }
  }, [rive, action]);

  // 5) 双模渲染
  if (riveUrl && !assetFailed) {
    return (
      <RiveComponent
        className="h-[46vh] w-[46vh] max-h-[420px] max-w-[420px]"
        aria-label={alt}
      />
    );
  }
  return (
    <div className={`transition-transform duration-300 ${FALLBACK_ANIM[emotion]}`}>
      <LivingPet src={avatar} alt={alt} width={280} height={280} priority />
    </div>
  );
}
