import { pgTable, text, timestamp, jsonb, uuid, integer, boolean } from 'drizzle-orm/pg-core';

/** 账号：注册用户 */
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  /** 是否创作者（可发布 UGC 宠物） */
  isCreator: boolean('is_creator').notNull().default(false),
  /** 创作者分成余额（UGC 宠物销售所得，单位：积分） */
  creatorBalance: integer('creator_balance').notNull().default(0),
  /** 用户可用积分（购买 UGC 宠物 / 盲盒消耗） */
  points: integer('points').notNull().default(0),
});

/** UGC 宠物（创作者上传） */
export const ugcPets = pgTable('ugc_pets', {
  id: uuid('id').defaultRandom().primaryKey(),
  creatorId: uuid('creator_id').references(() => users.id).notNull(),
  name: text('name').notNull(),
  imageUrl: text('image_url').notNull(),
  systemPrompt: text('system_prompt').notNull(),
  priceOrPoints: integer('price_or_points').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/** UGC 宠物销售记录（用于创作者分成结算） */
export const ugcSales = pgTable('ugc_sales', {
  id: uuid('id').defaultRandom().primaryKey(),
  petId: uuid('pet_id').references(() => ugcPets.id).notNull(),
  buyerId: uuid('buyer_id').references(() => users.id).notNull(),
  creatorId: uuid('creator_id').references(() => users.id).notNull(),
  amount: integer('amount').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const threads = pgTable('threads', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: text('user_id').notNull(),
  // 游客设备标识：用于登录后把匿名数据迁移回账号
  anonymousId: text('anonymous_id'),
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
  // 关联账号：已登录用户写入 users.id（字符串），游客为 'anonymous'。
  // 保持 text 类型以兼容历史数据。
  userId: text('user_id').notNull().default('anonymous'),
  // 游客设备标识：登录后据此迁移匿名数据
  anonymousId: text('anonymous_id'),
  // 该宠物对应的首条对话线程（用于“我的宠物”跳转聊天）
  threadId: uuid('thread_id').references(() => threads.id),
  petName: text('pet_name').notNull(),
  petType: text('pet_type').notNull().default('fox'),
  adoptedAt: timestamp('adopted_at').defaultNow().notNull(),
  happiness: integer('happiness').notNull().default(50),
  lastInteractedAt: timestamp('last_interacted_at'),
  level: integer('level').notNull().default(1),
  chatCount: integer('chat_count').notNull().default(0),
  monthlyPoints: integer('monthly_points').notNull().default(0),
  isUnlocked: boolean('is_unlocked').notNull().default(false),
  // 长期记忆：AI 提取的用户偏好/关键记忆（后续由 AI 写入）
  memoryContext: text('memory_context'),
});
