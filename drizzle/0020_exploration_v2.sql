-- 宠物旅行日记 v2 · 探索+养成+知识系统（与聊天驱动步数系统并行）
-- 设计原则：
--   1) animal_wiki：动物知识百科（每个物种一行，traits/fun_facts 存 JSON 字符串）。
--   2) exploration_events：探索事件库（5 类 postcard/gift/knowledge/encounter/rest），
--      应用层按 weight 抽取；id 用 TEXT 方便读。
--   3) exploration_records：每次探索落库（用户×事件×步数×距离×稀有）。
--   4) 仅新增表，不动现有 adoptions / pet_memories / map_events 等。
--   5) 全部 IF NOT EXISTS 幂等（与 0016/0018/0019 风格一致）。
--
-- 后续扩展：新增宠物只需在 animal_wiki 加一行 + 在 exploration_events 加 pet_category 事件，
--          不需要改代码（数据驱动）。

-- 1) animal_wiki · 动物知识百科
CREATE TABLE IF NOT EXISTS "animal_wiki" (
  "id"                    text PRIMARY KEY,
  "species"               text NOT NULL,
  "category"              text NOT NULL,
  "origin"                text,
  "lifespan"              text,
  "weight"                text,
  "traits"                text NOT NULL DEFAULT '[]',
  "fun_facts"             text NOT NULL DEFAULT '[]',
  "habitat"               text,
  "diet"                  text,
  "conservation_status"   text,
  "image_url"             text,
  "created_at"            timestamp DEFAULT now() NOT NULL
);

-- 2) exploration_events · 探索事件库（按权重随机抽取）
CREATE TABLE IF NOT EXISTS "exploration_events" (
  "id"                  text PRIMARY KEY,
  "pet_category"        text,
  "event_type"          text NOT NULL,
  "title"               text NOT NULL,
  "description"         text NOT NULL,
  "image_emoji"         text,
  "rarity"              text NOT NULL DEFAULT 'common',
  "weight"              integer NOT NULL DEFAULT 10,
  "required_equipment"  text,
  "knowledge_link"      text,
  "created_at"          timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "exploration_events_type_chk" CHECK ("event_type" IN ('postcard','gift','knowledge','encounter','rest')),
  CONSTRAINT "exploration_events_rarity_chk" CHECK ("rarity" IN ('common','rare','epic'))
);

-- 3) exploration_records · 探索记录（每次探索一行）
CREATE TABLE IF NOT EXISTS "exploration_records" (
  "id"               text PRIMARY KEY,
  "user_id"          uuid NOT NULL REFERENCES "users"("id"),
  "pet_id"           text,
  "event_id"         text REFERENCES "exploration_events"("id"),
  "result_type"      text NOT NULL,
  "result_data"      text,
  "steps_gained"     integer NOT NULL DEFAULT 0,
  "distance_gained"  numeric(10,2) NOT NULL DEFAULT 0,
  "is_rare"          boolean NOT NULL DEFAULT false,
  "created_at"       timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "exploration_records_type_chk" CHECK ("result_type" IN ('postcard','gift','knowledge','encounter','rest'))
);

-- 4) 索引：按用户、按用户+时间倒序、事件库按 type / rarity 过滤
CREATE INDEX IF NOT EXISTS "idx_exploration_records_user"      ON "exploration_records" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_exploration_records_user_time" ON "exploration_records" ("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_exploration_events_type"       ON "exploration_events" ("event_type");
CREATE INDEX IF NOT EXISTS "idx_exploration_events_rarity"     ON "exploration_events" ("rarity");

