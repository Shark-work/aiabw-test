"use client";

import { useEffect, useState } from "react";
import { useRive } from "@rive-app/react-canvas";

import { LivingPet } from "@/components/LivingPet";
import {
  PET_MOODS,
  RIVE_STATE_MACHINE,
  type PetAction,
  type PetMood,
} from "@/lib/pets/sm-contract";
import { resolveSpeciesVisual } from "@/lib/pets/species-visuals";

/** mood → Rive Number 输入索引（与 PET_MOODS 白名单顺序一致，美术侧按此绑定）。 */
const MOOD_INDEX = new Map<string, number>(PET_MOODS.map((e, i) => [e, i]));

/** 降级模式 mood → 外层 CSS 动画类（Rive 缺席时的情绪外显）。 */
const FALLBACK_ANIM: Record<PetMood, string> = {
  idle: "",
  happy: "animate-bounce",
  sad: "animate-pulse opacity-75",
  angry: "pet-play-shake",
  hungry: "animate-pulse",
  thinking: "animate-pulse",
  sleepy: "animate-pulse opacity-80",
};

interface PetStageProps {
  /** JWT（/api/pet/asset 鉴权下载 .riv 用；null 时直接走降级立绘） */
  token: string | null;
  /** 物种 id（species:<id> 的 id 部分；官方宠物/未知为 null）——经物种视觉注册表决定素材/立绘/场景 */
  speciesId?: string | null;
  /**
   * 服务端资产上架探测（/api/pet/play|movie 聚合响应下发）：
   * false = .riv 未随部署上架 → **零请求直降**静态立绘（无 404 / console.error / toast 噪音）；
   * 缺省 true = 保留旧探测行为（fetch 失败走 console.error + onAssetFailed 兜底链）。
   */
  riveAvailable?: boolean;
  /** 降级立绘（物种头像 / 官方宠物图） */
  avatar: string;
  alt: string;
  mood: PetMood;
  action: PetAction;
  /** 情绪强度 0-2（Rive Number 输入「intensity」，资产未做该输入时自动跳过） */
  intensity?: 0 | 1 | 2;
  /** 资产加载失败上报（需求二.2：控制台明确错误 + 页面轻提示，禁止静默失败） */
  onAssetFailed?: (reason: string) => void;
  /** 点击宠物（蹭蹭互动：直接 fire rub 动作位 + 通知父组件播音效/台词） */
  onPetTap?: () => void;
}

/**
 * 宠物舞台（需求三.1 核心）：@rive-app/react-canvas 加载 .riv + 接入 State Machine。
 *  - 物种换皮：speciesId → species-visuals 注册表（rivePath / 立绘 / 场景主题），
 *    动画契约（sm-contract）与物种外观解耦；未注册物种零请求直降各自立绘；
 *  - 资产通道：fetch /api/pet/asset?name=<rivePath>（Bearer 鉴权 + 限流 + Referer 校验）→ ArrayBuffer → useRive；
 *    失败（401/404/网络错）console.error 明确原因 + onAssetFailed 上报 + 降级 LivingPet
 *    （呼吸/眨眼/摇尾），**不静默失败**（需求二.2）；
 *  - 上架探测短路：riveAvailable=false（服务端已探测 .riv 未随部署上架）时**零请求直降**
 *    静态立绘——不发注定 404 的鉴权请求（console 红字 + toast 噪音消除）；上架后自动切回；
 *  - 素材自适应：二进制探测资产是否含 PetStateMachine（素材 = 默认 State Machine 1
 *    → autoplay 默认动画，输入绑定挂起；契约资产 → 全绑定），两类资产同一代码兼容；
 *  - 状态机契约：mood → Number 输入「emotion」（白名单索引）；intensity → Number 输入
 *    「intensity」（0-2）；action → 同名 Trigger fire；全部经映射表驱动（需求三.2）；
 *  - 点击宠物 = 蹭蹭（rub Trigger），双模共用同一 { mood, action, intensity } 驱动接口。
 */
