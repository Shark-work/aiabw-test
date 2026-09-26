import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // 快速失败：数据库不可达时按超时报错，而不是无限挂起（避免前端一直“注册中/加载中”）。
  // 注意：Neon 免费层会休眠（auto-suspend），冷启动唤醒可能 >5s，故默认放宽到 15s，
  // 可用 DB_CONNECTION_TIMEOUT_MS 覆盖。
  connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS ?? 15000),
  // 显式声明最大并发物理连接数（@neondatabase/serverless 默认 10）。
  // Neon 免费版 pooler 并发上限约 10，故保持 10；如遇连接超限可调低到 5。
  max: 10,
});

// 关键防护：pg Pool 的 'error' 事件（空闲连接被 Neon pooler 断开 / WebSocket 异常等）
// 必须挂监听器，否则 Node 会把该事件当成 uncaughtException 直接杀死整个进程
// （历史事故：tmp-server.err.log 中 "Unhandled error" → uncaughtException → 服务器
// 进程退出，前端发消息全部连接失败，表现为「AI 完全无回复」）。
// 挂监听后 pg 会安全地丢弃坏连接，后续查询自动新建连接。
pool.on("error", (err: unknown) => {
  console.error("[db] idle client error (connection dropped, will reconnect on next query):", err);
});

export const db = drizzle(pool);

// ============================================================================
// 自动建表（幂等，用于 Serverless/首次访问时确保表结构存在）
//
// 说明：生产环境（如 Vercel）的 Neon 库可能是全新空库，且 Serverless 环境
// 无法依赖 drizzle-kit 的 fs 目录迁移。因此这里用「CREATE TABLE IF NOT EXISTS
//  + ALTER TABLE ... ADD COLUMN IF NOT EXISTS」的幂等 DDL 同步结构：
//   - 空库：直接建出全部表；
//   - 旧库：缺失的新列会被补上，不会破坏已有数据。
// 若将来修改 src/db/schema.ts，请同步更新下面的 DDL。
// ============================================================================

