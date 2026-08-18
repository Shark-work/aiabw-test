import { NextResponse } from "next/server";

import { isSocialPlatform, postToSocial } from "@/lib/agent-social";
import { cleanupStaleMemories, listMemories, renderMemories, writeMemory } from "@/lib/agent-memory";
import { generateSocialCopy, type SocialPlatform } from "@/lib/agent-psychology";

export const runtime = "nodejs";
export const maxDuration = 120;

const DEFAULT_UPDATES =
  "Aibi World 本周持续优化：AI 陪伴聊天、多宠图鉴与记忆手账都在变得更懂你。";

function parsePlatforms(v: unknown): SocialPlatform[] {
  if (v === "x" || v === "xhs") return [v];
  if (v === "both") return ["x", "xhs"];
  if (Array.isArray(v)) {
    const list = v.filter(isSocialPlatform);
    return list.length ? list : ["x", "xhs"];
  }
  return ["x", "xhs"];
}

/**
 * POST /api/agent/daily-digest
 * 请求体：{ updates?: string, platforms?: "x"|"xhs"|"both"|("x"|"xhs")[] }
 *
 * 数字人日更闭环（由 GitHub Actions 每天调用一次）：
 *   1. 读取网站最新更新（GitHub Action 传入 git log，缺省用内置兜底）；
 *   2. 套用心理学框架（小红书=痛点共鸣+情绪价值+治愈系；X=引发好奇+深度思考+互动提问）
 *      生成文案（LLM 失败自动降级模板兜底）；
 *   3. 调用社交平台 API 发布（凭据缺失时优雅记录失败，不崩溃）；
 *   4. 将结果写入 Agent 长期记忆（语义去重，>90% 相似自动合并）；
 *   5. 执行记忆生命周期清理（last_accessed 超 30 天的低频记忆删除）。
 *
 * 安全：必须携带 Authorization: Bearer <CRON_SECRET>。
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const updates =
    typeof body?.updates === "string" && body.updates.trim()
      ? body.updates.trim()
      : null;
  const platforms = parsePlatforms(body?.platforms);

  // 1) 读取已有记忆作为上下文（注入“自我意识”）
  const memories = await listMemories(20);
  const memoryCtx = renderMemories(memories);

  const results = [];
  for (const platform of platforms) {
    // 2) 心理学框架生成文案
    const copy = await generateSocialCopy(platform, updates ?? DEFAULT_UPDATES, memoryCtx);
    // 3) 发布（缺少凭据时优雅返回失败）
    const post = await postToSocial(platform, copy.text);
    results.push({
      platform,
      copySource: copy.source,
      postOk: post.ok,
      externalId: post.externalId ?? null,
      dryRun: post.dryRun ?? false,
      error: post.error ?? null,
    });
    // 4) 写入记忆（语义去重自动合并）
    if (post.ok) {
      await writeMemory(
        "fact",
        `agent 于 ${new Date().toISOString()} 在 ${platform} 发布日更：${copy.text.slice(0, 60)}`,
      );
    }
  }

  // 记录本次总结（内容相似时会被语义去重合并，不会无限增长）
  await writeMemory("fact", `agent 完成日更总结：${(updates ?? DEFAULT_UPDATES).slice(0, 100)}`);

  // 5) 生命周期清理：删除 30 天未访问的低频记忆，防止表无限膨胀
  const cleanedMemories = await cleanupStaleMemories();

  return NextResponse.json({
    ok: true,
    updates: updates ?? null,
    results,
    cleanedMemories,
  });
}