export function PetStage({ token, speciesId = null, riveAvailable = true, avatar, alt, mood, action, intensity = 1, onAssetFailed, onPetTap }: PetStageProps) {
  // 物种换皮：视觉注册表按 speciesId 解析（rivePath 资产 / 静态立绘 / 场景主题）；
  // 未注册物种 rivePath=undefined → 零请求直降各自立绘（雪豹绝不复用橘猫素材）。
  const visual = resolveSpeciesVisual(speciesId);
  const sprite = visual.staticImage || avatar;
  const [riveUrl, setRiveUrl] = useState<string | null>(null);
  /** 资产是否含契约状态机（PetStateMachine）：素材资产=false → autoplay 默认动画 */
  const [contractSM, setContractSM] = useState(false);
  const [assetFailed, setAssetFailed] = useState(false);
  const [rubbing, setRubbing] = useState(false);

  // 1) 经鉴权 API 拉取 .riv（防盗链：无公开 URL）→ Blob ObjectURL；失败上报 + 降级
  useEffect(() => {
    if (!token) return;
    // 物种无 Rive 素材（注册表未配 rivePath）：零请求直降静态立绘（info 级，非错误）。
    if (!visual.rivePath) {
      console.info(`[pet-stage] no Rive asset registered for species "${speciesId ?? "unknown"}"; static sprite mode (zero-fetch)`);
      return;
    }
    // 服务端已探测 .riv 未上架：零请求直降静态立绘（info 级透明信息，非错误）。
    // 资产随部署上架后聚合响应 riveAvailable=true，本短路自动解除。
    if (!riveAvailable) {
      console.info("[pet-stage] Rive asset not deployed on server; static sprite mode (zero-fetch)");
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    void (async () => {
      try {
        const res = await fetch(`/api/pet/asset?name=${visual.rivePath}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`asset ${res.status}`);
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        // 契约探测（素材自适应）：.riv 二进制中状态机名以明文字符串存储。
        // 含 PetStateMachine = 契约资产 → 绑定状态机 + emotion/intensity/Trigger 输入；
        // 不含 = 社区素材（默认 State Machine 1）→ 省略 stateMachines 让运行时
        // autoplay 默认动画——指定不存在的状态机会冻结画面并触发 wasm 报错。
        setContractSM(new TextDecoder().decode(buf).includes(RIVE_STATE_MACHINE));
        objectUrl = URL.createObjectURL(new Blob([buf], { type: "application/octet-stream" }));
        setRiveUrl(objectUrl);
      } catch (err) {
        // 需求二.2：控制台明确错误（含 HTTP 状态）+ 上报父组件轻提示，不静默
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`[pet-stage] Rive asset load failed (${reason}); falling back to static sprite`);
        if (!cancelled) {
          setAssetFailed(true);
          onAssetFailed?.(reason);
        }
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, riveAvailable, visual.rivePath, speciesId]);

  // 2) Rive 初始化（react 4.x 类型契约 src:string → Blob URL；会话内私有、卸载即吊销）
  //    contractSM=false（素材资产）时不指定 stateMachines → autoplay 默认状态机/动画
  const { rive, RiveComponent } = useRive({
    src: riveUrl ?? undefined,
    stateMachines: contractSM ? RIVE_STATE_MACHINE : undefined,
    autoplay: true,
  });

  // 3) mood → Number 输入「emotion」同步；intensity → Number 输入「intensity」（duck typing）
  useEffect(() => {
    if (!rive) return;
    try {
      const inputs = rive.stateMachineInputs(RIVE_STATE_MACHINE) ?? [];
      const emotionInput = inputs.find((i) => i.name === "emotion");
      if (emotionInput && typeof emotionInput.value === "number") {
        emotionInput.value = MOOD_INDEX.get(mood) ?? 0;
      }
      const intensityInput = inputs.find((i) => i.name === "intensity");
      if (intensityInput && typeof intensityInput.value === "number") {
        intensityInput.value = intensity;
      }
    } catch {
      // 状态机输入缺失（资产未按约定制作）时静默，不打断互动
    }
  }, [rive, mood, intensity]);

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

  // 5) 蹭蹭互动（需求三.2 rub 动作位：点击宠物直接 fire，不占情绪位）
  const handleTap = () => {
    onPetTap?.();
    if (rive) {
      try {
        const trigger = (rive.stateMachineInputs(RIVE_STATE_MACHINE) ?? []).find(
          (i) => i.name === "rub",
        );
        if (trigger && typeof trigger.fire === "function") trigger.fire();
      } catch {
        /* 输入缺失静默 */
      }
    } else {
      // 降级模式：短暂 CSS 弹跳反馈
      setRubbing(true);
      setTimeout(() => setRubbing(false), 600);
    }
  };

  // 6) 双模渲染
  if (riveUrl && !assetFailed) {
    return (
      <button type="button" onClick={handleTap} aria-label={alt} className={`cursor-pointer pet-scene-${visual.sceneTheme}`}>
        <RiveComponent
          className="h-[46vh] w-[46vh] max-h-[420px] max-w-[420px]"
          aria-label={alt}
        />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={handleTap}
      aria-label={alt}
      className={`cursor-pointer transition-transform duration-300 pet-scene-${visual.sceneTheme} ${FALLBACK_ANIM[mood]} ${rubbing ? "scale-105" : ""}`}
    >
      <LivingPet src={sprite} alt={alt} width={280} height={280} priority />
    </button>
  );
}
