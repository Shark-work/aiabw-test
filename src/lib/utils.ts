import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

import { DEFAULT_AGENT_PROFILE } from "@/lib/agent-profile";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// 系统提示词现在由「艾比世界」的宠物角色档案统一管理，
// 这样切换/新增宠物人设时只需修改 agent-profile.ts，无需改动 API 路由。
export const SYSTEM_PROMPT = DEFAULT_AGENT_PROFILE.systemPrompt;

export const EXAMPLE_PROMPTS = [
  "帮我找找写代码用的 AI 工具",
  "东京天气怎么样？顺便帮我算一下 47 * 23",
  "搜一下最新的 AI 资讯，给我总结一下",
];
