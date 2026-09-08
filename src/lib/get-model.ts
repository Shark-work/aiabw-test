import { createOpenAI } from '@ai-sdk/openai';

/**
 * 阿里云百炼（通义千问）模型获取助手。
 *
 * 通过 DashScope 的 OpenAI 兼容模式接入：
 *   Base URL: https://dashscope.aliyuncs.com/compatible-mode/v1
 *
 * 读取的环境变量：
 *   - BAILIAN_API_KEY  百炼 API Key（必填）
 *   - BAILIAN_MODEL    模型名（可选，默认 qwen-turbo）
 *   - MEMORY_EXTRACT_MODEL  长期记忆提取专用小模型（可选，默认跟随 BAILIAN_MODEL）
 */
export function getModel(modelName?: string) {
  const bailian = createOpenAI({
    apiKey: process.env.BAILIAN_API_KEY ?? '',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  });
  const name = modelName ?? process.env.BAILIAN_MODEL ?? 'qwen-turbo';
  // Why bailian.chat (Chat Completions) instead of bailian() (Responses API):
  //  - DashScope /compatible-mode/v1/responses serializes UIMessage parts into
  //    `input_image` items which `qwen-turbo` (text-only) rejects with
  //    "Model only support text input" if any file/image part sneaks into history
  //    (e.g. legacy DB rows, future multimodal UIs).
  //  - Chat Completions on /compatible-mode/v1/chat/completions handles tool
  //    calls + multi-turn text cleanly and ignores unsupported modalities
  //    instead of failing hard. Verified via tmp-repro2-chat.mjs R-E.
  return bailian.chat(name);
}