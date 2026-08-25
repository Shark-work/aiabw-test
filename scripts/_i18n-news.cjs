// home i18n：动物世界头条模块
const fs = require("fs");
const zh = JSON.parse(fs.readFileSync("messages/zh.json", "utf8"));
const en = JSON.parse(fs.readFileSync("messages/en.json", "utf8"));

zh.home = { ...zh.home,
  newsTitle: "🐾 动物世界头条",
  newsHot: "🔥 {hot} 热度",
  newsCopyright: "资讯内容聚合自公开网络，版权归原作者所有。如有侵犯您的权益，请联系客服处理。",
};
en.home = { ...en.home,
  newsTitle: "🐾 Animal News Headlines",
  newsHot: "🔥 {hot} hot",
  newsCopyright: "Content aggregated from public sources; all rights belong to the original authors. Please contact support if any rights are infringed.",
};

fs.writeFileSync("messages/zh.json", JSON.stringify(zh, null, 2) + "\n", "utf8");
fs.writeFileSync("messages/en.json", JSON.stringify(en, null, 2) + "\n", "utf8");
const flat = (o, p = "") =>
  Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? flat(v, p + k + ".") : [p + k]));
const zd = new Set(flat(zh));
const ed = new Set(flat(en));
const d = [...zd].filter((k) => !ed.has(k)).concat([...ed].filter((k) => !zd.has(k)));
console.log("alignment:", d.length ? d.join(", ") : "PERFECT (" + zd.size + " keys)");
