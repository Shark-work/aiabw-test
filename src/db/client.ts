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

  // 宠物旅行日记：探索事件库（应用层按 map_id 抽取，不在 DB 端做随机）
  `CREATE TABLE IF NOT EXISTS "map_events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "map_id" integer NOT NULL,
    "event_type" text NOT NULL,
    "title_zh" text NOT NULL,
    "title_en" text NOT NULL,
    "description_zh" text NOT NULL,
    "description_en" text NOT NULL,
    "reward_item_key" text,
    "probability" double precision DEFAULT 0.6 NOT NULL,
    "weather_bias" text,
    "created_at" timestamp DEFAULT now() NOT NULL
  )`,

  // 宠物旅行日记：旅行明信片（完成地图后生成）
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

  // 宠物旅行日记 · adoptions 扩展（聊天驱动挂机探索核心）
  `ALTER TABLE "adoptions" ADD COLUMN IF NOT EXISTS "exploration_steps" integer DEFAULT 0 NOT NULL`,
  `ALTER TABLE "adoptions" ADD COLUMN IF NOT EXISTS "current_map_id" integer DEFAULT 1 NOT NULL`,
  `ALTER TABLE "adoptions" ADD COLUMN IF NOT EXISTS "map_progress" integer DEFAULT 0 NOT NULL`,
  `ALTER TABLE "adoptions" ADD COLUMN IF NOT EXISTS "weather" text DEFAULT 'sunny' NOT NULL`,
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
  // 宠物旅行日记 · 事件库按地图 id 抽取
  `CREATE INDEX IF NOT EXISTS "idx_map_events_map_id" ON "map_events" ("map_id")`,
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

/**
 * 幂等建表：全局只执行一次（失败会记录日志但不抛出，避免阻断业务请求重试）。
 * 调用方 await 它即可保证“执行本次查询前表结构已就绪”。
 *
 * 性能优化：先用一条 to_regclass 查询确认核心表已存在——
 * 存在则直接跳过整套 DDL，避免每次 Serverless 冷启动都跑 17 条建表语句。
 */
export function ensureDbSchemaOnce(): Promise<void> {
  schemaReadyPromise ??= (async () => {
    const client = await pool.connect();
    try {
      // 快速路径：核心表存在则跳过 DDL
      const exists = await client.query(
        `SELECT to_regclass('public.users') AS u,
                to_regclass('public.adoptions') AS a,
                to_regclass('public.threads') AS t`,
      );
      const row = exists.rows[0] ?? {};
      if (row.u && row.a && row.t) {
        // 快速路径：核心表已存在 → 仍需幂等执行 CREATE TABLE IF NOT EXISTS
        // （否则后续新增的表——如 agent_memories——永远不会被创建到已存在的生产库）
        // + 幂等补列（ALTER）+ 补索引。
        for (const statement of SCHEMA_CREATES) {
          await client.query(statement);
        }
        await runAlters(client);
        await runIndexes(client);
        console.log("[db] schema present: tables ensured (create-if-not-exists + alters + indexes)");
        return;
      }
      for (const statement of SCHEMA_CREATES) {
        await client.query(statement);
      }
      await runAlters(client);
      await runIndexes(client);
      console.log("[db] schema ensured (tables are ready)");
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

