"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { QRCodeCanvas } from "qrcode.react";

import { Link } from "@/i18n/navigation";
import {
  DIARY_CARD_HEIGHT,
  DIARY_CARD_WIDTH,
  DIARY_THEMES,
  SITE_URL_FOR_QR,
  SITE_WATERMARK,
  moodEmojiOf,
  type DiaryTheme,
  type DiaryThemeId,
} from "@/lib/ugc-workshop";

type Pet = {
  id: string;
  petName: string;
  displayName: string;
  avatar: string;
  happiness: number;
};

type DiaryRecord = {
  petId: string | null;
  title: string;
  description: string;
  emoji: string;
};

/** 卡片上由前端注入的双语文案（标题/心情/日期） */
type CardLabels = { moodLabel: string; monologueLabel: string; dateLabel: string };

/** 圆角矩形路径（不填充不描边，由调用方决定） */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 自动换行绘制：按字符累积测宽，超宽换行；最多 maxLines 行，超出以 … 收尾 */
function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
) {
  let line = "";
  let lineNo = 0;
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > maxWidth || ch === "\n") {
      lineNo += 1;
      if (lineNo >= maxLines) {
        ctx.fillText(line.replace(/.$/, "…"), x, y);
        return;
      }
      ctx.fillText(line, x, y);
      y += lineHeight;
      line = ch === "\n" ? "" : ch;
    } else {
      line += ch;
    }
  }
  if (line) ctx.fillText(line, x, y);
}

/** 加载头像（跨域安全；失败返回 null → 调用方画 emoji 占位） */
function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * 把宠物 + 日记数据合成为 1080×1350 竖版卡片：
 *  背景渐变 → 圆形头像 → 宠物名 → 心情 emoji → 独白卡片（自动换行）
 *  → 日期 + 站点二维码 + 底部域名水印（裂变引流）
 */
