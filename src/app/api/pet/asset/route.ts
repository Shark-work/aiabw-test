import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

import { getUserFromRequest } from "@/lib/auth";
import { apiError, resolveLocale } from "@/i18n/api-errors";
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";

/** .riv 资产目录：仓库内、public/ 之外的私有路径（防抄袭需求 2.2：绝不放 public 直链）。 */
const RIVE_DIR = path.resolve(process.cwd(), "assets", "rive");
/** 资产名白名单：小写字母/数字/连字符（防目录遍历；实际可用名见 assets/rive/README.md）。 */
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/**
 * GET /api/pet/asset?name=<asset> · Rive .riv 动画文件安全下发。
 *
 * 防抄袭红线（需求 2.2）：
 *  - .riv 不放 public/，唯一出口即本路由；
 *  - 校验登录身份（JWT Bearer → 401）+ 请求频率（30/min/用户 → 429）；
 *  - 文件名白名单 + resolve 后目录前缀二次校验（防 ../../ 遍历）；
 *  - 后端流式输出（node stream → Web Stream），Content-Disposition:inline +
 *    nosniff + private 短缓存——浏览器可加载运行，但无公开可盗链 URL。
 *
 * 错误：401 未登录 / 400 非法资产名 / 404 资产不存在（前端据此降级为 CSS 动画立绘）。
 */
export async function GET(req: Request) {
  const locale = resolveLocale(req);

  const user = await getUserFromRequest(req);
  if (!user) {
    return Response.json(
      { ok: false, error: apiError(locale, "sessionExpired") },
      { status: 401 },
    );
  }

  const rl = checkRateLimit(`pet-asset:${user.id}`, RATE_LIMITS.petAsset);
  if (rl.limited) return rateLimitResponse(req, rl.retryAfterSec);

  const name = new URL(req.url).searchParams.get("name") ?? "";
  if (!NAME_RE.test(name)) {
    return Response.json(
      { ok: false, error: apiError(locale, "petPlayAssetNotFound") },
      { status: 400 },
    );
  }

  // 白名单之外的第二道闸：resolve 后必须仍位于 RIVE_DIR 内
  const filePath = path.resolve(RIVE_DIR, `${name}.riv`);
  if (!filePath.startsWith(RIVE_DIR + path.sep) || !existsSync(filePath)) {
    return Response.json(
      { ok: false, error: apiError(locale, "petPlayAssetNotFound") },
      { status: 404 },
    );
  }

  const size = statSync(filePath).size;
  const webStream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
  return new Response(webStream, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(size),
      "Content-Disposition": `inline; filename="${name}.riv"`,
      // private：仅浏览器私有缓存 1h；不得进 CDN/共享缓存（防盗链扩散）
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
