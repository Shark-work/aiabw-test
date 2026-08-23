// home i18n：动态推荐宠 + 详情弹窗 CTA
const fs = require("fs");
const zh = JSON.parse(fs.readFileSync("messages/zh.json", "utf8"));
const en = JSON.parse(fs.readFileSync("messages/en.json", "utf8"));

zh.home = { ...zh.home,
  get: "获得它",
  getHint: "领养后即可在聊天中与它互动",
  detailRare: "✨ 稀缺",
  detailAdopted: "已有 {count} 位主人领养",
  detailGeneration: "第 {gen} 代",
  featuredLoading: "正在挑选推荐伙伴…",
  featuredEmpty: "暂无推荐伙伴，去图鉴逛逛吧",
};
en.home = { ...en.home,
  get: "Get it now",
  getHint: "Adopt it and chat with your new friend right away",
  detailRare: "✨ Rare",
  detailAdopted: "Adopted by {count} owners",
  detailGeneration: "Gen {gen}",
  featuredLoading: "Picking featured pets…",
  featuredEmpty: "No featured pets yet - browse the encyclopedia",
};

fs.writeFileSync("messages/zh.json", JSON.stringify(zh, null, 2) + "\n", "utf8");
fs.writeFileSync("messages/en.json", JSON.stringify(en, null, 2) + "\n", "utf8");
const flat = (o, p = "") =>
  Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? flat(v, p + k + ".") : [p + k]));
const zd = new Set(flat(zh));
const ed = new Set(flat(en));
const d = [...zd].filter((k) => !ed.has(k)).concat([...ed].filter((k) => !zd.has(k)));
console.log("alignment:", d.length ? d.join(", ") : "PERFECT (" + zd.size + " keys)");