-- ════════════════════════════════════════════════════════════════════════
-- 5) 种子数据 · 动物知识百科（波斯猫真实知识）
-- ════════════════════════════════════════════════════════════════════════
INSERT INTO "animal_wiki" (
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
) ON CONFLICT ("id") DO NOTHING;
-- ======================================================================
-- 6) 种子数据 · 探索事件库（20+ 条，覆盖 5 种类型 postcard/gift/knowledge/encounter/rest）
-- ======================================================================
INSERT INTO "exploration_events" ("id","pet_category","event_type","title","description","image_emoji","rarity","weight","knowledge_link") VALUES
-- postcard（明信片类）
('evt-001','cat','postcard','森林里的蝴蝶','今天在森林里发现了一只美丽的蓝色蝴蝶，它停在了一朵小花上，我看了好久～','🦋','common',30,NULL),
('evt-002','cat','postcard','山顶的日落','我爬到了一座小山顶，看到了好漂亮的橙色日落！要是你也在就好了～','🌅','rare',10,NULL),
('evt-003','cat','postcard','遇到了一只小松鼠','树林里有只松鼠掉了一颗松果，我好奇地凑过去闻了闻，它就跑掉了～','🐿','common',25,NULL),
('evt-004','cat','postcard','下雨天躲屋檐','突然下起了小雨，我躲在一个小木屋的屋檐下，看着雨滴发呆～','🌧️','common',20,NULL),
('evt-005','cat','postcard','星空下的草地','今晚的星星好多好亮，我躺在草地上数星星，数到第47颗就睡着了…','✨','rare',8,NULL),
-- gift（礼物类）
('evt-006','cat','gift','带回了小鱼干','路边捡到一条小鱼干！应该是谁掉的吧…反正我带回来给你啦～','🐟','common',25,NULL),
('evt-007','cat','gift','捡到四叶草','草从里发现了一片四叶草！听说会带来好运哦～','🍀','rare',10,NULL),
('evt-008','cat','gift','好看的鹅卵石','河边有一块特别光滑的石头，条纹好好看，我叼回来送你～','🪨','common',20,NULL),
('evt-009','cat','gift','一朵小野花','路边的小野花，粉粉色的，夹在信里寄给你💌','🌸','common',20,NULL),
('evt-010','cat','gift','神秘的小盒子','在树洞里发现了一个旧盒子，不知道里面有什么…你要不要打开看看？','🎁','epic',3,NULL),
-- knowledge（知识类）
('evt-011','cat','knowledge','你知道吗？','波斯猫的祖先来自古波斯（今天的伊朗），它们在17世纪才被带到欧洲～','📖','common',15,'persian-cat'),
('evt-012','cat','knowledge','小科普','我的长毛每天都需要梳理，不然会打结哦！所以主人要勤快一点～','📚','common',15,'persian-cat'),
('evt-013','cat','knowledge','有趣的事实','波斯猫在1871年伦敦的第一届猫展上首次亮相，当时就大受欢迎！','✨','rare',8,'persian-cat'),
-- encounter（偶遇类）
('evt-014','cat','encounter','遇到流浪猫朋友','遇到了一只橙色的流浪猫，它好胖啊，我怀疑它每天都在偷吃人类的食物…','🐱','common',15,NULL),
('evt-015','cat','encounter','被狗追了','一只大金毛突然跑过来想跟我玩，我吓得赶紧爬到树上…它不会爬树，哈哈～','🐕','common',12,NULL),
('evt-016','cat','encounter','遇到老爷爷喂食','公园里的老爷爷看到我就拿猫粮喂我，他好温柔，我蹏了蹏他的手～','👴','common',15,NULL),
-- rest（休息类）
('evt-017','cat','rest','在阳光下午睡','找到一个和暖的窗台，晒着太阳睡着了，梦到了好多小鱼干…','💤','common',20,NULL),
('evt-018','cat','rest','在纸箱里发呆','发现了一个快递纸箱，钻进去刚刚好！纸箱真是世界上最好的发明～','📦','common',18,NULL),
('evt-019','cat','rest','舔毛时间','坐在阳台上认认真真舔了一个小时的毛，现在我是世界上最干净的猫了！','✨','common',15,NULL),
('evt-020','cat','rest','看窗外的鸟','窗台上停了一只小鸟，我盯着它看了好久，它盯着我看了一会儿就飞走了…','🐦','common',15,NULL)
ON CONFLICT ("id") DO NOTHING;
