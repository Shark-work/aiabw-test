import { pgTable, text, timestamp, jsonb, uuid, integer, boolean, doublePrecision, type AnyPgColumn } from 'drizzle-orm/pg-core';

/** 账号：注册用户 */
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  /** 是否创作者（可发布 UGC 宠物） */
  isCreator: boolean('is_creator').notNull().default(false),
  /** 是否全局解锁：付过一次款即为 true，永久解锁多宠权限（不再限制数量） */
  isUnlocked: boolean('is_unlocked').notNull().default(false),
  /** 创作者分成余额（UGC 宠物销售所得，单位：积分） */
  creatorBalance: integer('creator_balance').notNull().default(0),
  /** 用户可用积分（购买 UGC 宠物 / 盲盒消耗） */
  points: integer('points').notNull().default(0),
  /** 最近签到日期（YYYY-MM-DD，用于每日签到判断） */
  lastCheckinDate: text('last_checkin_date'),
  /** 裂变邀请：唯一邀请码（注册时自动生成） */
  inviteCode: text('invite_code').unique(),
  /** 裂变邀请：由谁邀请（邀请人 user id） */
  invitedBy: uuid('invited_by').references((): AnyPgColumn => users.id),
});

/** 邀请奖励发放记录（用于防刷：同一 IP 或同一设备指纹最多触发一次） */
export const inviteRewards = pgTable('invite_rewards', {
  id: uuid('id').defaultRandom().primaryKey(),
  inviterId: uuid('inviter_id').references(() => users.id).notNull(),
  invitedUserId: uuid('invited_user_id').references(() => users.id).notNull(),
  ip: text('ip'),
  deviceId: text('device_id'),
  amount: integer('amount').notNull().default(50),
  createdAt: timestamp('created_at').defaultNow().notNull(),
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

/** AI 记忆手账（异步生成） */
export const handbooks = pgTable('handbooks', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  adoptionId: uuid('adoption_id').references(() => adoptions.id),
  title: text('title'),
  content: text('content'),
  /** processing | generating | done | error */
  status: text('status').notNull().default('processing'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/** 用户积分流水（签到 / 盲盒 / 购买 UGC 等） */
export const pointsLog = pgTable('points_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  /** 正为入账，负为支出 */
  amount: integer('amount').notNull().default(0),
  /** checkin | gacha | ugc_buy */
  reason: text('reason').notNull(),
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

/**
 * 宠物字典（Pet Dictionary）：现实动物物种清单 —— 所有预计算宠物的“基础模板”。
 *  - id:            物种唯一标识（如 snow_leopard）
 *  - category:      分类（犬科 / 猫科 / 海洋生物 / 鸟类 / 大型哺乳动物 / 爬行动物…）
 *  - default_description_*: 默认介绍模板，含 {trait} 占位符，
 *    展示时用宠物 traits 中的特质词替换（例：字典=雪豹、traits=勇敢 →
 *    “这是一只来自高山的勇敢雪豹，眼神中透着不羁。”）
 */
export const petDictionary = pgTable('pet_dictionary', {
  id: text('id').primaryKey(),
  nameZh: text('name_zh').notNull(),
  nameEn: text('name_en').notNull(),
  category: text('category').notNull(),
  habitat: text('habitat'),
  defaultDescriptionZh: text('default_description_zh').notNull(),
  defaultDescriptionEn: text('default_description_en').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/**
 * 预计算宠物实例（高性能核心）：
 *  - 由离线脚本（HashLips 类批量生成器）预先创建 N 万条，图片存 Vercel Blob；
 *  - id:         唯一哈希 ID（如 #8A3F9C），离线生成保证全局唯一；
 *  - owner_id:   NULL = 未被领养；/api/pets/synthesize 只做“分配”（UPDATE owner_id），
 *                绝不实时拼图 / 生成图片，目标 < 50ms；
 *  - traits:     JSON 元素/灵力（如 {"element":"fire","rarity":"rare"}），GIN 索引支持毫秒级筛选；
 *  - custom_description: 用户自定义介绍；NULL = 展示字典默认介绍（Species + Traits 生成）。
 */
export const pets = pgTable('pets', {
  id: text('id').primaryKey(),
  speciesId: text('species_id').references(() => petDictionary.id).notNull(),
  imageUrl: text('image_url').notNull(),
  traits: jsonb('traits').notNull().default({}),
  generation: integer('generation').notNull().default(1),
  /** 族谱：合成它的父母 ID 数组，如 ["#A1B2C3", "#D4E5F6"] */
  parentIds: jsonb('parent_ids'),
  customDescription: text('custom_description'),
  ownerId: uuid('owner_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  adoptedAt: timestamp('adopted_at'),
  /** 上次互动时间（喂食/互动）；NULL 视为与 adopted_at 相同。
   *  损失厌恶：超过 3 天未互动 → 前端展示灰暗滤镜 + 💧/🍖 状态提示。 */
  lastInteractionTime: timestamp('last_interaction_time'),
  /** 进化状态：active=正常；consumed=已被进化消耗（软删除，保留族谱）。 */
  status: text('status').notNull().default('active'),
  /** 被消耗时指向进化结果宠物 id（evolution 链）。 */
  evolutionId: text('evolution_id'),
});


/**
 * 数字人 Agent 的长期记忆库（防止存储膨胀版）：
 *  - memory_type: fact(事实) / skill(技能) / user_preference(用户偏好)
 *  - embedding:   double precision[] 向量，用于语义去重与向量检索
 *  - last_accessed: 最近访问时间，>30 天未访问的低频记忆由 cleanupStaleMemories 清理
 *  - important:  核心记忆标记（跨日沉淀）；重要记忆豁免 30 天清理
 */
export const agentMemories = pgTable('agent_memories', {
  id: uuid('id').defaultRandom().primaryKey(),
  memoryType: text('memory_type', { enum: ['fact', 'skill', 'user_preference'] }).notNull(),
  content: text('content').notNull(),
  embedding: doublePrecision('embedding').array().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  lastAccessed: timestamp('last_accessed').defaultNow().notNull(),
  important: boolean('important').notNull().default(false),
});
