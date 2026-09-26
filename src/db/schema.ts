import { pgTable, text, timestamp, jsonb, uuid, integer, boolean, doublePrecision, numeric, unique, type AnyPgColumn } from 'drizzle-orm/pg-core';

/** 账号：注册用户 */
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  /** 用户角色：user（普通）| admin（站长后台） */
  role: text('role').notNull().default('user'),
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
  /** 连续签到天数（每日签到 +1，断签重置为 1） */
  checkinStreak: integer('checkin_streak').notNull().default(0),
  /** 高级公民月卡到期时间（NULL=非会员） */
  premiumUntil: timestamp('premium_until'),
  /** 裂变邀请：唯一邀请码（注册时自动生成） */
  inviteCode: text('invite_code').unique(),
  /** 裂变邀请：由谁邀请（邀请人 user id） */
  invitedBy: uuid('invited_by').references((): AnyPgColumn => users.id),
  /** 金币余额：探险商城（shop_items）通用货币，新用户默认 200 */
  coins: integer('coins').notNull().default(200),
  /** 站内唯一公开标识（昵称）：注册必填，可修改；存量用户系统回填 user_0001 格式；邮箱仅后端用途，不再对外展示 */
  username: text('username').notNull().unique(),
  /** 隐私设置：是否参与排行榜（默认参与；设置页可 opt-out，关闭后各榜单不再展示该用户及其宠物） */
  showInLeaderboard: boolean('show_in_leaderboard').notNull().default(true),
});

/**
 * 邀请奖励发放记录（防刷：同 IP / 设备指纹 24h 内 ≤3 次；
 * status: pending=冻结等待活跃验证 / credited=已发放 / expired=超时作废）。
 */
