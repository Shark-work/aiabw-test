/**
 * 宠物互动轻量音效（需求七.2）：WebAudio 振荡器短促提示音——零音频素材、零依赖；
 * 静音开关 localStorage 持久化（aiabw_pet_mute），页面工具条可切换。
 * 音频环境不可用（SSR/老浏览器/权限未手势解锁）时全部静默跳过，不影响互动。
 */
const MUTE_KEY = "aiabw_pet_mute";

export type PetSoundKind = "send" | "reply" | "feed" | "buy";

let ctx: AudioContext | null = null;

/** 当前是否静音（SSR 返回 true——服务端绝不发音）。 */
export function isPetMuted(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

/** 设置静音（localStorage 持久化，跨会话生效）。 */
export function setPetMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    /* 存储不可用仅影响记忆 */
  }
}

/** 播放短提示音（静音/无 AudioContext 环境静默跳过）。 */
export function playPetSound(kind: PetSoundKind): void {
  if (typeof window === "undefined" || isPetMuted()) return;
  try {
    type Win = typeof window & { webkitAudioContext?: typeof AudioContext };
    const AC = window.AudioContext ?? (window as Win).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === "suspended") void ctx.resume();
    const conf: Record<PetSoundKind, { f: number; f2: number; d: number }> = {
      send: { f: 520, f2: 660, d: 0.09 },
      reply: { f: 780, f2: 990, d: 0.14 },
      feed: { f: 320, f2: 480, d: 0.18 },
      buy: { f: 660, f2: 880, d: 0.16 },
    };
    const { f, f2, d } = conf[kind];
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    osc.type = "sine";
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.exponentialRampToValueAtTime(f2, t + d);
    gain.gain.setValueAtTime(0.08, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + d);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + d + 0.02);
  } catch {
    /* 音频不可用不影响互动 */
  }
}
