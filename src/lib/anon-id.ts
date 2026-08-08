/**
 * 游客设备标识（anonymousId）：
 * 首次访问时在 localStorage 生成一个持久 ID（aiabw_anon_id），
 * 领养游客宠物时写入数据库；登录/注册成功后用它把匿名数据迁移回账号。
 * 仅在浏览器环境调用。
 */
export function getAnonymousId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = window.localStorage.getItem("aiabw_anon_id");
    if (!id) {
      id =
        (typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `anon-${Date.now()}-${Math.random().toString(16).slice(2)}`) as string;
      window.localStorage.setItem("aiabw_anon_id", id);
    }
    return id;
  } catch {
    return "";
  }
}
