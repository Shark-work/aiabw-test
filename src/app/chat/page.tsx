import { db } from "@/db/client";
import { messages as messagesTable, adoptions } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import type { UIMessage } from "ai";

import { ChatClient } from "@/components/chat/chat-client";
import { DEFAULT_PET_TYPE } from "@/lib/pet-config";
import { resolvePetConfig } from "@/lib/ugc";

const FALLBACK_WELCOME =
  "So happy! I'm your very own Aibi now. How can I help you?";

// 领养成功后进入的独立聊天页。
// 服务端根据 URL 参数加载该线程的历史消息、艾比心情与宠物类型（petType），再交给客户端渲染。
export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string; adopt?: string }>;
}) {
  const params = await searchParams;
  const threadId = params.thread || undefined;
  const adoptionId = params.adopt || undefined;

  // 加载这条线程的历史消息（含领养时的欢迎消息）
  let initialMessages: UIMessage[] = [];
  if (threadId) {
    const rows = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.threadId, threadId))
      .orderBy(asc(messagesTable.createdAt));
    initialMessages = rows.map((r) => ({
      id: r.id,
      role: r.role as "user" | "assistant" | "system",
      parts: r.parts as UIMessage["parts"],
    }));
  }

  // 读取当前心情值 / 等级 / 月度积分 / 宠物类型（默认 50 / Lv.1 / 0 分 / 狐狸）
  let happiness = 50;
  let level = 1;
  let monthlyPoints = 0;
  let petType: string = DEFAULT_PET_TYPE;
  if (adoptionId) {
    const [ad] = await db
      .select({
        happiness: adoptions.happiness,
        level: adoptions.level,
        monthlyPoints: adoptions.monthlyPoints,
        petType: adoptions.petType,
      })
      .from(adoptions)
      .where(eq(adoptions.id, adoptionId))
      .limit(1);
    if (ad) {
      happiness = ad.happiness;
      level = ad.level ?? 1;
      monthlyPoints = ad.monthlyPoints ?? 0;
      petType = ad.petType || DEFAULT_PET_TYPE;
    }
  }

  // 根据 petType 解析宠物配置（UGC 宠物读取数据库；未知类型自动回退狐狸）
  const pet = await resolvePetConfig(petType);

  return (
    <main className="flex h-dvh w-full flex-col gap-2 overflow-hidden bg-gradient-to-br from-orange-50 via-white to-rose-50 p-4 sm:p-6">
      <div className="flex items-center gap-3 px-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={pet.avatar}
          alt={`Aibi-${pet.name}`}
          className="h-10 w-10 rounded-full border border-orange-200 bg-orange-50 object-cover"
        />
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-zinc-900">Aibi World</span>
            {/* 养成：当前等级徽标 */}
            <span className="rounded-full bg-orange-500 px-2 py-0.5 text-[11px] font-semibold text-white">
              Lv.{level} {pet.name}
            </span>
          </div>
          <div className="text-xs text-zinc-500">Chat with {pet.name}~</div>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <ChatClient
          threadId={threadId}
          adoptionId={adoptionId}
          initialMessages={initialMessages}
          initialHappiness={happiness}
          initialLevel={level}
          initialMonthlyPoints={monthlyPoints}
          fallbackWelcome={FALLBACK_WELCOME}
          petType={petType}
          pet={pet}
        />
      </div>
    </main>
  );
}


