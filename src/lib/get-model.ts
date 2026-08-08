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
  return bailian(modelName ?? process.env.BAILIAN_MODEL ?? 'qwen-turbo');
}