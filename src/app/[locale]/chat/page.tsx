import { db } from "@/db/client";
import { messages as messagesTable, adoptions } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import type { UIMessage } from "ai";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ChatClient } from "@/components/chat/chat-client";
import { LivingPet } from "@/components/LivingPet";
import { PETS, DEFAULT_PET_TYPE, type PetConfig } from "@/lib/pet-config";
import { resolvePetConfig } from "@/lib/ugc";

// 领养成功后进入的独立聊天页。
// 服务端根据 URL 参数加载该线程的历史消息、艾比心情与宠物类型（petType），再交给客户端渲染。
export default async function ChatPage({
  searchParams,
  params,
}: {
  searchParams: Promise<{ thread?: string; adopt?: string }>;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const tp = await getTranslations("pets");
  const tc = await getTranslations("common");
  const tchat = await getTranslations("chat");

  const { thread: threadParam, adopt: adoptionParam } = await searchParams;

  // 参数防护：非法 UUID（如 adopt=undefined / 被截断的分享链接）一律视为缺失，
  // 避免把非法值发给 Postgres 的 uuid 列导致整页 500。
  const isUuid = (v?: string | null): v is string =>
    !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  const threadId = isUuid(threadParam) ? threadParam : undefined;
  const adoptionId = isUuid(adoptionParam) ? adoptionParam : undefined;

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
  // 优先按 adopt 参数精确匹配领养记录；
  // 兜底：adopt 缺失 / 失效（旧链接、参数被截断、旧线程页重定向过来）时，
  // 用 threadId 反查这条线程对应的领养记录 —— 「进了谁的对话就显示谁」，
  // 而不是退回默认抱抱狐（曾出现的「领养后聊天页显示默认狐」问题）。
  const adoptionSelect = {
    happiness: adoptions.happiness,
    level: adoptions.level,
    monthlyPoints: adoptions.monthlyPoints,
    petType: adoptions.petType,
  };
  let ad = adoptionId
    ? (
        await db
          .select(adoptionSelect)
          .from(adoptions)
          .where(eq(adoptions.id, adoptionId))
          .limit(1)
      )[0]
    : undefined;
  if (!ad && threadId) {
    ad = (
      await db
        .select(adoptionSelect)
        .from(adoptions)
        .where(eq(adoptions.threadId, threadId))
        .limit(1)
    )[0];
  }
  if (ad) {
    happiness = ad.happiness;
    level = ad.level ?? 1;
    monthlyPoints = ad.monthlyPoints ?? 0;
    petType = ad.petType || DEFAULT_PET_TYPE;
  }

  // 根据 petType 解析宠物配置（UGC 宠物读取数据库；图鉴物种动态构建；未知类型自动回退狐狸）
  const basePet = await resolvePetConfig(petType, locale as "zh" | "en");

  // 官方宠物：展示名/性格/欢迎语本地化（中文默认 → 抱抱狐；英文 → Huggy Fox）
  let pet: PetConfig = basePet;
  let welcomeMessage = typeof basePet.welcome === "string" ? basePet.welcome : "";
  if (petType && (PETS as Record<string, PetConfig>)[petType]) {
    pet = {
      ...basePet,
      name: tp(`${petType}.name`),
      personality: tp(`${petType}.personality`),
    };
    welcomeMessage = tp(`${petType}.welcome`);
  }

  return (
    <main className="flex h-dvh w-full flex-col gap-2 overflow-hidden bg-gradient-to-br from-orange-50 via-white to-rose-50 p-4 sm:p-6">
      <div className="flex items-center gap-3 px-1">
        <LivingPet
          src={pet.avatar}
          alt={`${tc("appName")}-${pet.name}`}
          tail={false}
          className="h-10 w-10 rounded-full border border-orange-200 bg-orange-50 object-cover"
        />
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-zinc-900">{tc("appName")}</span>
            {/* 养成：当前等级徽标 */}
            <span className="rounded-full bg-orange-500 px-2 py-0.5 text-[11px] font-semibold text-white">
              Lv.{level} {pet.name}
            </span>
          </div>
          <div className="text-xs text-zinc-500">{tchat("chatWith", { name: pet.name })}</div>
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
          fallbackWelcome={welcomeMessage || undefined}
          petType={petType}
          pet={pet}
        />
      </div>
    </main>
  );
}



