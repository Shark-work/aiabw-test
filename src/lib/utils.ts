import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

import { DEFAULT_AGENT_PROFILE } from "@/lib/agent-profile";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// System prompts are managed centrally by the "Aibi World" pet profiles,
// so switching/adding pet personas only touches agent-profile.ts, never the API routes.
export const SYSTEM_PROMPT = DEFAULT_AGENT_PROFILE.systemPrompt;

export const EXAMPLE_PROMPTS = [
  "Find me AI tools for writing code",
  "What's the weather in Tokyo? Also calculate 47 * 23 for me",
  "Search for the latest AI news and summarize it for me",
];
