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
 *
 * 合规约定：不展示任何站长个人账号（个人 QQ / 个人邮箱等），
 * 售后与咨询统一走站点身份渠道 —— QQ 群（玩家社区）/ X 官号 / 官方邮箱。
 */
export const CONTACT_INFO = {
  /** QQ 交流群群号（辅助展示；加入统一走 qqGroupJoinUrl 一键加群） */
  qqGroup: "1005445619",
  /** QQ 群在线加群链接（腾讯官方 qm.qq.com 一键加群页） */
  qqGroupJoinUrl:
    "https://qm.qq.com/cgi-bin/qm/qr?k=Hf0R51LVoGSeLQN3X8kc-BLzZuAx8YAT&jump_from=webapi&authKey=z2houMdX3NE9PijBT5Cek6RUhJVJnOngHw+R+QCvWF64RD0MZtSjaz9UQsd+z2uN",
  /** X（推特）官方账号 */
  xHandle: "@Aiabw_com",
  xUrl: "https://x.com/Aiabw_com",
  /** 官方邮箱（商务合作/正式反馈/售后支持唯一入口） */
  email: "aiabw@outlook.com",
} as const;

/** 官方邮箱 mailto 链接 */
export const EMAIL_URL = `mailto:${CONTACT_INFO.email}`;
