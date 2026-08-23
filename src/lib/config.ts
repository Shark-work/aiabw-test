/**
 * 全站运营配置（国际化运营基建）。
 *
 * 社交账号链接：默认占位账号 @aiabw，上线前请通过环境变量替换为真实账号。
 *
 * ══════════════════════════════════════════════════════════════════
 * 自动化接口预留（后续接入自动发推与 Telegram 消息推送的位置）：
 *
 *   # .env.local
 *   X_API_KEY=
 *   X_API_SECRET=
 *   X_ACCESS_TOKEN=
 *   X_ACCESS_TOKEN_SECRET=
 *   TELEGRAM_BOT_TOKEN=
 *   TELEGRAM_CHAT_ID=
 *
 * 此处的 X_API_KEY / X_API_SECRET / TELEGRAM_BOT_TOKEN 等环境变量为后续
 * 接入「自动发推（X/Twitter API v2）」和「Telegram Bot 消息推送」预留的
 * 占位符，当前版本不读取、不消费，接入时在 src/lib/ops-bridge.ts 中实现。
 * ══════════════════════════════════════════════════════════════════
 */
export const SOCIAL = {
  x: process.env.NEXT_PUBLIC_X_URL ?? "https://x.com/aiabw",
  telegram: process.env.NEXT_PUBLIC_TELEGRAM_URL ?? "https://t.me/aiabw",
} as const;
