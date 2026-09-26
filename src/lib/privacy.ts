// 用户隐私工具（纯函数，无 DB / 无 Next 依赖，便于单元测试）：
//  - 昵称（username）校验：站内唯一公开标识，禁止邮箱格式与系统保留名；
//  - 日志脱敏：邮箱 / IP 掩码，避免服务端日志打印完整个人身份信息；
//  - 公开投影：排行榜 / 公开页只输出昵称等自愿公开字段。

/** 昵称长度限制（字符数，中英文均按 1 计）。 */
export const USERNAME_MIN_LEN = 2;
export const USERNAME_MAX_LEN = 24;

/** 昵称允许字符：中英文、数字、下划线、连字符（\w = [A-Za-z0-9_]）。 */
export const USERNAME_CHARS_RE = /^[\w一-龥-]+$/u;

/** 系统保留名：存量用户默认回填格式 user_0001，禁止用户自取（避免与回填/未来系统账号冲突）。 */
export const RESERVED_USERNAME_RE = /^user_\d+$/i;

export type UsernameInvalidReason =
  | "required"
  | "emailLike"
  | "tooShort"
  | "tooLong"
  | "invalidChars"
  | "reserved";

/**
 * 校验昵称是否可作为站内公开标识。
 * 规则：必填；不允许邮箱格式（含 @）；2-24 位；仅限中英文/数字/下划线/连字符；非系统保留名。
 */
export function validateUsername(input: unknown): { ok: boolean; reason?: UsernameInvalidReason } {
  const name = typeof input === "string" ? input.trim() : "";
  if (!name) return { ok: false, reason: "required" };
  if (name.includes("@")) return { ok: false, reason: "emailLike" };
  if (name.length < USERNAME_MIN_LEN) return { ok: false, reason: "tooShort" };
  if (name.length > USERNAME_MAX_LEN) return { ok: false, reason: "tooLong" };
  if (!USERNAME_CHARS_RE.test(name)) return { ok: false, reason: "invalidChars" };
  if (RESERVED_USERNAME_RE.test(name)) return { ok: false, reason: "reserved" };
  return { ok: true };
}

/** 邮箱掩码：user@gmail.com → u***@gmail.com（服务端日志/审计输出用）。 */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const head = email[0] ?? "*";
  return `${head}***@${email.slice(at + 1)}`;
}

/** IP 掩码：IPv4 1.2.3.4 → 1.2.*.*；IPv6 仅保留首段；无法识别 → ***。 */
export function maskIp(ip: string): string {
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (v4) return `${v4[1]}.${v4[2]}.*.*`;
  const v6 = ip.match(/^([0-9a-fA-F]{1,4}):/);
  if (v6) return `${v6[1]}:***`;
  return "***";
}

/** 文本脱敏兜底：把字符串中出现的邮箱、IPv4 全部掩码（用于错误日志，防 PG 错误详情泄露）。 */
export function redactSensitive(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, (m) => maskEmail(m))
    .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, (m) => maskIp(m));
}

/**
 * 排行榜 / 公开页的 owner 公开投影：只保留 ownerId + 昵称，
 * 绝不携带邮箱、手机号、IP、注册时间等任何可识别个人身份的字段。
 */
export function toPublicOwner(
  row: { ownerId: string; username?: string | null },
  fallbackName = "匿名用户",
): { ownerId: string; ownerName: string } {
  const name =
    typeof row.username === "string" && row.username.trim()
      ? row.username.trim()
      : fallbackName;
  return { ownerId: String(row.ownerId), ownerName: name };
}
