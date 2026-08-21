// Add evolve confirm i18n keys (zh/en).
const fs = require("fs");
const zh = JSON.parse(fs.readFileSync("messages/zh.json", "utf8"));
const en = JSON.parse(fs.readFileSync("messages/en.json", "utf8"));
zh.petsCatalog = { ...zh.petsCatalog, evolveConfirm: "确定要消耗这 3 只 {name} 吗？进化后不可撤销", confirmEvolve: "确认进化" };
en.petsCatalog = { ...en.petsCatalog, evolveConfirm: "Consume these 3 {name}? This cannot be undone", confirmEvolve: "Confirm evolve" };
fs.writeFileSync("messages/zh.json", JSON.stringify(zh, null, 2) + "\n", "utf8");
fs.writeFileSync("messages/en.json", JSON.stringify(en, null, 2) + "\n", "utf8");
const flat = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? flat(v, p + k + ".") : [p + k]));
const zd = new Set(flat(zh));
const ed = new Set(flat(en));
const d = [...zd].filter((k) => !ed.has(k)).concat([...ed].filter((k) => !zd.has(k)));
console.log("alignment:", d.length ? d.join(", ") : "PERFECT ✅ (" + zd.size + " keys)");
