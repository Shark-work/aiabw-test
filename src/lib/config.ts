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
  x: process.env.NEXT_PUBLIC_X_URL ?? "https://x.com/Aiabw_com",
  telegram: process.env.NEXT_PUBLIC_TELEGRAM_URL ?? "https://t.me/aiabw",
} as const;

/**
 * 全站统一联系方式（客服渠道单一事实源）。
 * 页脚 / 悬浮客服 / 法律页 / 联系页 / 订阅页等全部引用此处，改号只改这一处。
 */
export const CONTACT_INFO = {
  /** QQ 交流群群号（暂无在线加群链接，展示群号引导搜索加入） */
  qqGroup: "1005445619",
  /** 客服 QQ（一对一咨询） */
  customerServiceQQ: "1206309834",
  /** 客服 QQ 对应邮箱 */
  customerServiceEmail: "1206309834@qq.com",
  /** X（推特）官方账号 */
  xHandle: "@Aiabw_com",
  xUrl: "https://x.com/Aiabw_com",
  /** 官方邮箱（商务合作/正式反馈） */
  email: "aiabw@outlook.com",
} as const;

/** 客服 QQ 一键唤起会话（tencent:// 协议，PC/手机 QQ 均支持） */
export const QQ_SERVICE_URL = `tencent://message/?uin=${CONTACT_INFO.customerServiceQQ}&Site=&Menu=yes`;

/** 官方邮箱 mailto 链接 */
export const EMAIL_URL = `mailto:${CONTACT_INFO.email}`;
