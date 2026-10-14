/**
 * 物种视觉注册表（通用宠物状态机 · 换皮层，纯数据模块）。
 *
 * 动画逻辑（sm-contract.ts）与物种外观（本模块）解耦：宠物共用同一台状态机，
 * 外观只是「皮肤」——本表登记每个物种的 Rive 资产 / 静态立绘 / 场景主题。
 *
 * 客户端可安全 import（零 prompt、零 fs）；服务端用同一份注册表做 .riv 上架探测
 * （按 rivePath 逐路径缓存，一个物种缺素材不波及其他物种——雪豹绝不播橘猫素材）。
 *
 * 新增物种 = 只在本表加一条（无需改任何组件/路由）：
 *   <speciesId>: { rivePath?: "<资产key>", staticImage: "<立绘路径>", sceneTheme: "<主题>" }
 *  - 暂时没有 Rive 素材的物种只填 staticImage（或留 "" 由 API 按宠物运行时派生物种头像）；
 *  - 美术交付 <资产key>.riv 放入 assets/rive/ 即自动切换（服务端探测，前端零改动）。
 */
import { SPECIES_AVATARS } from "@/lib/species-avatars";
import { RIVE_ASSET_NAME } from "@/lib/pets/sm-contract";

/** 单个物种的舞台视觉配置。 */
export interface SpeciesVisual {
  /** Rive 资产 key（/api/pet/asset?name=<key> 白名单）；未配置 = 该物种无 Rive 素材，直用静态立绘。 */
  rivePath?: string;
  /** 静态立绘（Rive 缺席 / 加载失败的降级图；空串 = 由调用方按宠物运行时派生物种头像）。 */
  staticImage: string;
  /** 场景主题 key（舞台背景氛围，CSS 类 pet-scene-<theme>；未注册物种回退 DEFAULT_SCENE_THEME）。 */
  sceneTheme: string;
}

/** 默认场景主题（未注册物种）。 */
export const DEFAULT_SCENE_THEME = "meadow";

/**
 * 物种 → 视觉配置注册表（key = species:<id> 的 id 部分）。
 * 当前仅打工橘猫（persian）有契约 Rive 资产；其余物种走 resolveSpeciesVisual 运行时派生。
 */
export const SPECIES_VISUALS: Record<string, SpeciesVisual> = {
  persian: {
    rivePath: RIVE_ASSET_NAME,
    staticImage: "/avatars/persian.png",
    sceneTheme: "workshop",
  },
};

/**
 * 解析物种视觉：注册表命中 → 直接用；未命中 → 无 Rive + 立绘取物种头像表
 * （SPECIES_AVATARS，找不到留空由调用方运行时兜底）+ 默认场景主题。
 * 雪豹等未注册物种因此显示自己的立绘，绝不复用橘猫素材（「雪豹播橘猫」修复点）。
 */
export function resolveSpeciesVisual(speciesId: string | null | undefined): SpeciesVisual {
  const hit = speciesId ? SPECIES_VISUALS[speciesId] : undefined;
  if (hit) return hit;
  return {
    staticImage: (speciesId ? SPECIES_AVATARS[speciesId] : undefined) ?? "",
    sceneTheme: DEFAULT_SCENE_THEME,
  };
}
