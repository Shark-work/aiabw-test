// footer i18n：访问计数只显示累计访问（前端 +10000 底数）
const fs = require("fs");
const zh = JSON.parse(fs.readFileSync("messages/zh.json", "utf8"));
const en = JSON.parse(fs.readFileSync("messages/en.json", "utf8"));

zh.footer.visitsLine = "📊 本站累计访问 {total} 次";
en.footer.visitsLine = "📊 Total visits: {total}";

fs.writeFileSync("messages/zh.json", JSON.stringify(zh, null, 2) + "\n", "utf8");
fs.writeFileSync("messages/en.json", JSON.stringify(en, null, 2) + "\n", "utf8");
const flat = (o, p = "") =>
  Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? flat(v, p + k + ".") : [p + k]));
const zd = new Set(flat(zh));
const ed = new Set(flat(en));
const d = [...zd].filter((k) => !ed.has(k)).concat([...ed].filter((k) => !zd.has(k)));
console.log("alignment:", d.length ? d.join(", ") : "PERFECT (" + zd.size + " keys)");
