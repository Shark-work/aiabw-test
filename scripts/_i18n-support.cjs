// Add support (customer service) i18n keys to zh.json + en.json.
const fs = require("fs");
const zh = JSON.parse(fs.readFileSync("messages/zh.json", "utf8"));
const en = JSON.parse(fs.readFileSync("messages/en.json", "utf8"));

zh.support = {
  supportTitle: "意见反馈与客服联系",
  supportBody: "如您在虚拟物品合成、账号数据等方面遇到问题，请随时通过以下方式联系我们：",
  supportEmail: "客服邮箱",
  supportQQGroup: "QQ 群号",
  copy: "复制",
  copied: "✓ 已复制",
};
en.support = {
  supportTitle: "Feedback & Support",
  supportBody: "If you run into any issue with virtual goods, synthesis, account or data, please reach us anytime:",
  supportEmail: "Support email",
  supportQQGroup: "QQ Group",
  copy: "Copy",
  copied: "✓ Copied",
};

fs.writeFileSync("messages/zh.json", JSON.stringify(zh, null, 2) + "\n", "utf8");
fs.writeFileSync("messages/en.json", JSON.stringify(en, null, 2) + "\n", "utf8");

const flat = (o, p = "") =>
  Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? flat(v, p + k + ".") : [p + k]));
const zd = new Set(flat(zh));
const ed = new Set(flat(en));
const diff = [...zd].filter((k) => !ed.has(k)).concat([...ed].filter((k) => !zd.has(k)));
console.log("alignment:", diff.length ? diff.join(", ") : "PERFECT ✅ (" + zd.size + " keys)");
