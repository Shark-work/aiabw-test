// Seed the pet_dictionary with real animal species (Step 1 of the pet-system architecture).
// Idempotent: creates tables if missing, then UPSERTs the dictionary rows.
// Usage: node scripts/seed-pet-dictionary.cjs
const { Pool } = require("@neondatabase/serverless");
const fs = require("fs");
const path = require("path");

const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
const url = (env.match(/^DATABASE_URL=(.*)$/m) || [])[1]?.trim();
const pool = new Pool({ connectionString: url });

// 幂等 DDL（与 src/db/client.ts ensureDbSchemaOnce 一致，脚本独立可跑）
const DDL = [
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
    "adopted_at" timestamp
  )`,
  `CREATE INDEX IF NOT EXISTS idx_pets_traits_gin ON "pets" USING gin ("traits")`,
  `CREATE INDEX IF NOT EXISTS idx_pets_owner_id ON "pets" ("owner_id")`,
  `CREATE INDEX IF NOT EXISTS idx_pets_species_id ON "pets" ("species_id")`,
];

// 26 个现实物种；{trait} 为默认介绍模板占位符（用宠物 traits 中的特质词替换）
const SPECIES = [
  // 犬科
  { id: "golden_retriever", zh: "金毛", en: "Golden Retriever", cat: "犬科", habitat: "庄园",
    dz: "这是一只{trait}的金毛，永远摇着尾巴等你回家。",
    de: "A {trait} Golden Retriever, always wagging its tail, waiting for you at home." },
  { id: "husky", zh: "哈士奇", en: "Siberian Husky", cat: "犬科", habitat: "雪原",
    dz: "这是一只{trait}的哈士奇，雪地里撒欢是它的天性。",
    de: "A {trait} Siberian Husky, frolicking through the snow is its nature." },
  { id: "border_collie", zh: "边牧", en: "Border Collie", cat: "犬科", habitat: "牧场",
    dz: "这是一只{trait}的边牧，牧场上的每一只羊都归它管。",
    de: "A {trait} Border Collie - every sheep on the ranch is under its watch." },
  { id: "corgi", zh: "柯基", en: "Corgi", cat: "犬科", habitat: "小镇",
    dz: "这是一只{trait}的柯基，小短腿跑起来像一团快乐的火苗。",
    de: "A {trait} Corgi, its little stubby legs running like a happy flame." },
  // 猫科
  { id: "maine_coon", zh: "缅因猫", en: "Maine Coon", cat: "猫科", habitat: "森林",
    dz: "这是一只{trait}的缅因猫，蓬松的鬃毛像林间的小狮子。",
    de: "A {trait} Maine Coon, its fluffy mane like a little lion of the woods." },
  { id: "persian", zh: "波斯猫", en: "Persian Cat", cat: "猫科", habitat: "暖阁",
    dz: "这是一只{trait}的波斯猫，优雅地卧在窗边晒太阳。",
    de: "A {trait} Persian cat, lounging gracefully by the sunny window." },
  { id: "snow_leopard", zh: "雪豹", en: "Snow Leopard", cat: "猫科", habitat: "高山",
    dz: "这是一只来自高山的{trait}雪豹，眼神中透着不羁。",
    de: "A {trait} snow leopard from the high mountains, its eyes full of defiance." },
  { id: "lion", zh: "狮子", en: "Lion", cat: "猫科", habitat: "草原",
    dz: "这是一只{trait}的狮子，草原之王的名号名不虚传。",
    de: "A {trait} lion - the king of the savanna, true to its name." },
  { id: "tiger", zh: "老虎", en: "Tiger", cat: "猫科", habitat: "密林",
    dz: "这是一只{trait}的老虎，斑纹在密林里若隐若现。",
    de: "A {trait} tiger, its stripes flickering through the dense jungle." },
  { id: "cheetah", zh: "猎豹", en: "Cheetah", cat: "猫科", habitat: "荒野",
    dz: "这是一只{trait}的猎豹，是风也追不上的速度。",
    de: "A {trait} cheetah - the speed that even the wind cannot catch." },
  // 海洋生物
  { id: "blue_whale", zh: "蓝鲸", en: "Blue Whale", cat: "海洋生物", habitat: "深蓝海域",
    dz: "这是一头在深蓝海域游弋的{trait}蓝鲸，歌声低沉悠长。",
    de: "A {trait} blue whale cruising the deep blue sea, its song low and long." },
  { id: "dolphin", zh: "海豚", en: "Dolphin", cat: "海洋生物", habitat: "温暖洋流",
    dz: "这是一只{trait}的海豚，跃出水面时带着一串彩虹。",
    de: "A {trait} dolphin, leaping out of the water trailing a rainbow." },
  { id: "octopus", zh: "章鱼", en: "Octopus", cat: "海洋生物", habitat: "珊瑚礁",
    dz: "这是一只{trait}的章鱼，八只触手藏着无数小聪明。",
    de: "A {trait} octopus, its eight arms hiding countless clever tricks." },
  { id: "sea_otter", zh: "海獭", en: "Sea Otter", cat: "海洋生物", habitat: "海藻林",
    dz: "这是一只{trait}的海獭，仰面漂浮时是最会享受生活的小家伙。",
    de: "A {trait} sea otter, floating on its back - the most easygoing little one." },
  { id: "clownfish", zh: "小丑鱼", en: "Clownfish", cat: "海洋生物", habitat: "珊瑚海葵",
    dz: "这是一条{trait}的小丑鱼，在海葵里安了家。",
    de: "A {trait} clownfish, cozying up inside its sea anemone home." },
  // 鸟类
  { id: "bald_eagle", zh: "白头海雕", en: "Bald Eagle", cat: "鸟类", habitat: "峭壁",
    dz: "这是一只{trait}的白头海雕，展开双翼掠过峡谷。",
    de: "A {trait} bald eagle, soaring across the canyon on outstretched wings." },
  { id: "owl", zh: "猫头鹰", en: "Owl", cat: "鸟类", habitat: "古树",
    dz: "这是一只{trait}的猫头鹰，夜里替森林守夜。",
    de: "A {trait} owl, keeping watch over the forest at night." },
  { id: "penguin", zh: "企鹅", en: "Penguin", cat: "鸟类", habitat: "南极",
    dz: "这是一只来自南极的{trait}企鹅，摇摇摆摆却从不迷路。",
    de: "A {trait} penguin from Antarctica, waddling yet never lost." },
  { id: "parrot", zh: "鹦鹉", en: "Parrot", cat: "鸟类", habitat: "热带雨林",
    dz: "这是一只{trait}的鹦鹉，学起话来比谁都快。",
    de: "A {trait} parrot, faster at mimicking speech than anyone." },
  // 大型哺乳动物
  { id: "panda", zh: "大熊猫", en: "Giant Panda", cat: "大型哺乳动物", habitat: "竹林",
    dz: "这是一只{trait}的大熊猫，抱着竹子的样子让人心都化了。",
    de: "A {trait} giant panda, hugging bamboo in a way that melts your heart." },
  { id: "elephant", zh: "亚洲象", en: "Asian Elephant", cat: "大型哺乳动物", habitat: "丛林",
    dz: "这是一头{trait}的亚洲象，沉稳的脚步带着森林的智慧。",
    de: "A {trait} Asian elephant, its steady steps carrying the wisdom of the forest." },
  { id: "red_panda", zh: "小熊猫", en: "Red Panda", cat: "大型哺乳动物", habitat: "竹林",
    dz: "这是一只{trait}的小熊猫，尾巴上的环纹像一圈圈小月亮。",
    de: "A {trait} red panda, the rings on its tail like little moons." },
  // 爬行动物
  { id: "tortoise", zh: "陆龟", en: "Tortoise", cat: "爬行动物", habitat: "荒漠绿洲",
    dz: "这是一只{trait}的陆龟，慢悠悠却比谁都长寿。",
    de: "A {trait} tortoise - slow but outliving them all." },
  { id: "chameleon", zh: "变色龙", en: "Chameleon", cat: "爬行动物", habitat: "雨林枝头",
    dz: "这是一只{trait}的变色龙，心情都写在颜色里。",
    de: "A {trait} chameleon, its mood written all over its colors." },
  // 小型哺乳动物
  { id: "squirrel", zh: "松鼠", en: "Squirrel", cat: "小型哺乳动物", habitat: "松林",
    dz: "这是一只{trait}的松鼠，腮帮子里藏着过冬的宝藏。",
    de: "A {trait} squirrel, its cheeks stuffed with winter treasure." },
  { id: "hedgehog", zh: "刺猬", en: "Hedgehog", cat: "小型哺乳动物", habitat: "花园",
    dz: "这是一只{trait}的刺猬，扎人的外表下藏着一颗软软的心。",
    de: "A {trait} hedgehog - prickly on the outside, soft at heart." },
];

async function main() {
  for (const ddl of DDL) {
    try { await pool.query(ddl); } catch (e) { console.log("DDL skipped: " + e.message.slice(0, 80)); }
  }
  console.log("tables ensured. seeding " + SPECIES.length + " species...");
  let changed = 0;
  for (const s of SPECIES) {
    const { rowCount } = await pool.query(
      `INSERT INTO pet_dictionary (id, name_zh, name_en, category, habitat, default_description_zh, default_description_en)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE
         SET name_zh=EXCLUDED.name_zh, name_en=EXCLUDED.name_en, category=EXCLUDED.category,
             habitat=EXCLUDED.habitat, default_description_zh=EXCLUDED.default_description_zh,
             default_description_en=EXCLUDED.default_description_en`,
      [s.id, s.zh, s.en, s.cat, s.habitat, s.dz, s.de],
    );
    changed += rowCount;
  }
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM pet_dictionary`);
  console.log(`done. pet_dictionary rows=${rows[0].n} (inserted/updated=${changed})`);
  await pool.end();
}

main().catch((e) => { console.error("FATAL: " + e.message); process.exit(2); });
