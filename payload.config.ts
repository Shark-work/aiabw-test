import path from "node:path";
import { fileURLToPath } from "node:url";

import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { lexicalEditor } from "@payloadcms/richtext-lexical";
import { vercelBlobStorage } from "@payloadcms/storage-vercel-blob";
import { zh } from "@payloadcms/translations/languages/zh";
import { buildConfig } from "payload";
import sharp from "sharp";

// ⚠️ 相对导入必须带 .ts 显式扩展名：Payload CLI 以 --disable-transpile（Node 24 原生
// type-stripping ESM）加载本文件，原生 ESM 解析不认无扩展名相对路径；
// 显式扩展名对 Next webpack/turbopack 与 tsc（allowImportingTsExtensions）同样合法。
import { Banners } from "./src/collections/Banners.ts";
import { Media } from "./src/collections/Media.ts";
import { Pages } from "./src/collections/Pages.ts";
import { PetAnimations } from "./src/collections/PetAnimations.ts";
import { Products } from "./src/collections/Products.ts";
import { Species } from "./src/collections/Species.ts";
import { Stories } from "./src/collections/Stories.ts";
import { TokenRules } from "./src/collections/TokenRules.ts";
import { Users } from "./src/collections/Users.ts";

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

/**
 * Payload CMS 3.x 主配置（2026-10-18 接入，目标「改表即改站」）。
 *
 * 与任务书的必要差异（均经勘察确认，不调整即事故）：
 *  - 适配器为官方 @payloadcms/db-sqlite（libSQL/Turso 适配器；任务书所写
 *    @payloadcms/db-libsql 包在 Payload 3.x 不存在）；
 *  - 连接走独立环境变量 TURSO_DATABASE_URL / TURSO_AUTH_TOKEN——现有 DATABASE_URL
 *    是 Neon Postgres 全站业务库，语义不可复用；本地开发缺省 file:payload.db 免 Turso；
 *  - 后台 /admin、REST /api/payload（避开既有 /api/* 业务路由；GraphQL 关闭）；
 *  - Media 上传走 Vercel Blob（serverless 本地盘易失），无 token 时自动禁用插件回退本地。
 */
export default buildConfig({
  secret: process.env.PAYLOAD_SECRET || "payload-dev-secret-change-me",
  admin: {
    user: Users.slug,
    // 本项目 Payload 后台路由为 src/app/admin（非官方模板默认的 (payload) 路由组），
    // generate:importmap 只会在 app/(payload)/<adminRoute> 找 importMap，必须显式指定文件。
    importMap: {
      baseDir: path.resolve(dirname),
      importMapFile: path.resolve(dirname, "src/app/admin/importMap.ts"),
    },
    meta: { titleSuffix: " · 艾比世界 CMS" },
  },
  routes: { admin: "/admin", api: "/api/payload" },
  graphQL: { disable: true },
  i18n: { supportedLanguages: { zh }, fallbackLanguage: "zh" },
  editor: lexicalEditor(),
  db: sqliteAdapter({
    client: {
      url: process.env.TURSO_DATABASE_URL || "file:payload.db",
      authToken: process.env.TURSO_AUTH_TOKEN || undefined,
    },
  }),
  sharp,
  typescript: {
    outputFile: path.resolve(dirname, "src/payload-types.ts"),
  },
  collections: [Users, Media, Species, PetAnimations, Stories, Pages, Banners, Products, TokenRules],
  plugins: [
    ...(process.env.BLOB_READ_WRITE_TOKEN
      ? [
          vercelBlobStorage({
            enabled: true,
            collections: { media: true },
            token: process.env.BLOB_READ_WRITE_TOKEN,
          }),
        ]
      : []),
  ],
});
