import { db } from '@/db/client';
import { messages as messagesTable } from '@/db/schema';
import { eq, asc } from 'drizzle-orm';
import type { UIMessage } from 'ai';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ChatPanel } from '@/components/chat/chat-panel';
import { getPet, PETS, DEFAULT_PET_TYPE, type PetConfig } from '@/lib/pet-config';

export default async function ThreadPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id, locale } = await params;
  setRequestLocale(locale);
  const tp = await getTranslations('pets');

  const rows = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.threadId, id))
    .orderBy(asc(messagesTable.createdAt));

  const initialMessages = rows.map((r) => ({
    id: r.id,
    role: r.role as 'user' | 'assistant' | 'system',
    parts: r.parts as UIMessage['parts'],
  }));

  // 该线程页没有独立的领养上下文，默认使用狐狸人设。
  const petType = DEFAULT_PET_TYPE;
  const basePet = getPet(petType);
  const pet: PetConfig =
    petType && (PETS as Record<string, PetConfig>)[petType]
      ? { ...basePet, name: tp(`${petType}.name`), personality: tp(`${petType}.personality`) }
      : basePet;

  return (
    <ChatPanel
      threadId={id}
      initialMessages={initialMessages}
      petType={petType}
      pet={pet}
    />
  );
}
