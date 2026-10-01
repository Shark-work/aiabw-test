/**
 * 艾比平台 · 业务错误基类（零依赖，供 service / route / 契约测试直接引用）。
 * code 面向前端程序消费；status 为 HTTP 状态码；message 文案在 aibi-api.ts 错误目录。
 */
export class AibiError extends Error {
  public code: string;
  public status: number;
  /** zod 字段错误等附加信息，随 {code,message} 一并返回 */
  public details?: unknown;
  // 注意：不用 TS 参数属性语法（constructor(public x)）——Node strip-only 模式不支持
  constructor(code: string, status: number = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