async function renderDiaryCard(
  canvas: HTMLCanvasElement,
  opts: {
    pet: Pet;
    record: DiaryRecord | null;
    theme: DiaryTheme;
    qrCanvas: HTMLCanvasElement | null;
    labels: CardLabels;
    fallbackMonologue: string;
  },
) {
  const { pet, record, theme, qrCanvas, labels, fallbackMonologue } = opts;
  const W = DIARY_CARD_WIDTH;
  const H = DIARY_CARD_HEIGHT;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // 1) 背景：主题渐变 + 装饰圆点
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, theme.bgFrom);
  bg.addColorStop(1, theme.bgTo);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = `${theme.accent}26`; // ≈15% 透明度
  for (const [cx, cy, r] of [
    [90, 120, 60],
    [990, 90, 42],
    [1010, 620, 66],
    [70, 900, 48],
  ] as const) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 2) 圆形头像（accent 外环 + cover 裁剪；加载失败 → emoji 占位）
  const AC_X = W / 2;
  const AC_Y = 210;
  const AC_R = 118;
  ctx.fillStyle = theme.accent;
  ctx.beginPath();
  ctx.arc(AC_X, AC_Y, AC_R + 10, 0, Math.PI * 2);
  ctx.fill();
  const img = await loadImage(pet.avatar);
  ctx.save();
  ctx.beginPath();
  ctx.arc(AC_X, AC_Y, AC_R, 0, Math.PI * 2);
  ctx.clip();
  if (img) {
    const side = Math.min(img.width, img.height);
    ctx.drawImage(
      img,
      (img.width - side) / 2,
      (img.height - side) / 2,
      side,
      side,
      AC_X - AC_R,
      AC_Y - AC_R,
      AC_R * 2,
      AC_R * 2,
    );
  } else {
    ctx.fillStyle = theme.cardBg;
    ctx.fillRect(AC_X - AC_R, AC_Y - AC_R, AC_R * 2, AC_R * 2);
    ctx.font = "120px serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("🐾", AC_X, AC_Y + 8);
  }
  ctx.restore();

  // 3) 宠物名 + 心情行
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = theme.textMain;
  ctx.font = 'bold 64px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(pet.displayName || pet.petName, W / 2, 420);
  ctx.font = '56px "PingFang SC", "Microsoft YaHei", sans-serif';
  const mood = moodEmojiOf(pet.happiness);
  ctx.fillText(`${mood} ${labels.moodLabel}`, W / 2, 520);

  // 4) 独白卡片：白底圆角 + 标题 + 自动换行正文（来源事件 emoji 放右上角）
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.08)";
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 8;
  roundRect(ctx, 90, 580, 900, 400, 36);
  ctx.fillStyle = theme.cardBg;
  ctx.fill();
  ctx.restore();
  ctx.textAlign = "left";
  ctx.fillStyle = theme.textSub;
  ctx.font = '36px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(`✎ ${labels.monologueLabel}`, 150, 660);
  if (record?.emoji) {
    ctx.font = "72px serif";
    ctx.textAlign = "right";
    ctx.fillText(record.emoji, 930, 670);
    ctx.textAlign = "left";
  }
  ctx.fillStyle = theme.textMain;
  ctx.font = '40px "PingFang SC", "Microsoft YaHei", sans-serif';
  const monologue = record?.description || fallbackMonologue;
  drawWrappedText(ctx, monologue, 150, 750, 780, 64, 4);

  // 5) 底部：站点二维码 + 日期 + 引导语
  if (qrCanvas) {
    ctx.fillStyle = "#FFFFFF";
    roundRect(ctx, 100, 1060, 170, 170, 20);
    ctx.fill();
    ctx.drawImage(qrCanvas, 110, 1070, 150, 150);
  }
  const now = new Date();
  const dateStr = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, "0")}.${String(
    now.getDate(),
  ).padStart(2, "0")}`;
  ctx.textAlign = "left";
  ctx.fillStyle = theme.textMain;
  ctx.font = 'bold 44px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(`📅 ${dateStr}`, 310, 1130);
  ctx.fillStyle = theme.textSub;
  ctx.font = '30px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(`${labels.dateLabel} · ${SITE_WATERMARK}`, 310, 1190);

  // 6) 底部固定站点域名水印（裂变引流，不可去除）
  ctx.textAlign = "center";
  ctx.fillStyle = theme.textSub;
  ctx.font = '28px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(SITE_WATERMARK, W / 2, 1310);
}


/** 宠物日记卡片生成器（纯前端，零后端成本） */
export function DiaryCardClient() {
  const t = useTranslations("workshop.diary");
  const tm = useTranslations("workshop");
  const [auth, setAuth] = useState<"loading" | "guest" | "authed">("loading");
  const [pets, setPets] = useState<Pet[]>([]);
  const [petId, setPetId] = useState("");
  const [records, setRecords] = useState<DiaryRecord[]>([]);
  const [themeId, setThemeId] = useState<DiaryThemeId>("fresh");
  const [cardUrl, setCardUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [failed, setFailed] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const qrRef = useRef<HTMLCanvasElement>(null);

  // 加载宠物列表 + 最近探索日记（作为"今日独白"素材）
  useEffect(() => {
    const token = localStorage.getItem("aiabw_token");
    if (!token) {
      setAuth("guest");
      return;
    }
    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetch("/api/pets", { headers }).then((r) => r.json()),
      fetch("/api/exploration/history?limit=30", { headers }).then((r) => r.json()),
    ])
      .then(([petsData, historyData]) => {
        const list = (petsData?.pets ?? []) as Pet[];
        setPets(list);
        setRecords((historyData?.records ?? []) as DiaryRecord[]);
        if (list.length > 0) setPetId(list[0].id);
        setAuth("authed");
      })
      .catch(() => {
        setFailed(true);
        setAuth("authed");
      });
  }, []);

  const pet = pets.find((p) => p.id === petId) ?? null;
  // 独白来源：优先该宠物最新一条日记；否则取任意最新一条；没有则 fallback 文案
  const record =
    records.find((r) => r.petId && r.petId === petId) ??
    records.find((r) => !r.petId) ??
    records[0] ??
    null;
  const theme = DIARY_THEMES.find((th) => th.id === themeId) ?? DIARY_THEMES[0];

  // 宠物/日记/主题任一变化 → 重新合成卡片
  useEffect(() => {
    if (!pet || !canvasRef.current) return;
    let cancelled = false;
    setRendering(true);
    renderDiaryCard(canvasRef.current, {
      pet,
      record,
      theme,
      qrCanvas: qrRef.current,
      labels: {
        moodLabel: t("moodToday"),
        monologueLabel: t("monologueTitle"),
        dateLabel: t("dateLabel"),
      },
      fallbackMonologue: t("emptyMonologue"),
    })
      .then(() => {
        if (!cancelled && canvasRef.current) {
          setCardUrl(canvasRef.current.toDataURL("image/png"));
        }
      })
      .catch(() => !cancelled && setFailed(true))
      .finally(() => !cancelled && setRendering(false));
    return () => {
      cancelled = true;
    };
  }, [pet, record, theme, t]);

  // 保存到相册（桌面端直接下载；移动端提示长按保存）
  const handleSave = () => {
    if (!cardUrl) return;
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
      now.getDate(),
    ).padStart(2, "0")}`;
    const a = document.createElement("a");
    a.href = cardUrl;
    a.download = `diary-card-${stamp}.png`;
    a.click();
  };

  // 分享：优先 Web Share API（带文件）；不支持则降级提示手动分享
  const handleShare = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/png"),
      );
      if (blob) {
        const file = new File([blob], "diary-card.png", { type: "image/png" });
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: tm("diaryCardTitle") });
          return;
        }
      }
    } catch {
      /* 用户取消或不支持 → 走降级 */
    }
    window.alert(t("shareFallback"));
  };


  // ── 渲染 ──────────────────────────────────────────────
  if (auth === "loading") {
    return <p className="py-20 text-center text-sm text-zinc-500">{t("loading")}</p>;
  }
  if (auth === "guest") {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <p className="text-sm text-zinc-600">{t("loginFirst")}</p>
        <Link
          href="/login"
          className="mt-4 inline-block rounded-full bg-orange-500 px-6 py-2 text-sm font-semibold text-white"
        >
          {t("goLogin")}
        </Link>
      </div>
    );
  }
  if (pets.length === 0) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <p className="text-sm text-zinc-600">{t("noPet")}</p>
        <Link
          href="/pets"
          className="mt-4 inline-block rounded-full bg-orange-500 px-6 py-2 text-sm font-semibold text-white"
        >
          🐾
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="text-center text-xl font-bold text-zinc-900 sm:text-2xl">
        📔 {tm("diaryCardTitle")}
      </h1>

      {/* 隐藏画布：卡片合成 + 站点二维码（离屏） */}
      <canvas ref={canvasRef} className="hidden" aria-hidden />
      <QRCodeCanvas ref={qrRef} value={SITE_URL_FOR_QR} size={160} className="hidden" aria-hidden />

      {/* 宠物选择 */}
      <div className="mt-6">
        <p className="mb-2 text-xs font-semibold text-zinc-500">{t("selectPet")}</p>
        <div className="flex flex-wrap gap-2">
          {pets.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPetId(p.id)}
              className={`rounded-full border px-4 py-1.5 text-sm transition ${
                p.id === petId
                  ? "border-emerald-500 bg-emerald-500 text-white"
                  : "border-zinc-200 bg-white text-zinc-700 hover:border-emerald-300"
              }`}
            >
              {p.displayName || p.petName}
            </button>
          ))}
        </div>
      </div>

      {/* 主题切换（3 种） */}
      <div className="mt-4 flex gap-2">
        {DIARY_THEMES.map((th) => (
          <button
            key={th.id}
            type="button"
            onClick={() => setThemeId(th.id)}
            className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium transition ${
              th.id === themeId
                ? "border-zinc-900 bg-zinc-900 text-white"
                : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400"
            }`}
          >
            {t(`theme${th.id[0].toUpperCase()}${th.id.slice(1)}`)}
          </button>
        ))}
      </div>

      {/* 卡片预览（<img> 原生支持长按保存，微信兼容） */}
      <div className="mt-6 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
        {cardUrl && !failed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cardUrl} alt={tm("diaryCardTitle")} className="block w-full" draggable={false} />
        ) : (
          <p className="py-32 text-center text-sm text-zinc-400">
            {failed ? t("loadFailed") : t("loading")}
          </p>
        )}
      </div>
      <p className="mt-2 text-center text-xs text-zinc-400">{t("longPressSave")}</p>

      {/* 操作按钮 */}
      <div className="mt-4 flex gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={!cardUrl || rendering}
          className="flex-1 rounded-full bg-emerald-500 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-600 disabled:opacity-50"
        >
          ⬇️ {t("save")}
        </button>
        <button
          type="button"
          onClick={handleShare}
          disabled={!cardUrl || rendering}
          className="flex-1 rounded-full border border-zinc-300 bg-white px-4 py-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50"
        >
          📤 {t("share")}
        </button>
      </div>
    </div>
  );
}

