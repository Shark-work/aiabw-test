// pay i18n：二维码长按识别提示
const fs = require("fs");
const zh = JSON.parse(fs.readFileSync("messages/zh.json", "utf8"));
const en = JSON.parse(fs.readFileSync("messages/en.json", "utf8"));

zh.pay = { ...zh.pay,
  qrAlt: "微信支付二维码",
  longPressHint: "👆 长按图片可识别微信支付",
};
en.pay = { ...en.pay,
  qrAlt: "WeChat Pay QR code",
  longPressHint: "👆 Long-press the image to scan with WeChat",
};

fs.writeFileSync("messages/zh.json", JSON.stringify(zh, null, 2) + "\n", "utf8");
fs.writeFileSync("messages/en.json", JSON.stringify(en, null, 2) + "\n", "utf8");
const flat = (o, p = "") =>
  Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? flat(v, p + k + ".") : [p + k]));
const zd = new Set(flat(zh));
const ed = new Set(flat(en));
const d = [...zd].filter((k) => !ed.has(k)).concat([...ed].filter((k) => !zd.has(k)));
console.log("alignment:", d.length ? d.join(", ") : "PERFECT (" + zd.size + " keys)");