export const inviteRewards = pgTable('invite_rewards', {
  id: uuid('id').defaultRandom().primaryKey(),
  inviterId: uuid('inviter_id').references(() => users.id).notNull(),
  invitedUserId: uuid('invited_user_id').references(() => users.id).notNull(),
  ip: text('ip'),
  deviceId: text('device_id'),
  amount: integer('amount').notNull().default(50),
  status: text('status').notNull().default('credited'),
  claimedAt: timestamp('claimed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/** 装扮商品定义（皮肤 / 特效），人民币购买 */
export const cosmetics = pgTable('cosmetics', {
  id: text('id').primaryKey(),
  nameZh: text('name_zh').notNull(),
  nameEn: text('name_en').notNull(),
  kind: text('kind').notNull().default('skin'),
  imageUrl: text('image_url'),
  priceCny: numeric('price_cny').notNull().default('1'),
  isVisible: boolean('is_visible').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/** 用户已购装扮（adoption_id 空 = 账号全局） */
export const userCosmetics = pgTable('user_cosmetics', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  cosmeticId: text('cosmetic_id').references(() => cosmetics.id).notNull(),
  adoptionId: uuid('adoption_id').references(() => adoptions.id),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/**
 * P0-1 每日签到 · 道具背包：
 *  - 连签每满 7 天开一次心情盲盒（帽子/围巾/玩具），稀有度 普通 70% / 稀有 25% / 传说 5%；
 *  - item_key 对应 src/lib/checkin-items.ts 道具目录（代码常量，非 FK）；
 *  - equipped_adoption_id：装备在哪只领养宠物上展示（NULL = 收纳在背包中）；
 *  - source：来源（checkin_blindbox = 签到盲盒；后续可扩展补签/商城等）。
 */
export const userItems = pgTable('user_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  itemKey: text('item_key').notNull(),
  rarity: text('rarity').notNull().default('common'),
  source: text('source').notNull().default('checkin_blindbox'),
  equippedAdoptionId: uuid('equipped_adoption_id').references(() => adoptions.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/** 盲盒奖池定义（概率 JSONB + 物种白名单） */
export const blindboxPools = pgTable('blindbox_pools', {
  id: text('id').primaryKey(),
  nameZh: text('name_zh').notNull(),
  nameEn: text('name_en').notNull(),
  priceCny: numeric('price_cny').notNull().default('1'),
  pricePoints: integer('price_points').notNull().default(200),
  probabilities: jsonb('probabilities').notNull(),
  speciesIds: jsonb('species_ids').notNull().default([]),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/** 抽奖流水（审计 / 防超发） */
export const blindboxLogs = pgTable('blindbox_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  poolId: text('pool_id').references(() => blindboxPools.id).notNull(),
  resultCollectibleId: text('result_collectible_id').notNull(),
  resultHashId: text('result_hash_id').notNull(),
  isLegendary: boolean('is_legendary').notNull().default(false),
  payMethod: text('pay_method').notNull(),
  cost: numeric('cost').notNull().default('0'),
  /** XorPay 订单号（回调幂等键，积分通道为 NULL） */
  orderId: text('order_id'),
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
  // V1 探索遗产列：累计步数（成就系统 V1 折算口径 max(Σsteps÷100, 明信片数) 的数据源，原列保留）
  explorationSteps: integer('exploration_steps').notNull().default(0),
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
  /** P1 零摩擦领养：游客（anonymousId）占有的占位列；登录后归并到 owner_id 并清空。 */
  guestOwner: text('guest_owner'),
});

/**
 * P2 Web Push 召回：浏览器推送订阅。
 *  - endpoint 全局唯一（同一浏览器重复订阅做 UPSERT）；
 *  - user_id / anonymous_id 二选一归属（登录后调用 subscribe 可把游客订阅绑定账号）；
 *  - last_notified_at 防打扰：同一订阅 7 天内最多召回一次。
 */
export const pushSubscriptions = pgTable('push_subscriptions', {
  id: uuid('id').defaultRandom().primaryKey(),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  userId: text('user_id'),
  anonymousId: text('anonymous_id'),
  locale: text('locale').notNull().default('zh'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
  lastNotifiedAt: timestamp('last_notified_at'),
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


/**
 * 宠物旅行日记 · 旅行明信片（V1 遗产表，原表保留：成就系统 V1 识别/折算口径数据源）：
 *  - user_id: 归属用户（领养人；游客不写入）
 *  - adoption_id: 完成旅程的领养记录（NULL 表示账号级成就）
 *  - ai_summary_*: AI 生成的旅程亮点总结（按 locale 取一份展示）
 *  - illustration_emoji: 极简的视觉标识（emoji / unicode），MVP 阶段占位，后续可换为生成图
 */
export const userPostcards = pgTable('user_postcards', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  adoptionId: uuid('adoption_id').references(() => adoptions.id),
  mapId: integer('map_id').notNull(),
  mapNameZh: text('map_name_zh').notNull(),
  mapNameEn: text('map_name_en').notNull(),
  aiSummaryZh: text('ai_summary_zh').notNull(),
  aiSummaryEn: text('ai_summary_en').notNull(),
  illustrationEmoji: text('illustration_emoji').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/**
 * 宠物旅行日记 · 探险商城 商品目录：
 *  - id 语义化英文 key（tent / umbrella / compass / bridge / rope / lantern / hot_air_balloon）；
 *  - effect_type: 'obstacle_pass'(自动通过) / 'weather_resist'(免疫天气) / 'distance_boost'(步数加成) / 'rare_event'(稀有事件概率) / 'map_skip'(跳图)；
 *  - effect_value: 数值（如 distance_boost=1.5 表示步数 ×1.5）；
 *  - duration: -1 = 永久装备；>0 = 消耗品秒数（本期不实现过期逻辑，预留字段）；
 *  - is_premium: TRUE 表示仅高级公民月卡用户可购买；
 *  - currency: 'coin' / 'rmb' / 'subscription'（本期只用 coin）。
 */
export const shopItems = pgTable('shop_items', {
  id: text('id').primaryKey(),
  nameZh: text('name_zh').notNull(),
  nameEn: text('name_en').notNull(),
  descriptionZh: text('description_zh').notNull(),
  descriptionEn: text('description_en').notNull(),
  icon: text('icon').notNull(),
  price: integer('price').notNull(),
  currency: text('currency').notNull().default('coin'),
  effectType: text('effect_type').notNull(),
  effectValue: doublePrecision('effect_value').notNull().default(1.0),
  duration: integer('duration').notNull().default(-1),
  isPremium: boolean('is_premium').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/**
 * 宠物旅行日记 · 探险商城 用户购买订单（流水账）：
 *  - 实际装备的道具入 user_items 表（source='shop'），本表只保留购买记录；
 *  - status: 'pending' / 'completed' / 'refunded'（本期只写 completed）；
 *  - payment 渠道：currency='coin' 用金币扣减；其它渠道预留。
 */
export const userOrders = pgTable('user_orders', {
  id: text('id').primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  itemId: text('item_id').references(() => shopItems.id).notNull(),
  quantity: integer('quantity').notNull().default(1),
  totalPrice: integer('total_price').notNull(),
  currency: text('currency').notNull(),
  status: text('status').notNull().default('completed'),
  paidAt: timestamp('paid_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/**
 * 宠物旅行日记 · 聊天额度（每日按 user_id+date 唯一）：
 *  - 每日计数：message_count 达到 FREE_DAILY_LIMIT 触发硬限制
 *  - VIP 用户：直接走 unlimited 分支，chat_quotas 不会增长
 *  - last_message_at：仅供诊断/运维
 */
export const chatQuotas = pgTable('chat_quotas', {
  id: text('id').primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  date: text('date').notNull(), // 'YYYY-MM-DD' 本地日期
  messageCount: integer('message_count').notNull().default(0),
  lastMessageAt: timestamp('last_message_at'),
});

/**
 * 宠物旅行日记 · 订阅计划目录：
 *  - id: 'monthly' / 'quarterly' / 'yearly'
 *  - price_rmb: 单位 = 分（与 xorpay 一致）
 *  - daily_chat_limit: -1 = 无限
 *  - features: JSON 字符串列表（与前端 vip features 文案键对齐）
 */
export const subscriptionPlans = pgTable('subscription_plans', {
  id: text('id').primaryKey(),
  nameZh: text('name_zh').notNull(),
  nameEn: text('name_en').notNull(),
  priceRmb: integer('price_rmb').notNull(),
  durationDays: integer('duration_days').notNull(),
  dailyChatLimit: integer('daily_chat_limit').notNull(),
  // jsonb 列存储为 JSON 字符串（Drizzle PG 用 jsonb 模式，DB 客户端走原始 SQL 时以 jsonb 表达）
  features: text('features').notNull().default('[]'),
  badgeZh: text('badge_zh').notNull().default(''),
  badgeEn: text('badge_en').notNull().default(''),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
});

/**
 * 宠物旅行日记 · 用户订阅实例：
 *  - status: 'active' / 'expired' / 'cancelled'（cancelled 仅关闭自动续费）
 *  - expires_at: 续费时若未到期则向后顺延，到期后用 null/重新创建
 *  - payment_id: xorpay 订单号（subscription-…）
 *  - auto_renew: false = 用户主动取消续费，当前周期仍生效
 */
export const userSubscriptions = pgTable('user_subscriptions', {
  id: text('id').primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  planId: text('plan_id').references(() => subscriptionPlans.id).notNull(),
  status: text('status').notNull().default('active'),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at').notNull(),
  paymentId: text('payment_id'),
  autoRenew: boolean('auto_renew').notNull().default(true),
});

/**
 * 宠物长期记忆库（VIP 专属，drizzle/0019_pet_memories.sql）
 *  - memoryType: preference(偏好) / event(事件) / fact(事实) / emotion(情绪)
 *  - importance: 1-10，用于 recallMemory 排序权重
 *  - timesRecalled + lastRecalledAt: 召回统计
 *  - expiresAt: 临时记忆可设过期（NULL=永不过期）
 *  - petId: 可选；为 NULL 则视为「跨宠物」全局记忆（如用户姓名、整体偏好）
 * 访问控制：src/lib/memory-gate.hasMemoryAccess() 校验 user_subscriptions。
 */
export const petMemories = pgTable('pet_memories', {
  id: text('id').primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  petId: text('pet_id'),
  memoryType: text('memory_type', {
    enum: ['preference', 'event', 'fact', 'emotion'],
  }).notNull(),
  content: text('content').notNull(),
  sourceMessage: text('source_message'),
  importance: integer('importance').notNull().default(5),
  timesRecalled: integer('times_recalled').notNull().default(0),
  lastRecalledAt: timestamp('last_recalled_at'),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/**
 * 探索 v2 · 动物知识百科（drizzle/0020_exploration_v2.sql）
 *  - id: 物种唯一标识（如 "persian-cat"）
 *  - species: 物种显示名（中英双语或单语皆可）
 *  - category: 分类（猫/狗/狐/兔/鸟/...）
 *  - traits / funFacts: JSON 字符串数组（Drizzle 侧用 text，应用层 parseAnimalTraits / parseAnimalFunFacts 解析）
 *  - 数据驱动：新增宠物只插一行；不需改代码。
 */
export const animalWiki = pgTable('animal_wiki', {
  id: text('id').primaryKey(),
  species: text('species').notNull(),
  category: text('category').notNull(),
  origin: text('origin'),
  lifespan: text('lifespan'),
  weight: text('weight'),
  // JSON 字符串数组，存：["安静","温顺",...]
  traits: text('traits').notNull().default('[]'),
  // JSON 字符串数组，至少 5 条趣味知识
  funFacts: text('fun_facts').notNull().default('[]'),
  habitat: text('habitat'),
  diet: text('diet'),
  conservationStatus: text('conservation_status'),
  imageUrl: text('image_url'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/**
 * 探索 v2 · 事件库（drizzle/0020_exploration_v2.sql）
 *  - eventType: postcard / gift / knowledge / encounter / rest
 *  - rarity: common / rare / epic（CHECK 约束，DB 层防越界）
 *  - weight: 抽取权重（整数；应用层按 weight 比例随机）
 *  - petCategory: 适用宠物类别（NULL = 通用）
 *  - knowledgeLink: 关联 animal_wiki.id（knowledge 类专用）
 *  - requiredEquipment: 需要装备 ID（NULL = 无前置；后续可扩展）
 */
export const explorationEventsV2 = pgTable('exploration_events', {
  id: text('id').primaryKey(),
  petCategory: text('pet_category'),
  eventType: text('event_type', {
    enum: ['postcard', 'gift', 'knowledge', 'encounter', 'rest'],
  }).notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  imageEmoji: text('image_emoji'),
  rarity: text('rarity', { enum: ['common', 'rare', 'epic'] }).notNull().default('common'),
  weight: integer('weight').notNull().default(10),
  requiredEquipment: text('required_equipment'),
  knowledgeLink: text('knowledge_link'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/**
 * 探索 v2 · 记录（每次探索落库一行）
 *  - userId: 探索发起人（必填）
 *  - petId: 关联宠物实例（NULL = 未选；可后续在 0021 阶段扩展）
 *  - eventId: 关联事件（NULL 表示系统异常但仍记录步数）
 *  - resultType: 与 event.eventType 一致
 *  - resultData: JSON 字符串（title/description/emoji 等）
 *  - isRare: 派生字段（rarity != 'common'），UI 标记用
 */
export const explorationRecords = pgTable('exploration_records', {
  id: text('id').primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  petId: text('pet_id'),
  eventId: text('event_id').references((): AnyPgColumn => explorationEventsV2.id),
  resultType: text('result_type', {
    enum: ['postcard', 'gift', 'knowledge', 'encounter', 'rest'],
  }).notNull(),
  resultData: text('result_data'),
  stepsGained: integer('steps_gained').notNull().default(0),
  distanceGained: numeric('distance_gained', { precision: 10, scale: 2 }).notNull().default('0'),
  isRare: boolean('is_rare').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/**
 * 探索成就（roadmap 任务二，drizzle/0021_achievements.sql）：
 *  - 每个用户每枚徽章一行：解锁即写入（unlockedAt + 解锁时刻进度快照）；
 *  - 不设进度表：进度全部由源表实时推导（见 src/lib/achievements-service.ts），
 *    本表 progress 仅为快照，不参与判定；
 *  - UNIQUE(user_id, badge_id) + ON CONFLICT DO NOTHING：并发/重复触发幂等，
 *    积分奖励在同事务内入账（users.points + points_log，reason='achievement'）。
 */
export const achievements = pgTable(
  'achievements',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id).notNull(),
    badgeId: text('badge_id').notNull(),
    progress: integer('progress').notNull().default(0),
    unlockedAt: timestamp('unlocked_at').defaultNow().notNull(),
  },
  (t) => [unique('achievements_user_badge_unique').on(t.userId, t.badgeId)],
);
