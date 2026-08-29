// 新闻批量翻译（英文 → 中文，写入 hotnews.locale='zh'）
// 用法: node scripts/translate-news.mjs
// 依赖: BAILIAN_API_KEY（阿里云百炼 / OpenAI 兼容）
import fs from "node:fs";
import { Pool } from "@neondatabase/serverless";

const env = fs.readFileSync(new URL("../.env", import.meta.url), "utf8");
const DATABASE_URL = (env.match(/^DATABASE_URL=(.*)$/m) || [])[1]?.trim();
const BAILIAN_API_KEY = (env.match(/^BAILIAN_API_KEY=(.*)$/m) || [])[1]?.trim();
const pool = new Pool({ connectionString: DATABASE_URL, max: 2, connectionTimeoutMillis: 8000 });

/** 专有名词保护：以下词条禁止翻译，必须保留原文。 */
const PROTECTED_TERMS = ["PETA", "WWF", "Giant Panda", "Snow Leopard", "National Geographic"];

const BATCH = 5;
const MODEL = process.env.BAILIAN_MODEL ?? "qwen-turbo";

async function translateBatch(items) {
  const system = `你是专业的新闻翻译。把以下英文新闻标题(title)和摘要(desc)翻译为简体中文。
硬性要求：
1. 以下专有名词必须保留原文，禁止翻译：${PROTECTED_TERMS.join(", ")}
2. 标题翻译自然通顺、信息完整；摘要同样通顺。
3. 严格输出 JSON 数组，每个元素：{"id": 数字, "title": "中文标题", "desc": "中文摘要"}，不要输出其他内容。`;
  const resp = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${BAILIAN_API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(items) },
      ],
      temperature: 0.3,
    }),
  });
  if (!resp.ok) throw new Error("HTTP " + resp.status + " " + (await resp.text()).slice(0, 200));
  const json = await resp.json();
  const content = json?.choices?.[0]?.message?.content ?? "";
  return JSON.parse(content);
}

(async () => {
  if (!BAILIAN_API_KEY) {
    console.error("FATAL: 缺少 BAILIAN_API_KEY（.env）");
    process.exit(2);
  }
  // 幂等补列（独立可跑）
  await pool.query(`ALTER TABLE "hotnews" ADD COLUMN IF NOT EXISTS "locale" text DEFAULT 'en' NOT NULL`);

  const en = await pool.query(
    `SELECT id, source, title, "desc" FROM hotnews WHERE locale = 'en' ORDER BY id`,
  );
  console.log(`EN 待翻译: ${en.rows.length} 条`);

  let done = 0;
  let skip = 0;
  let fail = 0;
  for (let i = 0; i < en.rows.length; i += BATCH) {
    const batch = en.rows.slice(i, i + BATCH);
    let results = [];
    try {
      results = await translateBatch(batch);
    } catch (e) {
      fail += batch.length;
      console.error(`FAIL 批次 ${i / BATCH + 1}:`, e.message);
      continue;
    }
    for (const item of results) {
      const src = batch.find((b) => String(b.id) === String(item.id));
      if (!src) {
        skip++;
        console.log(`WARN 翻译返回未知 id=${item.id}，跳过`);
        continue;
      }
      const enLen = String(src.title).length;
      const zhLen = String(item.title ?? "").length;
      // 翻译质量保护：中文信息密度高，正常标题约为英文的 20%~35%；
      // 阈值下限 15%（防截断/丢信息）、上限 300%（防未翻译复制英文）→ 超出视为异常，跳过待人工处理
      if (zhLen < enLen * 0.15 || zhLen > enLen * 3) {
        skip++;
        console.log(
          `WARN 长度异常跳过 id=${src.id} (enLen=${enLen} zhLen=${zhLen}) title="${String(item.title).slice(0, 40)}"`,
        );
        continue;
      }
      const res = await pool.query(
        `INSERT INTO hotnews (source, title, "desc", cover, hot, timestamp, url, locale)
         SELECT source, $1, $2, cover, hot, timestamp, url, 'zh' FROM hotnews WHERE id = $3
         ON CONFLICT (locale, source, title) DO NOTHING`,
        [String(item.title), String(item.desc ?? item.title), src.id],
      );
      if (res.rowCount > 0) done++;
      else skip++;
    }
  }

  const zh = await pool.query(`SELECT count(*)::int AS n FROM hotnews WHERE locale = 'zh'`);
  console.log(`\nRESULT: 写入 ${done} 条, 跳过 ${skip} 条, 批次失败 ${fail} 条 | zh 总数=${zh.rows[0].n}`);
  await pool.end();
})().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(2);
});
