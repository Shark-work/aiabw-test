"use client";

import { useEffect, useRef, useState } from "react";

import { PetAvatar } from "@/components/PetAvatar";

type LivingPetProps = {
  src?: string | null;
  alt: string;
  /** 透传给 PetAvatar 的外观类（尺寸/圆角/边框等） */
  className?: string;
  width?: number;
  height?: number;
  priority?: boolean;
  /**
   * 动画错峰延迟（秒）：同一页面多只宠物传 index * 0.35 之类，
   * 避免呼吸/眨眼完全同步（机械感）。默认 0。
   */
  delay?: number;
  /** 是否显示装饰性摇尾（默认 true；小尺寸头像可关掉降噪） */
  tail?: boolean;
};

/**
 * P0「宠物活起来」：PetAvatar 的纯 CSS 动画外壳。
 *  - 呼吸（breathe）+ 轻微浮动（bob）+ 周期眨眼（blink，scaleY 压扁模拟）
 *    + 身后摇尾（装饰尾巴，颜色随主题 --accent）；
 *  - 悬停/聚焦 → 头部转向用户（transition）；
 *  - 点击/触摸 → 撒娇（squash & stretch + 飘心，700ms 后自动复位）；
 *  - prefers-reduced-motion 下全部动画停用（见 globals.css）。
 * 分层动画各管各的 transform，互不覆盖；仅 transform/opacity，走 GPU 合成。
 */
export function LivingPet({
  src,
  alt,
  className,
  width = 96,
  height = 96,
  priority = false,
  delay = 0,
  tail = true,
}: LivingPetProps) {
  const [patting, setPatting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
  }, []);

  const handlePat = () => {
    setPatting(true);
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setPatting(false), 720);
  };

  const blinkDelay = delay * 1.7; // 眨眼错峰更明显

  return (
    <span
      className={`living-pet${patting ? " living-pet--pat" : ""}`}
      onPointerDown={handlePat}
    >
      {tail && (
        <span
          className="living-pet__tail"
          style={{ animationDelay: `${delay}s` }}
          aria-hidden
        />
      )}
      <span
        className="living-pet__body"
        style={{ animationDelay: `${delay}s` }}
      >
        <span className="living-pet__head">
          <span
            className="living-pet__blink"
            style={{ animationDelay: `${blinkDelay}s` }}
          >
            <PetAvatar
              src={src}
              alt={alt}
              width={width}
              height={height}
              priority={priority}
              className={className ? `living-pet__img ${className}` : "living-pet__img"}
            />
          </span>
        </span>
      </span>
      {patting && (
        <>
          <span className="living-pet__heart living-pet__heart--0" aria-hidden>
            ❤️
          </span>
          <span className="living-pet__heart living-pet__heart--1" aria-hidden>
            💛
          </span>
          <span className="living-pet__heart living-pet__heart--2" aria-hidden>
            ❤️
          </span>
        </>
      )}
    </span>
  );
}
