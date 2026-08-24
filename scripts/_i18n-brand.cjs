// 品牌名统一：Aibi World / Abi World → AIABW（英文），艾比世界（中文保留）
// 只改网站/品牌级名称；宠物角色名（Aibi 'Huggy Fox' 等）不改。
const fs = require("fs");
const zh = JSON.parse(fs.readFileSync("messages/zh.json", "utf8"));
const en = JSON.parse(fs.readFileSync("messages/en.json", "utf8"));

const flat = (o, p = "") =>
  Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? flat(v, p + k + ".") : [p + k]));

let zhCount = 0;
let enCount = 0;
// zh：仅替换 "Abi World"（英文品牌名）→ AIABW；"艾比世界" 保留
for (const k of flat(zh)) {
  const v = k.split(".").reduce((o, x) => (o && o[x]) || null, zh);
  if (typeof v === "string" && v.includes("Abi World")) {
    k.split(".").slice(0, -1).reduce((o, x) => o[x], zh)[k.split(".").at(-1)] = v.split("Abi World").join("AIABW");
    zhCount++;
  }
}
// en：Aibi World / Abi World → AIABW；单独的 "Aibi"（宠物称谓）保留
for (const k of flat(en)) {
  const v = k.split(".").reduce((o, x) => (o && o[x]) || null, en);
  if (typeof v === "string" && /Aibi World|Abi World/.test(v)) {
    k.split(".").slice(0, -1).reduce((o, x) => o[x], en)[k.split(".").at(-1)] = v
      .split("Aibi World")
      .join("AIABW")
      .split("Abi World")
      .join("AIABW");
    enCount++;
  }
}

fs.writeFileSync("messages/zh.json", JSON.stringify(zh, null, 2) + "\n", "utf8");
fs.writeFileSync("messages/en.json", JSON.stringify(en, null, 2) + "\n", "utf8");
console.log("zh replacements:", zhCount, "| en replacements:", enCount);

// 校验：残余品牌名扫描（应只剩宠物层级的 "Aibi" 与域名 aiabw.com）
const RE = /Aibi World|Abi World|AIBI World/i;
let left = 0;
for (const k of flat(en)) {
  const v = k.split(".").reduce((o, x) => (o && o[x]) || null, en);
  if (typeof v === "string" && RE.test(v)) {
    console.log("REMAIN en:", k, "=", v.slice(0, 60));
    left++;
  }
}
const zd = new Set(flat(zh));
const ed = new Set(flat(en));
const d = [...zd].filter((k) => !ed.has(k)).concat([...ed].filter((k) => !zd.has(k)));
console.log("alignment:", d.length ? d.join(", ") : "PERFECT (" + zd.size + " keys)", "| remain:", left);
