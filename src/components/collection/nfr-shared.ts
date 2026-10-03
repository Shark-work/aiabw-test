"use client";

/**
 * 收藏中心 NFR 繁育/转赠弹窗共享物（2026-10-08）：
 *  - CollectibleInstance：GET /api/pets/collectibles 返回的个体维度实例（繁育/转赠操作对象）；
 *  - useNow：秒级心跳，驱动冷却倒计时禁用态实时刷新；
 *  - formatRemaining：剩余毫秒 → 双语紧凑文本（6天 3小时 / 3h 12m）；
 *  - shortHash：确权哈希缩略展示（前 8…后 4）。
 */
import { useEffect, useState } from "react";

export type CollectibleInstance = {
  id: string;
  collectibleId: string;
  speciesId: string;
  name: string;
  rarity: string;
  element: string | null;
  imageUrl: string;
  generation: number;
  hashId: string;
  /** 转赠冷却截止（ISO 字符串；> now 时禁止转赠） */
  lockedUntil: string;
  /** 繁育冷却截止（ISO 字符串；> now 时禁止作为亲本） */
  breedCooldownUntil: string;
  mintedAt: string;
};

/** 每秒刷新当前时间戳（弹窗打开期间驱动倒计时）。 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** 剩余毫秒 → 「6天 3小时」/「3小时 12分」/「8分 05秒」/「42秒」（en: 6d 3h …）。 */
export function formatRemaining(ms: number, isEn: boolean): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return isEn ? `${d}d ${h}h` : `${d}天 ${h}小时`;
  if (h > 0) return isEn ? `${h}h ${m}m` : `${h}小时 ${m}分`;
  if (m > 0) {
    const ss = String(sec).padStart(2, "0");
    return isEn ? `${m}m ${ss}s` : `${m}分 ${ss}秒`;
  }
  return isEn ? `${sec}s` : `${sec}秒`;
}

/** 确权哈希缩略：0a1b2c3d…wxyz */
export function shortHash(hashId: string): string {
  return hashId.length > 12 ? `${hashId.slice(0, 8)}…${hashId.slice(-4)}` : hashId;
}
