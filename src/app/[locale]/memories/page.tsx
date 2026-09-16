import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { cookies } from "next/headers";
import { and, desc, eq, isNull, or, gt } from "drizzle-orm";

import { db } from "@/db/client";
import { petMemories } from "@/db/schema";
import { verifyToken } from "@/lib/auth";
import { hasMemoryAccess } from "@/lib/memory-gate";
import { getActiveSubscription } from "@/lib/subscription-config";
import { MemoriesClient } from "./memories-client";

/**
 * /[locale]/memories
 *  - 仅 VIP 可访问；免费用户直接 redirect 到订阅页
 *  - SSR 加载首页 20 条记忆；客户端负责筛选 / 编辑 / 删除 / 分页
 */
export default async function MemoriesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const cookieStore = await cookies();
  const tokenCookie =
    cookieStore.get("aiabw_token")?.value ??
    cookieStore.get("auth_token")?.value;
  const user = tokenCookie ? await verifyToken(tokenCookie) : null;
  if (!user) {
    return (
      <main className="p-6 text-center text-sm text-zinc-500">
        请先登录。
      </main>
    );
  }
  const ok = await hasMemoryAccess(user.id);
  if (!ok) {
    redirect("/subscribe");
  }

  const now = new Date();
  const rows = await db
    .select()
    .from(petMemories)
    .where(
      and(
        eq(petMemories.userId, user.id),
        or(isNull(petMemories.expiresAt), gt(petMemories.expiresAt, now)),
      ),
    )
    .orderBy(desc(petMemories.createdAt))
    .limit(20);

  const sub = await getActiveSubscription(user.id);
  const daysRemaining = sub
    ? Math.max(
        0,
        Math.ceil((sub.expiresAt.getTime() - now.getTime()) / 86400000),
      )
    : 0;

  return (
    <MemoriesClient
      initialMemories={rows.map((r) => ({
        id: r.id,
        memoryType: r.memoryType as
          | "preference"
          | "event"
          | "fact"
          | "emotion",
        content: r.content,
        importance: r.importance,
        timesRecalled: r.timesRecalled,
        sourceMessage: r.sourceMessage,
        createdAt: r.createdAt.toISOString(),
        expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
      }))}
      isVip={true}
      daysRemaining={daysRemaining}
    />
  );
}

