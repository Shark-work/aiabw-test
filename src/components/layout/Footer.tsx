/**
 * 全局页脚：版权信息 + 自动版本号。
 * 版本号来自 next.config 注入的 NEXT_PUBLIC_APP_VERSION（git commit 短哈希，兜底 package.json version）。
 */
export function Footer() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";
  return (
    <footer className="pb-4 text-center text-xs text-muted-foreground">
      © 2025-2026 aiabw.com | v{version}
    </footer>
  );
}
