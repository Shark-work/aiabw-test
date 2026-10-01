"use client";

/**
 * AibiCard · 艾比统一动态角色卡（Phase 8 升级 · 指令集阶段 8）
 *
 * 五档稀有度动效（关键帧见 globals.css「Phase 8」区块；纯 CSS transform/opacity，不阻塞加载）：
 *  1 普通   静态立绘 + 轻微呼吸 + 简单边框
 *  2 稀有   + 元素粒子 + 发光边框
 *  3 史诗   + 专属背景 + 技能光效 + 稀有标签
 *  4 传说   + 登场光柱（挂载一次）+ 链上编号高亮 + 传说标签
 *  5 神话   + 专属背景 + AI 性格标签 + 链上稀缺编号 + 限量标识
 *
 * 卡面：名称 / 稀有度 / 元素 / 栖息地 / 链上凭证编号（Aibi #000128）/ 状态标签；
 * hoverInfo 开启时悬停显示更多信息浮层；href 开启时点击进入艾比详情页；
 * emoji 立绘占位期间零图片请求（天然懒加载）；prefers-reduced-motion 全量降级（移动端防卡顿）。
 *
 * 复用场景（指令集要求统一）：背包 / 开包结果 / 融合结果 / 灵魂卡面板 / 图鉴 / 首页 / 详情页。
 */
import type { CSSProperties } from "react";

import { Link } from "@/i18n/navigation";
import { getAibiHabitat } from "@/lib/aibi-catalog";
import {
  aibiCertDisplay,
  aibiElementLabel,
  aibiSpeciesEmoji,
  rarityVisual,
  type AibiTokenDto,
} from "@/lib/aibi-visual";

/** 状态标签文案（组件级微文案，随 locale prop 切换，不入 messages 命名空间） */
const STATUS_I18N: Record<string, { zh: string; en: string }> = {
  minted: { zh: "流通中", en: "Minted" },
  pending: { zh: "待激活", en: "Pending" },
  burned: { zh: "已销毁", en: "Burned" },
  revoked: { zh: "已回收", en: "Revoked" },
  codex: { zh: "图鉴", en: "Codex" },
};