const SCHEMA_CREATES: string[] = [
  `CREATE TABLE IF NOT EXISTS "users" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "email" text NOT NULL UNIQUE,
    "password_hash" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "is_creator" boolean DEFAULT false NOT NULL,
    "is_unlocked" boolean DEFAULT false NOT NULL,
    "creator_balance" integer DEFAULT 0 NOT NULL,
    "points" integer DEFAULT 0 NOT NULL,
    "last_checkin_date" text
  )`,

  `CREATE TABLE IF NOT EXISTS "ugc_pets" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "creator_id" uuid NOT NULL REFERENCES "users"("id"),
    "name" text NOT NULL,
    "image_url" text NOT NULL,
    "system_prompt" text NOT NULL,
    "price_or_points" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS "ugc_sales" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "pet_id" uuid NOT NULL REFERENCES "ugc_pets"("id"),
    "buyer_id" uuid NOT NULL REFERENCES "users"("id"),
    "creator_id" uuid NOT NULL REFERENCES "users"("id"),
    "amount" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS "handbooks" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid NOT NULL REFERENCES "users"("id"),
    "adoption_id" uuid REFERENCES "adoptions"("id"),
    "title" text,
    "content" text,
    "status" text DEFAULT 'processing' NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS "points_log" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid NOT NULL REFERENCES "users"("id"),
    "amount" integer DEFAULT 0 NOT NULL,
    "reason" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS "threads" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id" text NOT NULL,
    "anonymous_id" text,
    "title" text,
    "created_at" timestamp DEFAULT now() NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS "messages" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "thread_id" uuid NOT NULL REFERENCES "threads"("id"),
    "role" text NOT NULL,
    "parts" jsonb NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS "adoptions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id" text DEFAULT 'anonymous' NOT NULL,
    "anonymous_id" text,
    "thread_id" uuid REFERENCES "threads"("id"),
    "pet_name" text NOT NULL,
    "pet_type" text DEFAULT 'fox' NOT NULL,
    "adopted_at" timestamp DEFAULT now() NOT NULL,
    "happiness" integer DEFAULT 50 NOT NULL,
    "last_interacted_at" timestamp,
    "level" integer DEFAULT 1 NOT NULL,
    "chat_count" integer DEFAULT 0 NOT NULL,
    "monthly_points" integer DEFAULT 0 NOT NULL,
    "is_unlocked" boolean DEFAULT false NOT NULL,
    "memory_context" text
  )`,

  `CREATE TABLE IF NOT EXISTS "agent_memories" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "memory_type" text NOT NULL,
    "content" text NOT NULL,
    "embedding" double precision[] NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "last_accessed" timestamp DEFAULT now() NOT NULL,
    "important" boolean DEFAULT false NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS "invite_rewards" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "inviter_id" uuid NOT NULL REFERENCES "users"("id"),
    "invited_user_id" uuid NOT NULL REFERENCES "users"("id"),
    "ip" text,
    "device_id" text,
    "amount" integer DEFAULT 50 NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
  )`,

  // ===== 宠物系统底层架构（预计算生成 + 宠物字典）=====
  // 宠物字典：现实动物物种（所有预计算宠物的基础模板）
  `CREATE TABLE IF NOT EXISTS "pet_dictionary" (
    "id" text PRIMARY KEY,
    "name_zh" text NOT NULL,
    "name_en" text NOT NULL,
    "category" text NOT NULL,
    "habitat" text,
    "default_description_zh" text NOT NULL,
    "default_description_en" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
  )`,

  // 预计算宠物实例：离线批量生成（HashLips 类工具 + Vercel Blob），synthesize 只做分配
  `CREATE TABLE IF NOT EXISTS "pets" (
    "id" text PRIMARY KEY,
    "species_id" text NOT NULL REFERENCES "pet_dictionary"("id"),
    "image_url" text NOT NULL,
    "traits" jsonb DEFAULT '{}' NOT NULL,
    "generation" integer DEFAULT 1 NOT NULL,
    "parent_ids" jsonb,
    "custom_description" text,
    "owner_id" uuid REFERENCES "users"("id"),
    "created_at" timestamp DEFAULT now() NOT NULL,
    "adopted_at" timestamp,
    "last_interaction_time" timestamp
  )`,

  // ===== NFR 数字藏品合规架构 =====
  // 藏品定义表：物种×稀有度 = 一种 NFR 藏品类型（含总发行量/已铸造数）
  `CREATE TABLE IF NOT EXISTS "digital_collectibles" (
    "id" text PRIMARY KEY,
    "species_id" text NOT NULL,
    "name_zh" text NOT NULL,
    "name_en" text NOT NULL,
    "category" text NOT NULL,
    "habitat" text,
    "rarity" text NOT NULL DEFAULT 'common',
    "element" text,
    "base_image_url" text NOT NULL,
    "total_supply" integer NOT NULL DEFAULT 0,
    "minted" integer NOT NULL DEFAULT 0,
    "description_zh" text,
    "description_en" text,
    "is_visible" boolean NOT NULL DEFAULT true,
    "created_at" timestamp NOT NULL DEFAULT now()
  )`,
  // 用户资产确权表：用户持有的每一件 NFR 个体（DNA/世代/哈希/冷却期）
  `CREATE TABLE IF NOT EXISTS "user_collectibles" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "owner_id" uuid NOT NULL REFERENCES "users"("id"),
    "collectible_id" text NOT NULL REFERENCES "digital_collectibles"("id"),
    "source_pet_id" text REFERENCES "pets"("id"),
    "adoption_id" uuid REFERENCES "adoptions"("id"),
    "dna_sequence" jsonb NOT NULL,
    "generation" integer NOT NULL DEFAULT 1,
    "hash_id" text NOT NULL UNIQUE,
    "parent_hash_ids" jsonb,
    "locked_until" timestamp NOT NULL DEFAULT now(),
    "breed_cooldown_until" timestamp NOT NULL DEFAULT now(),
    "status" text NOT NULL DEFAULT 'active',
    "minted_at" timestamp NOT NULL DEFAULT now(),
    "transferred_count" integer NOT NULL DEFAULT 0
  )`,

  // ===== 情绪与特权消费 =====
  // 装扮商品定义（皮肤 / 特效），人民币购买
  `CREATE TABLE IF NOT EXISTS "cosmetics" (
    "id" text PRIMARY KEY,
    "name_zh" text NOT NULL,
    "name_en" text NOT NULL,
    "kind" text NOT NULL DEFAULT 'skin',
    "image_url" text,
    "price_cny" numeric DEFAULT 1 NOT NULL,
    "is_visible" boolean NOT NULL DEFAULT true,
    "created_at" timestamp NOT NULL DEFAULT now()
  )`,
  // 用户已购装扮（可绑定到具体宠物；adoption_id 为空 = 账号全局）
  `CREATE TABLE IF NOT EXISTS "user_cosmetics" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "users"("id"),
    "cosmetic_id" text NOT NULL REFERENCES "cosmetics"("id"),
    "adoption_id" uuid REFERENCES "adoptions"("id"),
    "status" text NOT NULL DEFAULT 'active',
    "created_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_uc_cosmetic_uniq ON "user_cosmetics" ("user_id", "cosmetic_id", "adoption_id")`,

  // P0-1 每日签到 · 用户道具背包（连签 7 天开心情盲盒：帽子/围巾/玩具，可装备到领养宠物展示）
  `CREATE TABLE IF NOT EXISTS "user_items" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "users"("id"),
    "item_key" text NOT NULL,
    "rarity" text NOT NULL DEFAULT 'common',
    "source" text NOT NULL DEFAULT 'checkin_blindbox',
    "equipped_adoption_id" uuid REFERENCES "adoptions"("id"),
    "created_at" timestamp NOT NULL DEFAULT now()
  )`,

  // ===== AIGC 盲盒引擎 =====
  // 盲盒奖池定义（概率 JSONB + 物种白名单）
  `CREATE TABLE IF NOT EXISTS "blindbox_pools" (
    "id" text PRIMARY KEY,
    "name_zh" text NOT NULL,
    "name_en" text NOT NULL,
    "price_cny" numeric NOT NULL DEFAULT 1,
    "price_points" integer NOT NULL DEFAULT 200,
    "probabilities" jsonb NOT NULL,
    "species_ids" jsonb NOT NULL DEFAULT '[]',
    "is_active" boolean NOT NULL DEFAULT true,
    "created_at" timestamp NOT NULL DEFAULT now()
  )`,
  // 抽奖流水（审计 / 防超发 / 幂等）
  `CREATE TABLE IF NOT EXISTS "blindbox_logs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "users"("id"),
    "pool_id" text NOT NULL REFERENCES "blindbox_pools"("id"),
    "result_collectible_id" text NOT NULL,
    "result_hash_id" text NOT NULL,
    "is_legendary" boolean NOT NULL DEFAULT false,
    "pay_method" text NOT NULL,
    "cost" numeric NOT NULL DEFAULT 0,
    "created_at" timestamp NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_blindbox_logs_user ON "blindbox_logs" ("user_id", "created_at")`,
  `CREATE INDEX IF NOT EXISTS idx_blindbox_logs_pool ON "blindbox_logs" ("pool_id")`,
  // XorPay 盲盒通道：order_id 唯一（回调幂等，防重复抽奖）
  `ALTER TABLE "blindbox_logs" ADD COLUMN IF NOT EXISTS "order_id" text`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_blindbox_logs_order ON "blindbox_logs" ("order_id")`,

  // 站点访问计数：单行汇总（id=1），原子自增 visit_count / unique_count
  `CREATE TABLE IF NOT EXISTS "site_visits" (
    "id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
    "visit_count" bigint DEFAULT 0 NOT NULL,
    "unique_count" bigint DEFAULT 0 NOT NULL,
    "last_updated" timestamp DEFAULT now() NOT NULL
  )`,

  // 动物世界头条（Animal News）：全网动物趣闻聚合，热度分排序
  `CREATE TABLE IF NOT EXISTS "hotnews" (
    "id" serial PRIMARY KEY,
    "source" text NOT NULL,
    "title" text NOT NULL,
    "desc" text,
    "cover" text,
    "hot" double precision DEFAULT 0 NOT NULL,
    "timestamp" bigint DEFAULT 0 NOT NULL,
    "url" text
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_hotnews_source_title ON "hotnews" ("source", "title")`,

  // 登录审计：记录失败尝试（防暴力破解，保留最近记录用于审计）
  `CREATE TABLE IF NOT EXISTS "login_attempts" (
    "id" serial PRIMARY KEY,
    "ip" text NOT NULL,
    "email" text,
    "attempted_at" timestamp DEFAULT now() NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_time ON "login_attempts" ("ip", "attempted_at")`,
  // P2 Web Push 召回：浏览器推送订阅（endpoint 全局唯一；user_id/anonymous_id 二选一归属）
  `CREATE TABLE IF NOT EXISTS "push_subscriptions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "endpoint" text NOT NULL UNIQUE,
    "p256dh" text NOT NULL,
    "auth" text NOT NULL,
    "user_id" text,
    "anonymous_id" text,
    "locale" text DEFAULT 'zh' NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "last_seen_at" timestamp DEFAULT now() NOT NULL,
    "last_notified_at" timestamp
  )`,


  // 宠物旅行日记：旅行明信片（V1 遗产表，成就系统折算口径数据源，保留）
  `CREATE TABLE IF NOT EXISTS "user_postcards" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid NOT NULL REFERENCES "users"("id"),
    "adoption_id" uuid REFERENCES "adoptions"("id"),
    "map_id" integer NOT NULL,
    "map_name_zh" text NOT NULL,
    "map_name_en" text NOT NULL,
    "ai_summary_zh" text NOT NULL,
    "ai_summary_en" text NOT NULL,
    "illustration_emoji" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
  )`,
  // 宠物旅行日记 · 探险商城（drizzle/0017_shop.sql）：商品目录 + 订单流水
  `CREATE TABLE IF NOT EXISTS "shop_items" (
    "id" text PRIMARY KEY,
    "name_zh" text NOT NULL,
    "name_en" text NOT NULL,
    "description_zh" text NOT NULL,
    "description_en" text NOT NULL,
    "icon" text NOT NULL,
    "price" integer NOT NULL,
    "currency" text DEFAULT 'coin' NOT NULL,
    "effect_type" text NOT NULL,
    "effect_value" double precision DEFAULT 1.0 NOT NULL,
    "duration" integer DEFAULT -1 NOT NULL,
    "is_premium" boolean DEFAULT false NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS "user_orders" (
    "id" text PRIMARY KEY,
    "user_id" uuid NOT NULL REFERENCES "users"("id"),
    "item_id" text NOT NULL REFERENCES "shop_items"("id"),
    "quantity" integer DEFAULT 1 NOT NULL,
    "total_price" integer NOT NULL,
    "currency" text NOT NULL,
    "status" text DEFAULT 'completed' NOT NULL,
    "paid_at" timestamp DEFAULT now() NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
  )`,

  // 宠物旅行日记 · VIP 订阅系统（drizzle/0018_subscription.sql）
  // 每日聊天额度（user_id+date 唯一）+ 订阅计划目录 + 用户订阅实例
  `CREATE TABLE IF NOT EXISTS "chat_quotas" (
    "id" text PRIMARY KEY,
    "user_id" uuid NOT NULL REFERENCES "users"("id"),
    "date" text NOT NULL,
    "message_count" integer DEFAULT 0 NOT NULL,
    "last_message_at" timestamp
  )`,
  `CREATE TABLE IF NOT EXISTS "subscription_plans" (
    "id" text PRIMARY KEY,
    "name_zh" text NOT NULL,
    "name_en" text NOT NULL,
    "price_rmb" integer NOT NULL,
    "duration_days" integer NOT NULL,
    "daily_chat_limit" integer NOT NULL,
    "features" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "badge_zh" text DEFAULT '' NOT NULL,
    "badge_en" text DEFAULT '' NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "user_subscriptions" (
    "id" text PRIMARY KEY,
    "user_id" uuid NOT NULL REFERENCES "users"("id"),
    "plan_id" text NOT NULL REFERENCES "subscription_plans"("id"),
    "status" text DEFAULT 'active' NOT NULL,
    "started_at" timestamp DEFAULT now() NOT NULL,
    "expires_at" timestamp NOT NULL,
    "payment_id" text,
    "auto_renew" boolean DEFAULT true NOT NULL
  )`,
  // 宠物旅行日记 · 宠物长期记忆库（VIP 专属，drizzle/0019_pet_memories.sql）
  `CREATE TABLE IF NOT EXISTS "pet_memories" (
    "id"               text PRIMARY KEY,
    "user_id"          uuid NOT NULL REFERENCES "users"("id"),
    "pet_id"           text,
    "memory_type"      text NOT NULL CHECK ("memory_type" IN ('preference', 'event', 'fact', 'emotion')),
    "content"          text NOT NULL,
    "source_message"   text,
    "importance"       integer DEFAULT 5 NOT NULL CHECK ("importance" BETWEEN 1 AND 10),
    "times_recalled"   integer DEFAULT 0 NOT NULL,
    "last_recalled_at" timestamp,
    "expires_at"       timestamp,
    "created_at"       timestamp DEFAULT now() NOT NULL
  )`,
  // 探索 v2 · 动物知识百科（drizzle/0020_exploration_v2.sql；与聊天驱动步数系统并行）
  `CREATE TABLE IF NOT EXISTS "animal_wiki" (
    "id"                  text PRIMARY KEY,
    "species"             text NOT NULL,
    "category"            text NOT NULL,
    "origin"              text,
    "lifespan"            text,
    "weight"              text,
    "traits"              text DEFAULT '[]' NOT NULL,
    "fun_facts"           text DEFAULT '[]' NOT NULL,
    "habitat"             text,
    "diet"                text,
    "conservation_status" text,
    "image_url"           text,
    "created_at"          timestamp DEFAULT now() NOT NULL
  )`,
  // 探索 v2 · 事件库（按权重随机抽取）
  `CREATE TABLE IF NOT EXISTS "exploration_events" (
    "id"                 text PRIMARY KEY,
    "pet_category"       text,
    "event_type"         text NOT NULL CHECK ("event_type" IN ('postcard','gift','knowledge','encounter','rest')),
    "title"              text NOT NULL,
    "description"        text NOT NULL,
    "image_emoji"        text,
    "rarity"             text DEFAULT 'common' NOT NULL CHECK ("rarity" IN ('common','rare','epic')),
    "weight"             integer DEFAULT 10 NOT NULL,
    "required_equipment" text,
    "knowledge_link"     text,
    "created_at"         timestamp DEFAULT now() NOT NULL
  )`,
  // 探索 v2 · 探索记录（每次探索落库一行）
  `CREATE TABLE IF NOT EXISTS "exploration_records" (
    "id"              text PRIMARY KEY,
    "user_id"         uuid NOT NULL REFERENCES "users"("id"),
    "pet_id"          text,
    "event_id"        text REFERENCES "exploration_events"("id"),
    "result_type"     text NOT NULL CHECK ("result_type" IN ('postcard','gift','knowledge','encounter','rest')),
    "result_data"     text,
    "steps_gained"    integer DEFAULT 0 NOT NULL,
    "distance_gained" numeric(10,2) DEFAULT 0 NOT NULL,
    "is_rare"         boolean DEFAULT false NOT NULL,
    "created_at"      timestamp DEFAULT now() NOT NULL
  )`,

  // UGC 内容创作工坊（drizzle/0023_ugc_workshop.sql）
  // P0：ugc_creations（日记卡片 / AI 写真生成记录）；P1 预留：campaigns + submissions
  `CREATE TABLE IF NOT EXISTS "ugc_creations" (
    "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id"    uuid NOT NULL REFERENCES "users"("id"),
    "pet_id"     text,
    "type"       text NOT NULL CHECK ("type" IN ('portrait', 'diary_card', 'sticker')),
    "style"      text,
    "image_url"  text NOT NULL,
    "is_premium" boolean DEFAULT false NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "ugc_campaigns" (
    "id"            text PRIMARY KEY,
    "title"         text NOT NULL,
    "description"   text,
    "start_date"    timestamp,
    "end_date"      timestamp,
    "reward_points" integer DEFAULT 0 NOT NULL,
    "is_active"     boolean DEFAULT true NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "ugc_submissions" (
    "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "campaign_id"  text NOT NULL REFERENCES "ugc_campaigns"("id"),
    "user_id"      uuid NOT NULL REFERENCES "users"("id"),
    "content_type" text NOT NULL CHECK ("content_type" IN ('image', 'video', 'text')),
    "content_url"  text,
    "status"       text DEFAULT 'pending' NOT NULL CHECK ("status" IN ('pending', 'approved', 'rejected', 'featured')),
    "likes"        integer DEFAULT 0 NOT NULL,
    "created_at"   timestamp DEFAULT now() NOT NULL
  )`,

  // 探索 v2 · 种子数据 · 动物知识百科（波斯猫；与 0020_exploration_v2.sql 一致）
  `INSERT INTO "animal_wiki" (
     "id","species","category","origin","lifespan","weight",
     "traits","fun_facts","habitat","diet","conservation_status","image_url"
   ) VALUES (
     'persian-cat',
     '波斯猫 / Persian Cat',
     '猫',
     '伊朗（古波斯）',
     '12-17年',
     '3-7 kg',
     '["安静","温顺","喜欢被抚摸","不太活泼","爱干净"]',
     '["波斯猫是世界上最古老的猫品种之一，起源于17世纪的波斯（今伊朗）","它们的长毛需要每天梳理，否则容易打结","波斯猫的鼻梁扁平，属于短头颅品种，在炎热天气需要特别注意防暑","它们的叫声非常轻柔，几乎像是耳语","波斯猫在1871年伦敦举办的世界上第一场猫展上首次亮相并一举成名"]',
     '室内为主，喜欢温暖安静的环境',
     '肉食性，偏好高蛋白猫粮，因面部结构特殊建议使用浅盘喂食',
     '家养宠物，无保护级别',
     NULL
   ) ON CONFLICT ("id") DO NOTHING`,

  // 探索 v2 · 种子数据 · 探索事件库（20 条覆盖 5 类 3 稀有度）
  `INSERT INTO "exploration_events" ("id","pet_category","event_type","title","description","image_emoji","rarity","weight","knowledge_link") VALUES
     ('evt-001','cat','postcard','森林里的蝴蝶','今天在森林里发现了一只美丽的蓝色蝴蝶，它停在了一朵小花上，我看了好久～','🦋','common',30,NULL),
     ('evt-002','cat','postcard','山顶的日落','我爬到了一座小山顶，看到了好漂亮的橙色日落！要是你也在就好了～','🌅','rare',10,NULL),
     ('evt-003','cat','postcard','遇到了一只小松鼠','树林里有只松鼠掉了一颗松果，我好奇地凑过去闻了闻，它就跑掉了～','🐿','common',25,NULL),
     ('evt-004','cat','postcard','下雨天躲屋檐','突然下起了小雨，我躲在一个小木屋的屋檐下，看着雨滴发呆～','🌧️','common',20,NULL),
     ('evt-005','cat','postcard','星空下的草地','今晚的星星好多好亮，我躺在草地上数星星，数到第47颗就睡着了…','✨','rare',8,NULL),
     ('evt-006','cat','gift','带回了小鱼干','路边捡到一条小鱼干！应该是谁掉的吧…反正我带回来给你啦～','🐟','common',25,NULL),
     ('evt-007','cat','gift','捡到四叶草','草从里发现了一片四叶草！听说会带来好运哦～','🍀','rare',10,NULL),
     ('evt-008','cat','gift','好看的鹅卵石','河边有一块特别光滑的石头，条纹好好看，我叼回来送你～','🪨','common',20,NULL),
     ('evt-009','cat','gift','一朵小野花','路边的小野花，粉粉色的，夹在信里寄给你💌','🌸','common',20,NULL),
     ('evt-010','cat','gift','神秘的小盒子','在树洞里发现了一个旧盒子，不知道里面有什么…你要不要打开看看？','🎁','epic',3,NULL),
     ('evt-011','cat','knowledge','你知道吗？','波斯猫的祖先来自古波斯（今天的伊朗），它们在17世纪才被带到欧洲～','📖','common',15,'persian-cat'),
     ('evt-012','cat','knowledge','小科普','我的长毛每天都需要梳理，不然会打结哦！所以主人要勤快一点～','📚','common',15,'persian-cat'),
     ('evt-013','cat','knowledge','有趣的事实','波斯猫在1871年伦敦的第一届猫展上首次亮相，当时就大受欢迎！','✨','rare',8,'persian-cat'),
     ('evt-014','cat','encounter','遇到流浪猫朋友','遇到了一只橙色的流浪猫，它好胖啊，我怀疑它每天都在偷吃人类的食物…','🐱','common',15,NULL),
     ('evt-015','cat','encounter','被狗追了','一只大金毛突然跑过来想跟我玩，我吓得赶紧爬到树上…它不会爬树，哈哈～','🐕','common',12,NULL),
     ('evt-016','cat','encounter','遇到老爷爷喂食','公园里的老爷爷看到我就拿猫粮喂我，他好温柔，我蹏了蹏他的手～','👴','common',15,NULL),
     ('evt-017','cat','rest','在阳光下午睡','找到一个和暖的窗台，晒着太阳睡着了，梦到了好多小鱼干…','💤','common',20,NULL),
     ('evt-018','cat','rest','在纸箱里发呆','发现了一个快递纸箱，钻进去刚刚好！纸箱真是世界上最好的发明～','📦','common',18,NULL),
     ('evt-019','cat','rest','舔毛时间','坐在阳台上认认真真舔了一个小时的毛，现在我是世界上最干净的猫了！','✨','common',15,NULL),
     ('evt-020','cat','rest','看窗外的鸟','窗台上停了一只小鸟，我盯着它看了好久，它盯着我看了一会儿就飞走了…','🐦','common',15,NULL)
   ON CONFLICT ("id") DO NOTHING`,

  // 探索 v2 · 种子数据 · 动物知识百科（赤狐 + 柴犬；数据驱动，与波斯猫同构）
  `INSERT INTO "animal_wiki" (
     "id","species","category","origin","lifespan","weight",
     "traits","fun_facts","habitat","diet","conservation_status","image_url"
   ) VALUES
   (
     'red-fox',
     '赤狐 / Red Fox',
     '狐',
     '北半球广布（欧亚大陆、北美洲）',
     '野生3-4年，圈养可达10-12年',
     '4-8 kg',
     '["机敏","好奇","独立","夜行性","适应力极强"]',
     '["赤狐是分布最广的野生犬科动物，几乎遍布整个北半球","赤狐能利用地球磁场定位捕猎——扑向雪下的猎物时，朝东北方向跳跃成功率更高","赤狐的大尾巴不仅是平衡器，冬天还能当围巾裹住身体保暖","赤狐能发出超过40种不同的声音，最著名的是类似尖叫的求偶叫声","赤狐脚掌上长有毛发，冬天像穿了雪地靴，在积雪中行走不易下陷"]',
     '森林、草原、山地乃至城市郊区，适应性极强',
     '杂食性，以鼠类、兔类为主，也吃鸟类、昆虫、浆果',
     '无危（LC，IUCN 红色名录）',
     NULL
   ),
   (
     'shiba-inu',
     '柴犬 / Shiba Inu',
     '犬',
     '日本（本州山地）',
     '12-15年',
     '8-11 kg',
     '["忠诚","倔强","爱干净","警惕","表情丰富"]',
     '["柴犬是日本六种原生犬种中体型最小的一种，已有超过2000年历史","柴犬的名字来源有两种说法：一说因为在灌木丛（柴）中狩猎，一说因为毛色像枯柴","柴犬极度爱干净，会像猫一样舔毛清洁自己，还会主动避开泥坑","柴犬的飞机耳和眯眼微笑是它们表达开心的招牌动作","2013年风靡全球的 Doge 表情包，原型是一只名叫 Kabosu 的日本柴犬"]',
     '起源于日本山地，现为城市家庭伴侣犬，能适应公寓生活',
     '肉食为主，优质犬粮；易发胖体质，需要控制零食',
     '家养宠物，无保护级别（日本天然纪念物）',
     NULL
   )
   ON CONFLICT ("id") DO NOTHING`,

  // 探索 v2 · 种子数据 · 探索事件库（赤狐 evt-021~030 + 柴犬 evt-031~040；
  // 5 类事件 × 3 稀有度：common 13 / rare 5 / epic 2；knowledge 类链接对应百科 id）
  `INSERT INTO "exploration_events" ("id","pet_category","event_type","title","description","image_emoji","rarity","weight","knowledge_link") VALUES
     -- 赤狐（fox）
     ('evt-021','fox','postcard','晨雾中的森林','今天起了个大早，森林里全是白茫茫的雾，我踩在软软的苔藓上，像走在云朵里～','🌫️','common',25,NULL),
     ('evt-022','fox','postcard','雪地里的一串脚印','下了一夜雪，我回头看到自己留下的一串小脚印，一直延伸到看不见的远方，突然有点想家…','🐾','rare',10,NULL),
     ('evt-023','fox','gift','叼回一颗松果','捡到一颗特别完美的松果！鳞片排列得整整齐齐，送你当收藏品～','🌲','common',22,NULL),
     ('evt-024','fox','gift','火红的枫叶','找到了一片和我毛色一模一样的红枫叶！据说捡到它的狐狸会遇到真爱…先送你保管！','🍁','epic',3,NULL),
     ('evt-025','fox','knowledge','狐狸的小秘密','你知道吗？我们赤狐扑向雪地里的老鼠时，朝东北方向跳成功率最高——科学家说我们能感应地球磁场！','🧭','common',15,'red-fox'),
     ('evt-026','fox','knowledge','尾巴的妙用','我的大尾巴不只是好看哦！冬天睡觉时把它盖在鼻子上，就是一条天然围巾～','🦊','rare',8,'red-fox'),
     ('evt-027','fox','encounter','和刺猬对峙','遇到一只缩成球的刺猬，我围着它转了三圈愣是下不去嘴…算了算了，惹不起！','🦔','common',15,NULL),
     ('evt-028','fox','encounter','城市边缘的冒险','今晚溜到了人类的小区边上，路灯好亮啊！有个小孩趴在窗户上看我，我冲他眨了眨眼～','🌃','rare',8,NULL),
     ('evt-029','fox','rest','树洞里的午觉','找到一个空心老树洞，蜷成一圈睡了一下午，尾巴盖着脸，谁也叫不醒～','💤','common',18,NULL),
     ('evt-030','fox','rest','溪边喝水休息','走累了在小溪边喝水，水好凉好甜，还看到几条小鱼从脚边游过去～','🏞️','common',15,NULL),
     -- 柴犬（dog）
     ('evt-031','dog','postcard','樱花树下转圈圈','公园里的樱花开了！我在树下追着飘落的花瓣转圈圈，路人都停下来给我拍照～','🌸','common',25,NULL),
     ('evt-032','dog','postcard','神社前的沉思','路过一座小神社，我在鸟居下面坐了一会儿，不知道为什么突然变得好庄重…','⛩️','rare',10,NULL),
     ('evt-033','dog','gift','叼回一根木棍','看我捡到的这根木棍！又长又直，手感超棒，这是我今天最大的战利品！','🪵','common',22,NULL),
     ('evt-034','dog','gift','幸运达摩小挂件','在庙会摊位边捡到一个迷你达摩挂件！摊主爷爷说我是有福气的柴柴，就送给我啦～','🎎','epic',3,NULL),
     ('evt-035','dog','knowledge','柴犬冷知识','告诉你哦，我们柴犬已经有2000多年历史了，是日本原生犬种里最小只的！祖先是山地猎犬～','⛰️','common',15,'shiba-inu'),
     ('evt-036','dog','knowledge','爱干净的天性','我们柴犬会像猫一样自己舔毛做清洁！所以别嫌我挑剔，泥坑我是真的不想踩…','🛁','rare',8,'shiba-inu'),
     ('evt-037','dog','encounter','倔强的拔河','散步时突然不想走了，原地坐下！主人拉绳子我就往后躺——最后他只好抱我回家，嘿嘿～','🦮','common',15,NULL),
     ('evt-038','dog','encounter','遇到秋田大哥','遇到一只比我大两圈的秋田犬，本来想凶一下的，抬头看了看体型差距…还是先打个招呼吧！','🐕','common',12,NULL),
     ('evt-039','dog','rest','飞机耳晒太阳','趴在阳台的垫子上晒太阳，耳朵开心得变成飞机耳，被主人偷拍了一百张…','☀️','common',18,NULL),
     ('evt-040','dog','rest','蜷成甜甜圈','把自己蜷成一个完美的甜甜圈形状，尾巴刚好盖住鼻子，这是我最有安全感的睡姿～','🍩','common',15,NULL)
   ON CONFLICT ("id") DO NOTHING`,

  // 探索 v2 · 种子数据 · 动物知识百科（垂耳兔 + 玄凤鹦鹉；数据驱动，与波斯猫/赤狐同构；image_url NULL，立绘占位由事件 image_emoji / i18n avatarEmoji 承担）
  `INSERT INTO "animal_wiki" (
     "id","species","category","origin","lifespan","weight",
     "traits","fun_facts","habitat","diet","conservation_status","image_url"
   ) VALUES
   (
     'lop-rabbit',
     '垂耳兔 / Lop Rabbit',
     '兔',
     '欧洲（荷兰、法国）',
     '7-10年',
     '1.5-2.5 kg',
     '["温顺","胆小","爱撒娇","爱干净","喜欢被摸头"]',
     '["垂耳兔的下垂耳朵是基因突变的结果，不同个体的耳朵长度差异很大","垂耳兔的耳朵非常敏感且布满血管，被大力抓扯会受伤，正确抱法是托住屁股和后腿","兔子是严格的草食动物，靠盲肠发酵消化纤维，胡萝卜糖分高只能当零食","垂耳兔开心时会原地蹦跳甩头，这个动作被爱好者称为「兔子舞」（binky）","兔子的视野接近360度，但正前方反而是盲区，靠嗅觉和胡须感知面前的食物"]',
     '家庭室内饲养为主，需要干草、躲避屋与安全的活动空间',
     '草食性，以提摩西草为主食，辅以兔粮与少量新鲜蔬菜（胡萝卜少量）',
     '家养宠物，无保护级别',
     NULL
   ),
   (
     'cockatiel',
     '玄凤鹦鹉 / Cockatiel',
     '鹦鹉',
     '澳大利亚内陆',
     '15-20年',
     '80-120 g',
     '["活泼","话痨","好奇心强","爱模仿","黏人"]',
     '["玄凤鹦鹉是凤头鹦鹉科中体型最小的成员，原产于澳大利亚内陆","雄性玄凤鹦鹉更擅长吹口哨和模仿声音，常用歌声吸引伴侣","玄凤鹦鹉的冠羽是情绪晴雨表：竖起表示兴奋或警觉，贴平表示放松或害怕","野生玄凤鹦鹉成群飞行数十公里寻找水源，飞行时翅膀会发出独特的呼啸声","玄凤鹦鹉脸颊上的橙色斑点被爱好者称为「腮红」，是它们最招牌的特征"]',
     '澳大利亚干旱与半干旱内陆，成群栖息于水源附近的开阔林地',
     '植食性，以草籽、谷物为主，也吃浆果与嫩芽；家养需墨鱼骨补钙',
     '无危（LC，IUCN 红色名录）',
     NULL
   )
   ON CONFLICT ("id") DO NOTHING`,

  // 探索 v2 · 种子数据 · 探索事件库（垂耳兔 evt-041~050 + 玄凤鹦鹉 evt-051~060；
  // 5 类事件 × 3 稀有度：common 10 / rare 7 / epic 3；垂耳兔 3 条食材类 gift 呼应「额外掉落食材」特性，
  // 玄凤鹦鹉 rare+epic 占 6 条呼应「高空视野发现稀有事件」特性（evt-057 空中奇遇 / evt-060 远山宝藏）；
  // knowledge 类链接对应百科 id）
  `INSERT INTO "exploration_events" ("id","pet_category","event_type","title","description","image_emoji","rarity","weight","knowledge_link") VALUES
     -- 垂耳兔（rabbit）
     ('evt-041','rabbit','postcard','蒲公英草地的清晨','清晨的草地还带着露水，我蹦过的地方留下一串小脚印，蒲公英跟着我一起飞起来了～','🌼','common',25,NULL),
     ('evt-042','rabbit','postcard','篱笆外的晚霞','我鼓起勇气跳上篱笆，看到了整片橙红色的天空！虽然有点高，但风景真的好好…','🌇','rare',9,NULL),
     ('evt-043','rabbit','gift','挖到甜胡萝卜','鼻子一直闻到香香的味道，顺着挖下去——是一根超大的胡萝卜！带回去给你煮汤～','🥕','common',22,NULL),
     ('evt-044','rabbit','gift','发现一窝野莓','灌木丛深处藏着一小片野莓丛，我尝了一颗，酸酸甜甜的！摘了最饱满的几颗送给你～','🫐','rare',9,NULL),
     ('evt-045','rabbit','gift','神秘的黄金胡萝卜','在很老很老的橡树洞里，发现了一根闪闪发光的金色胡萝卜！这一定是传说中的宝物吧…','🌟','epic',3,NULL),
     ('evt-046','rabbit','knowledge','兔兔的小知识','你知道吗？我们兔子的视野接近360度，能看到身后的动静，但正前方反而是盲区哦～','📖','common',15,'lop-rabbit'),
     ('evt-047','rabbit','knowledge','耳朵的秘密','我们垂耳兔的耳朵又软又敏感，被轻轻摸会害羞得跺脚……但主人摸的话，可、可以哦。','🐰','rare',8,'lop-rabbit'),
     ('evt-048','rabbit','encounter','和小田鼠分食','遇到一只抱着草籽的小田鼠，我分了一半嫩草给它，它送了我一颗橡果当谢礼～','🐭','common',15,NULL),
     ('evt-049','rabbit','encounter','被蝴蝶吓了一跳','一只蝴蝶突然停在我鼻子上，我吓得原地蹦起来跺了三下脚……才不是害怕，是打招呼！','🦋','common',12,NULL),
     ('evt-050','rabbit','rest','缩成一团晒太阳','阳光暖洋洋的，我把自己缩成一小团，耳朵盖在脸上，谁路过都发现不了我，嘿嘿～','☀️','common',18,NULL),
     -- 玄凤鹦鹉（bird）
     ('evt-051','bird','postcard','云层之上的日出','我飞到比云还高的地方，看到太阳从棉花糖一样的云海里跳出来！这种景色一定要讲给你听！','🌅','rare',10,NULL),
     ('evt-052','bird','postcard','山谷里的回声','对着山谷喊了一声「你好——」，山谷回了我十声「你好」！我们聊了整整一个下午～','🏔️','common',20,NULL),
     ('evt-053','bird','gift','衔回闪亮卵石','在溪边发现一颗会反光的白色卵石！亮晶晶的东西必须收藏，送你啦～','🪨','common',20,NULL),
     ('evt-054','bird','gift','远方浆果的种子','从很远很远的山那边带回来的浆果种子，种下去说不定会长出异国味道的果子哦！','🌱','rare',8,NULL),
     ('evt-055','bird','knowledge','鹦鹉小课堂','告诉你哦，我们的冠羽是心情晴雨表——竖起来是超级好奇，贴平是放松，你学会读了吗？','🎓','common',15,'cockatiel'),
     ('evt-056','bird','knowledge','口哨的天赋','我们玄凤鹦鹉天生爱吹口哨，尤其是男孩子，听过两遍的旋律就能哼出来，厉害吧！','🎵','rare',8,'cockatiel'),
     ('evt-057','bird','encounter','空中奇遇·热气球','高空巡逻时遇到一个会飞的大彩球！里面的人类朝我挥手，我绕着它飞了三圈表示欢迎～','🎈','rare',8,NULL),
     ('evt-058','bird','encounter','与老鹰的对视','在悬崖边和一只老鹰对视了十秒钟！它没有生气，只是点了点头——那一刻我觉得自己也是猛禽了！','🦅','epic',3,NULL),
     ('evt-059','bird','rest','树枝上午睡','找到一根晒得暖暖的树枝，单脚站着打了个盹，梦里有吃不完的小米穗～','🌿','common',16,NULL),
     ('evt-060','bird','rest','远山宝藏的黄昏','黄昏时我登上最高的瞭望树，看见远山背后有金色的光在闪！下次探索一定要飞过去看看！','🗺️','epic',2,NULL)
   ON CONFLICT ("id") DO NOTHING`,

  // 探索成就（drizzle/0021_achievements.sql，roadmap 任务二）：
  // 徽章解锁记录；UNIQUE(user_id,badge_id) 保证解锁入账幂等；进度快照见列注释
  `CREATE TABLE IF NOT EXISTS "achievements" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid NOT NULL REFERENCES "users"("id"),
    "badge_id" text NOT NULL,
    "progress" integer DEFAULT 0 NOT NULL,
    "unlocked_at" timestamp DEFAULT now() NOT NULL,
    CONSTRAINT "achievements_user_badge_unique" UNIQUE ("user_id", "badge_id")
  )`,
];

/**
 * 兼容旧库：为已有表补充后续新增的列（全部带默认值，安全回填）。
 * 注意：这些 ALTER 在“表已存在”的快速路径上也会执行（幂等）——
 * 否则新列永远不会被应用到已存在的生产库。
 */
const SCHEMA_ALTERS: string[] = [
  `ALTER TABLE "adoptions" ADD COLUMN IF NOT EXISTS "pet_type" text DEFAULT 'fox' NOT NULL`,
  `ALTER TABLE "adoptions" ADD COLUMN IF NOT EXISTS "happiness" integer DEFAULT 50 NOT NULL`,
  `ALTER TABLE "adoptions" ADD COLUMN IF NOT EXISTS "last_interacted_at" timestamp`,
  `ALTER TABLE "adoptions" ADD COLUMN IF NOT EXISTS "level" integer DEFAULT 1 NOT NULL`,
  `ALTER TABLE "adoptions" ADD COLUMN IF NOT EXISTS "chat_count" integer DEFAULT 0 NOT NULL`,
  `ALTER TABLE "adoptions" ADD COLUMN IF NOT EXISTS "monthly_points" integer DEFAULT 0 NOT NULL`,
  `ALTER TABLE "adoptions" ADD COLUMN IF NOT EXISTS "is_unlocked" boolean DEFAULT false NOT NULL`,
  `ALTER TABLE "adoptions" ADD COLUMN IF NOT EXISTS "memory_context" text`,
  `ALTER TABLE "adoptions" ADD COLUMN IF NOT EXISTS "anonymous_id" text`,
  `ALTER TABLE "adoptions" ADD COLUMN IF NOT EXISTS "thread_id" uuid REFERENCES "threads"("id")`,
  `ALTER TABLE "threads" ADD COLUMN IF NOT EXISTS "anonymous_id" text`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_creator" boolean DEFAULT false NOT NULL`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_unlocked" boolean DEFAULT false NOT NULL`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "creator_balance" integer DEFAULT 0 NOT NULL`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "points" integer DEFAULT 0 NOT NULL`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_checkin_date" text`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "invite_code" text`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "invited_by" uuid REFERENCES "users"("id")`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "checkin_streak" integer DEFAULT 0 NOT NULL`,
  // 高级公民月卡到期时间（NULL=非会员；到期后自动降级为普通用户）
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "premium_until" timestamp`,
  // 探险商城：金币余额（新用户默认 200）
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "coins" integer DEFAULT 200 NOT NULL`,
  // 裂变奖励状态机：pending=冻结等待活跃验证 / credited=已发放 / expired=超时作废
  `ALTER TABLE "invite_rewards" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'credited' NOT NULL`,
  `ALTER TABLE "invite_rewards" ADD COLUMN IF NOT EXISTS "claimed_at" timestamp`,
  `ALTER TABLE "agent_memories" ADD COLUMN IF NOT EXISTS "important" boolean DEFAULT false NOT NULL`,
  `ALTER TABLE "pets" ADD COLUMN IF NOT EXISTS "last_interaction_time" timestamp`,
  // ===== 站长后台（Admin Dashboard）=====
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role" text DEFAULT 'user' NOT NULL`,
  `ALTER TABLE "pets" ADD COLUMN IF NOT EXISTS "visible" boolean DEFAULT true NOT NULL`,
  // NFR：官方品牌宠物（fox/penguin/dog）不在 pet_dictionary，藏品 species_id 无需 FK
  `ALTER TABLE "digital_collectibles" DROP CONSTRAINT IF EXISTS "digital_collectibles_species_id_fkey"`,
  `ALTER TABLE "hotnews" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'visible' NOT NULL`,
  `ALTER TABLE "hotnews" ADD COLUMN IF NOT EXISTS "pinned" boolean DEFAULT false NOT NULL`,
  // SEO：sitemap lastModified 依赖（DEFAULT now()，现有行自动回填，幂等无需迁移）
  `ALTER TABLE "pet_dictionary" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL`,
  `ALTER TABLE "hotnews" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL`,
  // 国际化：新闻语言列 + 宠物分类双语列（幂等补列）
  `ALTER TABLE "hotnews" ADD COLUMN IF NOT EXISTS "locale" text DEFAULT 'en' NOT NULL`,
  `ALTER TABLE "pet_dictionary" ADD COLUMN IF NOT EXISTS "category_en" text`,
  `ALTER TABLE "pet_dictionary" ADD COLUMN IF NOT EXISTS "habitat_en" text`,
  // 新闻国内/国际标识（80/20 配比 + 前端国旗标签）
  `ALTER TABLE "hotnews" ADD COLUMN IF NOT EXISTS "is_domestic" boolean DEFAULT false NOT NULL`,
  // 盲盒每日福利池标记（限购判定去硬编码）
  `ALTER TABLE "blindbox_pools" ADD COLUMN IF NOT EXISTS "is_daily" boolean DEFAULT false NOT NULL`,
  // 站内阅读：新闻正文（抓取完整正文，纯文本；失败留空 → 详情页走阅读原文）
  `ALTER TABLE "hotnews" ADD COLUMN IF NOT EXISTS "content" text`,
  // 新闻唯一索引改为 (locale, source, title)：同源同题中英各行互不冲突
  `DROP INDEX IF EXISTS idx_hotnews_source_title`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_hotnews_locale_source_title ON "hotnews" ("locale", "source", "title")`,
  // ===== 账号安全（防暴力破解）=====
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "locked_until" timestamp`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_login_at" timestamp`,
  // P1 零摩擦领养：游客认领占位（owner_id 是 uuid FK 存不了游客，用文本列标记设备持有，
  // 登录后由 /api/auth/migrate 归并到 owner_id）
  `ALTER TABLE "pets" ADD COLUMN IF NOT EXISTS "guest_owner" text`,

  // V1 探索遗产列（成就系统 V1 折算口径数据源，保留；current_map_id/map_progress/weather 3 列随 V1 代码删除）
  `ALTER TABLE "adoptions" ADD COLUMN IF NOT EXISTS "exploration_steps" integer DEFAULT 0 NOT NULL`,

  // ===== 隐私改造：username 公开昵称 + 排行榜 opt-out =====
  // 1) 加列（先可空，回填后再 SET NOT NULL，保证旧库平滑迁移）
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "username" text`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "show_in_leaderboard" boolean DEFAULT true NOT NULL`,
  // 2) 存量回填：按 user_0001 格式生成唯一默认昵称（序列保证逐行递増；用户自取昵称禁 user_\d+ 前缀，不会撞车）
  `CREATE SEQUENCE IF NOT EXISTS "users_username_seq" START 1`,
  `UPDATE "users" SET "username" = 'user_' || lpad(nextval('users_username_seq')::text, 4, '0') WHERE "username" IS NULL`,
  // 3) 回填完成后强制非空（若存在并发插入的 NULL 行会失败 → 容错跳过，下次版本提升时重试）
  `ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL`,
];

/**
 * 高频查询索引（幂等，冷启动执行一次）。
 *  - adoptions.user_id：单宠限制 / 宠物列表（WHERE user_id=?）
 *  - adoptions.anonymous_id：游客宠物查询
 *  - threads.user_id：会话列表
 *  - points_log.user_id：积分流水
 */
const SCHEMA_INDEXES: string[] = [
  `CREATE INDEX IF NOT EXISTS idx_adoptions_user_id ON "adoptions" ("user_id")`,
  `CREATE INDEX IF NOT EXISTS idx_adoptions_anonymous_id ON "adoptions" ("anonymous_id")`,
  // NFR 藏品：确权/查询索引
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_dc_species_rarity ON "digital_collectibles" ("species_id", "rarity")`,
  `CREATE INDEX IF NOT EXISTS idx_dc_rarity ON "digital_collectibles" ("rarity")`,
  `CREATE INDEX IF NOT EXISTS idx_uc_owner ON "user_collectibles" ("owner_id", "status")`,
  `CREATE INDEX IF NOT EXISTS idx_uc_collectible ON "user_collectibles" ("collectible_id")`,
  `CREATE INDEX IF NOT EXISTS idx_uc_hash ON "user_collectibles" ("hash_id")`,
  `CREATE INDEX IF NOT EXISTS idx_uc_locked ON "user_collectibles" ("locked_until")`,
  `CREATE INDEX IF NOT EXISTS idx_threads_user_id ON "threads" ("user_id")`,
  `CREATE INDEX IF NOT EXISTS idx_points_log_user_id ON "points_log" ("user_id")`,
  // P0-1 道具背包：按用户查列表 / 装备筛选
  `CREATE INDEX IF NOT EXISTS idx_user_items_user ON "user_items" ("user_id")`,
  // P1 零摩擦领养：游客占有的宠物实例（登录归并 / 图鉴 owned 判定）
  `CREATE INDEX IF NOT EXISTS idx_pets_guest_owner ON "pets" ("guest_owner")`,
  // P2 Web Push 召回：按用户/设备查订阅
  `CREATE INDEX IF NOT EXISTS idx_push_sub_user ON "push_subscriptions" ("user_id")`,
  `CREATE INDEX IF NOT EXISTS idx_push_sub_anon ON "push_subscriptions" ("anonymous_id")`,
  // 数字人记忆：清理低频记忆（last_accessed 超过 30 天）按索引扫描，避免全表扫
  `CREATE INDEX IF NOT EXISTS idx_agent_memories_last_accessed ON "agent_memories" ("last_accessed")`,
  // 裂变邀请：邀请码唯一（并发注册防重）
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_invite_code ON "users" ("invite_code")`,
  // 裂变防刷：同 IP / 同设备指纹最多一次奖励
  `CREATE INDEX IF NOT EXISTS idx_invite_rewards_ip ON "invite_rewards" ("ip")`,
  `CREATE INDEX IF NOT EXISTS idx_invite_rewards_device ON "invite_rewards" ("device_id")`,
  // 裂变防刷：24h 窗口内同 IP/设备 最多 3 次（含时间列复合索引）
  `CREATE INDEX IF NOT EXISTS idx_invite_rewards_ip_time ON "invite_rewards" ("ip", "created_at")`,
  `CREATE INDEX IF NOT EXISTS idx_invite_rewards_status ON "invite_rewards" ("status", "invited_user_id")`,
  // 排行榜：战力分查询（代数降序）
  `CREATE INDEX IF NOT EXISTS idx_uc_power ON "user_collectibles" ("generation" DESC, "collectible_id")`,
  // 宠物图鉴：traits JSONB 按元素筛选（GIN 索引，毫秒级）
  `CREATE INDEX IF NOT EXISTS idx_pets_traits_gin ON "pets" USING gin ("traits")`,
  // 合成分配：owner_id IS NULL 的池子查询 + “我的宠物”列表
  `CREATE INDEX IF NOT EXISTS idx_pets_owner_id ON "pets" ("owner_id")`,
  // 宠物字典分类浏览（按物种查看）
  `CREATE INDEX IF NOT EXISTS idx_pets_species_id ON "pets" ("species_id")`,
  // 损失厌恶：批量查找“超过 N 天未互动”的宠物（状态反馈）
  `CREATE INDEX IF NOT EXISTS idx_pets_last_interaction ON "pets" ("last_interaction_time")`,
  // 宠物旅行日记 · 明信片按用户时间倒序
  `CREATE INDEX IF NOT EXISTS "idx_user_postcards_user" ON "user_postcards" ("user_id", "created_at" DESC)`,
  // 宠物旅行日记 · 商城订单按用户时间倒序（"我的订单"查询）
  `CREATE INDEX IF NOT EXISTS "idx_user_orders_user" ON "user_orders" ("user_id", "created_at" DESC)`,
  // 宠物旅行日记 · 聊天额度按用户+日期索引
  `CREATE INDEX IF NOT EXISTS "idx_chat_quotas_user_date" ON "chat_quotas" ("user_id", "date")`,
  // 宠物旅行日记 · 聊天额度唯一约束：/api/chat 计数 UPSERT 的 ON CONFLICT (user_id, date)
  // 依赖唯一索引，否则每次计数都报 42P10「no unique constraint」导致每日额度永不累计
  `CREATE UNIQUE INDEX IF NOT EXISTS "uq_chat_quotas_user_date" ON "chat_quotas" ("user_id", "date")`,
  // 宠物旅行日记 · 订阅按用户索引
  `CREATE INDEX IF NOT EXISTS "idx_user_subscriptions_user" ON "user_subscriptions" ("user_id")`,
  // 宠物旅行日记 · 订阅到期日索引（清理过期订阅）
  `CREATE INDEX IF NOT EXISTS "idx_user_subscriptions_expires" ON "user_subscriptions" ("expires_at")`,
  // 宠物旅行日记 · 宠物长期记忆库索引（drizzle/0019_pet_memories.sql）
  `CREATE INDEX IF NOT EXISTS "idx_pet_memories_user"      ON "pet_memories" ("user_id")`,
  `CREATE INDEX IF NOT EXISTS "idx_pet_memories_user_pet"  ON "pet_memories" ("user_id", "pet_id")`,
  `CREATE INDEX IF NOT EXISTS "idx_pet_memories_user_type" ON "pet_memories" ("user_id", "memory_type")`,
  // 探索 v2 · 探索记录索引（drizzle/0020_exploration_v2.sql）
  `CREATE INDEX IF NOT EXISTS "idx_exploration_records_user"      ON "exploration_records" ("user_id")`,
  `CREATE INDEX IF NOT EXISTS "idx_exploration_records_user_time" ON "exploration_records" ("user_id", "created_at" DESC)`,
  // 探索 v2 · 事件库索引（按 type / rarity 过滤）
  `CREATE INDEX IF NOT EXISTS "idx_exploration_events_type"   ON "exploration_events" ("event_type")`,
  `CREATE INDEX IF NOT EXISTS "idx_exploration_events_rarity" ON "exploration_events" ("rarity")`,
  // 探索成就 · 按用户查询徽章列表（drizzle/0021_achievements.sql）
  `CREATE INDEX IF NOT EXISTS "idx_achievements_user" ON "achievements" ("user_id")`,
  // 隐私改造：昵称唯一（登录双通道按 username 匹配 / 注册与改名防重）
  `CREATE UNIQUE INDEX IF NOT EXISTS "users_username_key" ON "users" ("username")`,
  // UGC 内容创作工坊索引（drizzle/0023_ugc_workshop.sql）
  `CREATE INDEX IF NOT EXISTS "idx_ugc_creations_user" ON "ugc_creations" ("user_id", "created_at" DESC)`,
  `CREATE INDEX IF NOT EXISTS "idx_ugc_creations_type" ON "ugc_creations" ("user_id", "type", "created_at" DESC)`,
  `CREATE INDEX IF NOT EXISTS "idx_ugc_submissions_campaign" ON "ugc_submissions" ("campaign_id", "created_at" DESC)`,
  `CREATE INDEX IF NOT EXISTS "idx_ugc_submissions_user" ON "ugc_submissions" ("user_id", "created_at" DESC)`,
];

let schemaReadyPromise: Promise<void> | null = null;

/** 幂等建索引；并发冷启动时多实例同名索引会触发 pg_class 重复名竞态，逐个容错即可。 */
async function runIndexes(client: { query: (sql: string) => Promise<unknown> }) {
  for (const idx of SCHEMA_INDEXES) {
    try {
      await client.query(idx);
    } catch {
      // 索引幂等：其他实例已建成时本实例会拿到 duplicate name 错误，忽略即可。
      console.log("[db] index already present by another instance:", idx.slice(0, 70));
    }
  }
}

/** 幂等补列（ALTER ... ADD COLUMN IF NOT EXISTS）；并发/已存在时容错。 */
async function runAlters(client: { query: (sql: string) => Promise<unknown> }) {
  for (const stmt of SCHEMA_ALTERS) {
    try {
      await client.query(stmt);
    } catch (err) {
      // 列已存在 / 短暂锁冲突时忽略（DDL 幂等）
      console.log("[db] alter skipped:", stmt.slice(0, 60), String(err).slice(0, 120));
    }
  }
}

// ============================================================================
// Schema 版本闸门（性能关键）
//
// 背景事故：旧版“快速路径”名义上跳过 DDL，实际仍在每个 Serverless 冷启动
// 串行执行全部 CREATE/ALTER/INDEX/种子 INSERT（60+ 次数据库往返）；并发冷启动
// 的实例互相争抢表锁，普通业务查询被堵在 DDL 锁队列里，表现为全站 45s+ 无响应。
//
// 现在改为版本闸门：版本一致 ⇒ 冷启动仅 1 次轻量查询即返回；
// 仅当 SCHEMA_VERSION 提升（修改了 DDL 或种子数据）后，由单个实例经
// 「原子认领」执行一次全量同步，其它实例有界等待，彻底避免 DDL 并发风暴。
// （不用 pg advisory lock：Neon pooler 事务模式不支持会话级锁，改用 meta 表
//   原子 UPDATE 认领，崩溃后可凭 10 分钟陈旧标记自动恢复。）
//
// ⚠️ 维护规则：凡修改 SCHEMA_CREATES / SCHEMA_ALTERS / SCHEMA_INDEXES
//    （含种子数据），必须将 SCHEMA_VERSION +1，否则生产库不会应用变更。
// ============================================================================
// v2: 新增 achievements 表（drizzle/0021，探索成就系统）
// v3: 新增垂耳兔/玄凤鹦鹉百科 + evt-041~060 探索事件种子（roadmap 任务一）
// v4: 隐私改造 —— users.username 公开昵称（user_0001 回填+唯一索引）+ show_in_leaderboard 排行榜 opt-out（drizzle/0022）
// v5: UGC 内容创作工坊 —— ugc_creations（P0 写真/日记卡片）+ ugc_campaigns/ugc_submissions（P1 预留）（drizzle/0023）
const SCHEMA_VERSION = 5;

const META_TABLE_DDL = `CREATE TABLE IF NOT EXISTS "_schema_meta" (
  "id" integer PRIMARY KEY,
  "version" integer NOT NULL,
  "applied_at" timestamp DEFAULT now() NOT NULL
)`;

/** 读取已应用的 schema 版本；meta 表不存在等异常按 0 处理（将触发一次全量同步）。 */
async function readSchemaVersion(client: {
  query: (sql: string) => Promise<{ rows: Array<{ version: number }> }>;
}): Promise<number> {
  try {
    const r = await client.query(
      `SELECT "version" FROM "_schema_meta" WHERE "id" = 1`,
    );
    return Number(r.rows[0]?.version ?? 0);
  } catch {
    return 0;
  }
}

/** 全量同步：建表 + 补列 + 补索引（幂等；由版本闸门保证仅低频执行）。 */
async function runFullSchemaSync(client: {
  query: (sql: string) => Promise<unknown>;
}) {
  for (const statement of SCHEMA_CREATES) {
    await client.query(statement);
  }
  await runAlters(client);
  await runIndexes(client);
}

/**
 * 幂等建表：全局只执行一次（失败会记录日志但不抛出，避免阻断业务请求重试）。
 * 调用方 await 它即可保证“执行本次查询前表结构已就绪”。
 *
 * 性能：版本闸门快速路径 —— 冷启动仅 1 次版本查询（~1 RTT），
 * 不再重复执行整套 DDL；全量同步仅由抢到认领的单个实例执行一次。
 */
export function ensureDbSchemaOnce(): Promise<void> {
  schemaReadyPromise ??= (async () => {
    const client = await pool.connect();
    try {
      // 快速路径（每次冷启动仅 1 次轻量查询）：版本已达标 → 直接返回
      if ((await readSchemaVersion(client)) >= SCHEMA_VERSION) return;

      // 慢速路径（仅 SCHEMA_VERSION 提升后执行一次）：建 meta 表 → 原子认领 → 全量同步
      await client.query(META_TABLE_DDL);
      const claimed = await client.query(
        `INSERT INTO "_schema_meta" ("id", "version", "applied_at")
         VALUES (1, -1, now())
         ON CONFLICT ("id") DO UPDATE
           SET "version" = -1, "applied_at" = now()
         WHERE ("_schema_meta"."version" >= 0 AND "_schema_meta"."version" < $1)
            OR ("_schema_meta"."version" < 0 AND "_schema_meta"."applied_at" < now() - interval '10 minutes')
         RETURNING "id"`,
        [SCHEMA_VERSION],
      );
      if ((claimed.rowCount ?? 0) > 0) {
        try {
          await runFullSchemaSync(client);
          await client.query(
            `UPDATE "_schema_meta" SET "version" = $1, "applied_at" = now() WHERE "id" = 1`,
            [SCHEMA_VERSION],
          );
          console.log("[db] schema synced to version", SCHEMA_VERSION);
        } catch (err) {
          // 同步中途失败：复位为未同步标记，让后续冷启动立即重试
          await client
            .query(`UPDATE "_schema_meta" SET "version" = 0 WHERE "id" = 1`)
            .catch(() => {});
          throw err;
        }
        return;
      }

      // 其它实例正在全量同步：有界轮询等待其完成（仅发生在版本切换窗口）。
      // 注意 schemaReadyPromise 是实例级单例，同一实例无论多少请求也只跑一个轮询。
      for (let i = 0; i < 30; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if ((await readSchemaVersion(client)) >= SCHEMA_VERSION) return;
      }
      console.warn("[db] schema sync by another instance timed out; proceeding");
    } finally {
      client.release();
    }
  })().catch((err) => {
    console.error('[db] auto schema sync failed:', err);
  });
  return schemaReadyPromise;
}

// 冷启动即触发一次自动建表（幂等，不影响后续请求）。
void ensureDbSchemaOnce();

