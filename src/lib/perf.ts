/**
 * 简单性能计时器：在每个步骤调用返回的函数，打印该步骤相对起点的耗时。
 * 用于在 Vercel Logs 中定位“慢在哪一步”。
 *
 * 用法：
 *   const t = timer("register");
 *   await ensureDbSchemaOnce(); t("ensureSchema");
 *   await db.insert(...); t("insert");
 */
export function timer(label: string) {
  const start = Date.now();
  return (step: string) => {
    console.log(`[perf] ${label}.${step} ${Date.now() - start}ms`);
  };
}
