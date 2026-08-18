import { Suspense } from "react";
import { getTranslations } from "next-intl/server";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";

/** 全局页脚：版权信息 + 自动版本号 + 语言切换。 */
export async function Footer() {
  const t = await getTranslations("footer");
  const version = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";
  return (
    <footer className="flex items-center justify-center gap-3 pb-4 pt-2 text-center text-xs text-muted-foreground">
      <span>{t("copyright", { version })}</span>
      {/* useSearchParams 需要 Suspense 边界，否则 SSR 阶段会抛错 */}
      <Suspense fallback={null}>
        <LanguageSwitcher />
      </Suspense>
    </footer>
  );
}