export function AibiCard({
  token,
  locale,
  showGrowth = false,
  onClick,
  size = "md",
  href,
  statusTag,
  hoverInfo = false,
}: {
  token: AibiTokenDto;
  locale: string;
  showGrowth?: boolean;
  onClick?: () => void;
  size?: "sm" | "md" | "lg";
  /** 点击进入艾比详情页（指令集阶段 8 交互要求） */
  href?: string;
  /** 覆盖状态标签（如图鉴「已获得 / 未获得」） */
  statusTag?: string;
  /** 鼠标悬停显示更多信息浮层 */
  hoverInfo?: boolean;
}) {
  const isEn = locale === "en";
  const sp = token.species;
  const rv = rarityVisual(sp?.rarityId ?? "common");
  const tier = rv.tier;
  const emoji = aibiSpeciesEmoji(sp?.id ?? "");
  const name = sp ? (isEn ? sp.nameEn : sp.nameZh) : token.speciesId;
  const rarityName = rv.rarity ? (isEn ? rv.rarity.nameEn : rv.rarity.nameZh) : rv.id;
  const habitat = sp ? getAibiHabitat(sp.habitatId) : undefined;
  const habitatName = habitat ? (isEn ? habitat.nameEn : habitat.nameZh) : "";
  const elementName = sp ? aibiElementLabel(sp.element, locale) : "";
  const cert = aibiCertDisplay(token.aibiTokenId);
  const personality =
    token.personalityType ??
    (sp ? (isEn ? sp.personalityTemplateEn : sp.personalityTemplate) : "");
  const statusLabel =
    statusTag ??
    (STATUS_I18N[token.status]
      ? isEn
        ? STATUS_I18N[token.status].en
        : STATUS_I18N[token.status].zh
      : token.status);

  const emojiSize = size === "lg" ? "text-7xl" : size === "sm" ? "text-4xl" : "text-5xl";
  const pad = size === "lg" ? "p-5" : "p-3";

  const level = token.growthLevel ?? 1;
  const exp = token.growthExp ?? 0;
  const affinity = token.affinity ?? 0;
  const energy = token.energy ?? 0;
  const clickable = !!onClick || !!href;

  const body = (
    <div
      className={`aibi-anim group relative overflow-hidden rounded-2xl border bg-white transition-shadow dark:bg-zinc-900 ${pad} ${
        clickable ? "cursor-pointer hover:shadow-lg" : ""
      }`}
      style={
        {
          "--aibi-c": rv.color,
          borderColor: rv.color,
          boxShadow:
            tier >= 2 ? undefined : `0 0 0 1px ${rv.color}22, 0 8px 24px -12px ${rv.color}66`,
          // 稀有+：发光边框（keyframes 经 CSS 变量 --aibi-c 取稀有度色）
          animation: tier >= 2 ? "aibi-glow-border 2.6s ease-in-out infinite" : undefined,
        } as CSSProperties
      }
    >
      {/* 背景：普通/稀有=渐变底纹；史诗+=专属径向背景 */}
      {tier >= 3 ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background: `radial-gradient(120% 90% at 50% 0%, ${rv.color}33, transparent 55%), linear-gradient(160deg, ${rv.color}14, transparent 70%)`,
          }}
        />
      ) : (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-15"
          style={{ background: `linear-gradient(135deg, ${rv.color}55, transparent 60%)` }}
        />
      )}
      {/* 稀有+：元素粒子漂浮 */}
      {tier >= 2
        ? [0, 1, 2].map((i) => (
            <span
              key={i}
              aria-hidden
              className="pointer-events-none absolute h-1.5 w-1.5 rounded-full"
              style={{
                left: `${22 + i * 28}%`,
                bottom: "52%",
                backgroundColor: rv.color,
                opacity: 0,
                animation: `aibi-particle-float ${2.2 + i * 0.5}s ease-in ${i * 0.7}s infinite`,
              }}
            />
          ))
        : null}
      {/* 史诗+：技能光效扫掠 */}
      {tier >= 3 ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-1/3 bg-white/50 blur-md dark:bg-white/20"
          style={{ animation: "aibi-beam-sweep 3.4s ease-in-out infinite" }}
        />
      ) : null}
      {/* 传说+：登场光柱（挂载播放一次） */}
      {tier >= 4 ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-8 inset-y-0 origin-bottom rounded-full"
          style={{
            background: `linear-gradient(to top, ${rv.color}88, transparent)`,
            animation: "aibi-pillar-rise 1.1s ease-out forwards",
          }}
        />
      ) : null}

      {/* 状态标签（左上，全档显示） */}
      <span
        className="absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold text-white shadow"
        style={{ backgroundColor: rv.color }}
      >
        {statusLabel}
      </span>
      {/* 神话：限量标识（右上） */}
      {tier >= 5 ? (
        <span className="absolute right-2 top-2 rounded-full bg-zinc-900/85 px-2 py-0.5 text-[10px] font-black tracking-wider text-amber-300 shadow">
          LIMITED
        </span>
      ) : null}

      <div className="relative flex flex-col items-center text-center">
        {/* 立绘：全档轻微呼吸；稀有+ 叠加稀有度色光晕 */}
        <span
          className={`${emojiSize} leading-none`}
          style={{
            animation: "aibi-breathe 3.2s ease-in-out infinite",
            filter: tier >= 2 ? `drop-shadow(0 0 10px ${rv.color})` : undefined,
          }}
        >
          {emoji}
        </span>
        <p className="mt-2 w-full truncate text-sm font-bold text-zinc-900 dark:text-zinc-100">{name}</p>
        {/* 稀有标签：稀有度 chips（全档显示） */}
        <p className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold" style={{ color: rv.color }}>
          <span>{rv.emoji}</span>
          <span>{rarityName}</span>
          {token.growthLevel != null ? <span className="text-zinc-400">· Lv.{level}</span> : null}
        </p>
        <p className="mt-0.5 w-full truncate text-[10px] text-zinc-500 dark:text-zinc-400">
          {elementName}
          {elementName && habitatName ? " · " : ""}
          {habitatName}
        </p>
        {/* 链上凭证编号：传说+ 高亮（链上稀缺编号强调） */}
        <p
          className={`mt-0.5 font-mono text-[10px] ${tier >= 4 ? "font-bold" : "text-zinc-400"}`}
          style={tier >= 4 ? { color: rv.color } : undefined}
        >
          {cert}
        </p>
        {/* 神话：AI 性格标签 */}
        {tier >= 5 && personality ? (
          <p
            className="mt-1 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
            style={{ backgroundColor: `${rv.color}cc` }}
          >
            🧠 {personality}
          </p>
        ) : null}

        {showGrowth ? (
          <div className="mt-3 w-full space-y-1.5 text-left">
            <AibiBar label={isEn ? "EXP" : "经验"} value={exp} max={100} color="#4A90D9" />
            <AibiBar label={isEn ? "Affinity" : "亲密"} value={affinity} max={100} color="#E8749C" />
            <AibiBar label={isEn ? "Energy" : "精力"} value={energy} max={100} color="#57B26A" />
          </div>
        ) : null}
      </div>

      {/* 悬停更多信息浮层（指令集阶段 8：鼠标悬停显示更多信息） */}
      {hoverInfo ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-end rounded-2xl bg-gradient-to-t from-black/80 via-black/35 to-transparent p-3 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <p className="text-[11px] font-bold text-white">{name}</p>
          <p className="mt-0.5 text-[10px] text-white/85">
            {elementName}
            {elementName && habitatName ? " · " : ""}
            {habitatName}
          </p>
          <p className="mt-0.5 text-[10px] text-white/85">🧠 {personality || "—"}</p>
          <p className="mt-0.5 font-mono text-[10px] text-white/70">{cert}</p>
        </div>
      ) : null}
    </div>
  );

  // 点击进入详情页优先；否则 onClick 按钮；纯展示不包裹
  if (href) {
    return (
      <Link href={href} aria-label={name} className="block">
        {body}
      </Link>
    );
  }
  if (!onClick) return body;
  return (
    <button type="button" onClick={onClick} className="w-full text-left" aria-label={name}>
      {body}
    </button>
  );
}

function AibiBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.max(0, Math.min(100, Math.round((value / max) * 100)));
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-8 shrink-0 text-[10px] text-zinc-500 dark:text-zinc-400">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="w-7 shrink-0 text-right text-[10px] tabular-nums text-zinc-400">{value}</span>
    </div>
  );
}
