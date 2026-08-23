"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { QRCodeCanvas } from "qrcode.react";

/**
 * 支付二维码（移动端长按识别优化）：
 *  - 用 <canvas> 渲染二维码后转 PNG dataURL，再以 <img> 输出；
 *  - <img> 原生支持微信「长按识别图中二维码」（不设 user-select:none、不加遮罩层）；
 *  - 二维码下方固定提示「👆 长按图片可识别微信支付」。
 */
export function PayQr({ value, size = 200 }: { value: string; size?: number }) {
  const t = useTranslations("pay");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [imgSrc, setImgSrc] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) setImgSrc(canvas.toDataURL("image/png"));
    else setImgSrc(null);
  }, [value]);

  return (
    <div className="flex flex-col items-center gap-3 py-2">
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        {/* 隐藏 canvas 用于生成二维码图片；不渲染遮罩，保证长按可用 */}
        <QRCodeCanvas ref={canvasRef} value={value} size={size} className="hidden" aria-hidden />
        {imgSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imgSrc}
            alt={t("qrAlt")}
            width={size}
            height={size}
            draggable={false}
            className="rounded-md"
          />
        ) : (
          <span style={{ width: size, height: size }} className="block" aria-hidden />
        )}
      </div>
      <p className="text-xs text-zinc-500">{t("longPressHint")}</p>
    </div>
  );
}
