import { pgTable, text, timestamp, jsonb, uuid, integer, boolean } from 'drizzle-orm/pg-core';

export const threads = pgTable('threads', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: text('user_id').notNull(),
  title: text('title'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const messages = pgTable('messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  threadId: uuid('thread_id').references(() => threads.id).notNull(),
  role: text('role').notNull(),
  parts: jsonb('parts').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const adoptions = pgTable('adoptions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: text('user_id').notNull().default('anonymous'),
  petName: text('pet_name').notNull(),
  petType: text('pet_type').notNull().default('fox'),
  adoptedAt: timestamp('adopted_at').defaultNow().notNull(),
  happiness: integer('happiness').notNull().default(50),
  lastInteractedAt: timestamp('last_interacted_at'),
  level: integer('level').notNull().default(1),
  chatCount: integer('chat_count').notNull().default(0),
  monthlyPoints: integer('monthly_points').notNull().default(0),
  isUnlocked: boolean('is_unlocked').notNull().default(false),
});
