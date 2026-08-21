// 全球化 SEO：per-locale 元数据重写（独立创作，非机翻，突出真实养成场景）
const fs = require("fs");
const zh = JSON.parse(fs.readFileSync("messages/zh.json", "utf8"));
const en = JSON.parse(fs.readFileSync("messages/en.json", "utf8"));

zh.common.metaTitle = "艾比世界 Abi World - AI 虚拟宠物领养与养成";
zh.common.metaDescription =
  "领养专属 AI 虚拟宠物艾比：每天邂逅一只幸运灵宠与灵感签，用 3 合 1 灵力融合培育稀有伙伴。宠物会记住你的每一次互动，陪你慢慢长大。";

en.common.metaTitle = "Abi World - Adopt & Raise Your AI Virtual Pet";
en.common.metaDescription =
  "Adopt your own AI companion pet at Abi World: meet a lucky daily spirit pet, fuse three friends into rarer legendary forms, and watch your pet remember every chat as it grows alongside you.";

fs.writeFileSync("messages/zh.json", JSON.stringify(zh, null, 2) + "\n", "utf8");
fs.writeFileSync("messages/en.json", JSON.stringify(en, null, 2) + "\n", "utf8");

const flat = (o, p = "") =>
  Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? flat(v, p + k + ".") : [p + k]));
const zd = new Set(flat(zh));
const ed = new Set(flat(en));
const d = [...zd].filter((k) => !ed.has(k)).concat([...ed].filter((k) => !zd.has(k)));
console.log("alignment:", d.length ? d.join(", ") : "PERFECT (" + zd.size + " keys)");
