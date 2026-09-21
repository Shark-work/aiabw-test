import { createOpenAI } from '@ai-sdk/openai';

/**
 * AI 模型获取助手（统一走 OpenAI 兼容协议）。
 *
 * 按优先级读取环境变量，第一个配置了 API Key 的提供商生效：
 *
 *   1) DEEPSEEK_API_KEY —— DeepSeek
 *        DEEPSEEK_BASE_URL 可选，默认 https://api.deepseek.com
 *        DEEPSEEK_MODEL    可选，默认 deepseek-chat
 *   2) OPENAI_API_KEY  —— OpenAI 官方或任意 OpenAI 兼容服务
 *        OPENAI_BASE_URL  可选；不设时默认 https://api.openai.com
 *        OPENAI_MODEL     可选，默认 gpt-4o-mini
 *   3) BAILIAN_API_KEY  —— 阿里云百炼（DashScope OpenAI 兼容模式）
 *        BAILIAN_MODEL    可选，默认 qwen-turbo
 *
 *   - MEMORY_EXTRACT_MODEL  长期记忆提取专用小模型（可选；作为 modelName
 *     传入，必须与当前生效提供商的模型名兼容，否则请跟随主模型）
 */
interface ModelProvider {
  apiKey: string;
  baseURL?: string;
  defaultModel: string;
}

function resolveProvider(): ModelProvider {
  if (process.env.DEEPSEEK_API_KEY) {
    return {
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
      defaultModel: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
    };
  }
  if (process.env.OPENAI_API_KEY) {
    return {
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
      defaultModel: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    };
  }
  return {
    apiKey: process.env.BAILIAN_API_KEY ?? '',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: process.env.BAILIAN_MODEL ?? 'qwen-turbo',
  };
}

export function getModel(modelName?: string) {
  const provider = resolveProvider();
  const client = createOpenAI({
    apiKey: provider.apiKey,
    baseURL: provider.baseURL,
  });
  const name = modelName ?? provider.defaultModel;
  // Why client.chat (Chat Completions) instead of client() (Responses API):
  //  - 部分 OpenAI 兼容端点（如 DashScope /compatible-mode/v1/responses）会把
  //    UIMessage parts 序列化为 `input_image` items，纯文本模型（如 qwen-turbo）
  //    会报 "Model only support text input"（历史 DB 行/未来多模态 UI 混入时）。
  //  - Chat Completions 对工具调用 + 多轮文本兼容性最好，且会忽略不支持的模态
  //    而不是硬失败。Verified via tmp-repro2-chat.mjs R-E.
  return client.chat(name);
}
