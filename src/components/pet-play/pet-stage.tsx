"use client";

import { useEffect, useState } from "react";
import { useRive } from "@rive-app/react-canvas";

import { LivingPet } from "@/components/LivingPet";
import {
  ACTION_TRIGGER_ALIAS,
  PET_MOODS,
  PET_SM_TRIGGERS,
  RIVE_STATE_MACHINE,
  type PetAction,
  type PetMood,
} from "@/lib/pets/sm-contract";
import { resolveSpeciesVisual, type SpeciesVisual } from "@/lib/pets/species-visuals";

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
   * CMS 物种视觉覆写（任务四：/api/pet/play|movie 聚合响应下发，60s 缓存 + afterChange 即新）：
   * 优先于客户端注册表——后台改物种视觉（Rive 素材/立绘/场景）直达舞台；
   * null = 回退 resolveSpeciesVisual(speciesId) 注册表（与接入前行为一致）。
   */
  visualOverride?: SpeciesVisual | null;
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
  /** 情绪强度 0-1（Rive Number 输入「intensity」，资产未做该输入时自动跳过） */
  intensity?: number;
  /** 互动意图（契约 Trigger 五值 pet/eat/play/sleep/wake；优先于 action 旧名驱动一次性动作） */
  intent?: string | null;
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
 *  - 状态机契约 v2：mood → Number 输入「emotion」（白名单索引）；intensity → Number 输入
 *    「intensity」（0-1）；intent → 契约 Trigger（五值；无 intent 时 action 旧名经别名翻译）；
 *  - 契约资产缺输入 → console.error 明确报错（美术交付红线不静默；素材资产无契约输入属正常）；
 *  - 无障碍：prefers-reduced-motion → 一次性动作 Trigger / CSS 情绪动画豁免（情绪状态保留）；
 *  - 点击宠物 = 蹭蹭（pet Trigger，经 ACTION_TRIGGER_ALIAS.rub 别名），双模共用同一驱动接口。
 */
export function PetStage({ token, speciesId = null, visualOverride = null, riveAvailable = true, avatar, alt, mood, action, intensity = 0.5, intent = null, onAssetFailed, onPetTap }: PetStageProps) {
  // 物种换皮：CMS 视觉覆写优先（任务四：后台改表直达舞台），注册表兜底；
  // 未注册物种 rivePath=undefined → 零请求直降各自立绘（雪豹绝不复用橘猫素材）。
  const visual = visualOverride ?? resolveSpeciesVisual(speciesId);
  const sprite = visual.staticImage || avatar;
  const [riveUrl, setRiveUrl] = useState<string | null>(null);
  /** 资产是否含契约状态机（PetStateMachine）：素材资产=false → autoplay 默认动画 */
  const [contractSM, setContractSM] = useState(false);
  const [assetFailed, setAssetFailed] = useState(false);
  const [rubbing, setRubbing] = useState(false);
  // 减少动态偏好（无障碍红线）：一次性动作 Trigger / CSS 情绪动画豁免，情绪状态保留
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

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

  // 3) mood → Number 输入「emotion」同步；intensity → Number 输入「intensity」（duck typing）；
  //    契约资产缺输入 = 美术交付不符契约（assets/rive/README.md）→ console.error 不静默；
  //    素材资产（contractSM=false）本就无契约输入 → 正常跳过
  useEffect(() => {
    if (!rive) return;
    try {
      const inputs = rive.stateMachineInputs(RIVE_STATE_MACHINE) ?? [];
      const emotionInput = inputs.find((i) => i.name === "emotion");
      if (emotionInput && typeof emotionInput.value === "number") {
        emotionInput.value = MOOD_INDEX.get(mood) ?? 0;
      } else if (contractSM) {
        console.error(`[pet-stage] contract asset missing Number input "emotion" (SM=${RIVE_STATE_MACHINE})`);
      }
      const intensityInput = inputs.find((i) => i.name === "intensity");
      if (intensityInput && typeof intensityInput.value === "number") {
        intensityInput.value = intensity;
      } else if (contractSM) {
        console.error(`[pet-stage] contract asset missing Number input "intensity" (SM=${RIVE_STATE_MACHINE})`);
      }
    } catch {
      // 状态机未挂载（资产加载中）时静默，不打断互动
    }
  }, [rive, mood, intensity, contractSM]);

  // 4) intent → 契约 Trigger 触发（v2 五值 pet/eat/play/sleep/wake，duck typing：Trigger 有 fire 方法）；
  //    无 intent 时按 action 旧名经 ACTION_TRIGGER_ALIAS 翻译（向后兼容；think/wave/情绪位无 Trigger 不 fire）
  useEffect(() => {
    if (!rive) return;
    // 减少动态偏好：跳过一次性动作（情绪状态由 emotion 输入保留，宠物不突然抽动）
    if (reducedMotion) return;
    const name =
      intent && (PET_SM_TRIGGERS as readonly string[]).includes(intent)
        ? intent
        : (ACTION_TRIGGER_ALIAS[action] ?? null);
    if (!name) return;
    try {
      const trigger = (rive.stateMachineInputs(RIVE_STATE_MACHINE) ?? []).find(
        (i) => i.name === name,
      );
      if (trigger && typeof trigger.fire === "function") {
        trigger.fire();
      } else if (contractSM) {
        // 契约资产缺 Trigger = 美术交付不符契约 → console.error 不静默
        console.error(`[pet-stage] contract asset missing Trigger input "${name}" (SM=${RIVE_STATE_MACHINE})`);
      }
    } catch {
      // 同上：状态机未挂载静默
    }
  }, [rive, intent, action, contractSM, reducedMotion]);

  // 5) 蹭蹭互动（需求三.2 rub 动作位：点击宠物直接 fire，不占情绪位；
  //    减少动态偏好 → 跳过动作动画，音效/台词仍触发）
  const handleTap = () => {
    onPetTap?.();
    if (reducedMotion) return;
    if (rive) {
      try {
        const trigger = (rive.stateMachineInputs(RIVE_STATE_MACHINE) ?? []).find(
          (i) => i.name === ACTION_TRIGGER_ALIAS.rub,
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
      className={`cursor-pointer transition-transform duration-300 pet-scene-${visual.sceneTheme} ${reducedMotion ? "" : FALLBACK_ANIM[mood]} ${rubbing ? "scale-105" : ""}`}
    >
      <LivingPet src={sprite} alt={alt} width={280} height={280} priority />
    </button>
  );
}
