// 临时：把中文种子池（SEED_NEWS 15 条）幂等写入 hotnews（locale=zh, is_domestic=true）
const fs = require("fs");
const path = require("path");
const { Pool } = require("@neondatabase/serverless");
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
const url = (env.match(/^DATABASE_URL=(.*)$/m) || [])[1]?.trim();
const pool = new Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 8000 });

const SEED = [
  ["全球首只成功佩戴卫星项圈的野生大熊猫，追踪数据突破 1 万公里", "https://www.aiabw.com/pets?species=giant_panda"],
  ["北京志愿者组建流浪猫救助站，一个月帮 200 只流浪猫找到新家", "https://www.aiabw.com/pets?species=persian"],
  ["上海野生动物园大熊猫双胞胎满月，线上征名活动火爆", "https://www.aiabw.com/pets?species=giant_panda"],
  ["云南亚洲象群持续北上迁徙，沿途村民自发投喂菠萝香蕉", "https://www.aiabw.com/pets?species=elephant"],
  ["英国一所猫咖的橘猫凭借“营业 12 年”获得社区终身荣誉居民", "https://www.aiabw.com/pets?species=maine_coon"],
  ["科学家发现座头鲸会“教学”：幼鲸跟随母亲学习捕食技巧", "https://www.aiabw.com/pets?species=whale"],
  ["成都大熊猫繁育基地迎来今年第 20 只新生熊猫宝宝", "https://www.aiabw.com/pets?species=giant_panda"],
  ["澳大利亚考拉救护中心救助 300 只山火幸存考拉，创下纪录", "https://www.aiabw.com/pets?species=koala"],
  ["《疯狂动物城2》官宣定档，树懒闪电回归引爆全网期待", "https://www.aiabw.com/pets?species=sloth"],
  ["《狮子王：木法沙传奇》发布新预告，草原生命故事延续", "https://www.aiabw.com/pets?species=lion"],
  ["《动物森友会》更新海洋主题 DLC，玩家连夜钓鱼“上瘾”", "https://www.aiabw.com/pets?species=octopus"],
  ["国产动画《熊出没》大电影再破纪录，光头强携新伙伴回归", "https://www.aiabw.com/pets?species=brown_bear"],
  ["动物冷知识：章鱼有三颗心脏、血液呈蓝色", "https://www.aiabw.com/pets?species=octopus"],
  ["为什么猫总爱把桌上的东西推下去？科学家给出解释", "https://www.aiabw.com/pets?species=persian"],
  ["企鹅的“膝盖”藏在身体里，摇摇晃晃走路其实是为省力", "https://www.aiabw.com/pets?species=penguin"],
];
(async () => {
  let inserted = 0;
  for (let i = 0; i < SEED.length; i++) {
    const [title, url] = SEED[i];
    const ts = Date.now() - (i + 1) * 3 * 3600000;
    const res = await pool.query(
      `INSERT INTO hotnews (source, title, "desc", cover, hot, timestamp, url, locale, is_domestic)
       VALUES ($1, $2, $3, NULL, $4, $5, $6, 'zh', true)
       ON CONFLICT (locale, source, title) DO NOTHING`,
      ["Seed · 动物头条", title, "", 1200 - i * 60, ts, url],
    );
    if (res.rowCount > 0) inserted++;
  }
  const r = await pool.query("SELECT count(*)::int AS n FROM hotnews WHERE locale='zh' AND is_domestic=true");
  console.log(`种子写入 ${inserted} 条 | zh 国内总数=${r.rows[0].n}`);
  await pool.end();
})().catch((e) => { console.error("FATAL:", e.message); process.exit(2); });
