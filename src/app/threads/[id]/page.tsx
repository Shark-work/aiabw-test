import { db } from '@/db/client';
import { messages as messagesTable } from '@/db/schema';
import { eq, asc } from 'drizzle-orm';
import type { UIMessage } from 'ai';
import { ChatPanel } from '@/components/chat/chat-panel';
import { getPet, DEFAULT_PET_TYPE } from '@/lib/pet-config';

export default async function ThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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
  const pet = getPet(petType);

  return (
    <ChatPanel
      threadId={id}
      initialMessages={initialMessages}
      petType={petType}
      pet={pet}
    />
  );
}
