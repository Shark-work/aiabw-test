/**
 * 后台保存 → 前台缓存自动失效（任务六：「改表即改站」的第二半）。
 *
 * 每个业务 Collection / Global 注册 afterChange hook，命中后 revalidateTag 失效
 * 对应 loader 的 unstable_cache（60s ISR 变 on-demand：保存后下次请求即新数据）。
 *
 * tag 命名规范（与 loaders.ts withFallback 第 4 参一一对应）：
 *   species / pet-animations / stories / pages / banners / products / token-rules
 *   site-settings / home-hero / points-economy
 *
 * 红线：**不得顶层 import next/cache**——payload.config 会被 CLI / 迁移脚本以
 * Node 原生 ESM（--disable-transpile）直跑，顶层引入 Next 运行时会直接崩溃；
 * 动态 import 在 Next 请求上下文命中同 bundle，在非请求上下文（迁移脚本 Local API
 * 写入、payload CLI）revalidateTag 无增量缓存可失效，catch 静默忽略。
 */
export function revalidateAfterChange(tag: string) {
  return () => {
    void import("next/cache")
      .then((m) => m.revalidateTag(tag))
      .catch(() => {
        /* 非 Next 请求上下文（迁移脚本 / CLI）：无缓存可失效，安全忽略 */
      });
  };
}
