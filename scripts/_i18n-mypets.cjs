// my-pets page refactor i18n keys (aggregation, release confirm, fusion copy, redeem shop).
const fs = require("fs");
const zh = JSON.parse(fs.readFileSync("messages/zh.json", "utf8"));
const en = JSON.parse(fs.readFileSync("messages/en.json", "utf8"));

zh.petsCatalog = {
  ...zh.petsCatalog,
  storageLabel: "持有",
  storageLimit: "仓库上限",
  onlyEvolvable: "🔮 仅显示可合成",
  noEvolvable: "暂无满足合成条件的伙伴（每种至少 3 只）",
  selectTitle: "选择要合成的伙伴",
  selectHint: "勾选 {count} 只同稀有度的伙伴进行 3 合 1 合成",
  selectedCount: "已选中 {count} 只 {name}",
  fuseNow: "✨ 立即合成",
  xCount: "x{count}",
  release: "🗑️ 放生",
  releaseConfirm: "确定要放生这只 {name} 吗？此操作不可撤销。",
  releasedOk: "🐦 已放生",
  fuseNormal: "基因重组成功！一只更强壮的 {name} 诞生了！",
  fuseCritical: "✨ 奇迹发生！基因突变，它变成了更高形态！",
  keepInBag: "放入背包",
  continueFuse: "继续合成",
  critical: "✨ 幸运暴击",
  redeemShop: "🎁 积分兑换所",
  redeemBlindHint: "基础宠物盲盒：必得常见级，小概率开出不凡级",
  redeemNeed: "还差 {need} 分即可兑换",
  deposit: "存入我的宠物",
};
en.petsCatalog = {
  ...en.petsCatalog,
  storageLabel: "Owned",
  storageLimit: "Storage limit",
  onlyEvolvable: "🔮 Evolvable only",
  noEvolvable: "No evolvable companions yet (need 3+ of the same kind)",
  selectTitle: "Pick companions to fuse",
  selectHint: "Select {count} of the same rarity to fuse 3-in-1",
  selectedCount: "{count} × {name} selected",
  fuseNow: "✨ Fuse now",
  xCount: "x{count}",
  release: "🗑️ Release",
  releaseConfirm: "Release this {name}? This cannot be undone.",
  releasedOk: "🐦 Released",
  fuseNormal: "Genes recombined! A stronger {name} was born!",
  fuseCritical: "✨ A miracle! Gene mutation - it evolved into a higher form!",
  keepInBag: "Keep in bag",
  continueFuse: "Fuse more",
  critical: "✨ Lucky crit",
  redeemShop: "🎁 Points Shop",
  redeemBlindHint: "Base pet blind box: common guaranteed, small chance of uncommon",
  redeemNeed: "{need} more points to redeem",
  deposit: "Store to my pets",
};

zh.api = { ...zh.api, releaseFailed: "放生失败，请稍后重试" };
en.api = { ...en.api, releaseFailed: "Release failed, please try again" };

fs.writeFileSync("messages/zh.json", JSON.stringify(zh, null, 2) + "\n", "utf8");
fs.writeFileSync("messages/en.json", JSON.stringify(en, null, 2) + "\n", "utf8");

const flat = (o, p = "") =>
  Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? flat(v, p + k + ".") : [p + k]));
const zd = new Set(flat(zh));
const ed = new Set(flat(en));
const d = [...zd].filter((k) => !ed.has(k)).concat([...ed].filter((k) => !zd.has(k)));
console.log("alignment:", d.length ? d.join(", ") : "PERFECT ✅ (" + zd.size + " keys)");
