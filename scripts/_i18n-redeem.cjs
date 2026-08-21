// Nav label change + redeem-pet module keys (zh/en).
const fs = require("fs");
const zh = JSON.parse(fs.readFileSync("messages/zh.json", "utf8"));
const en = JSON.parse(fs.readFileSync("messages/en.json", "utf8"));

// 导航：动物全图鉴 -> 动物图鉴
zh.nav.catalog = "动物图鉴";
en.nav.catalog = "Pet Dictionary";

// 我的宠物合成页返回链接
zh.petsCatalog.backToCatalog = "返回图鉴";
en.petsCatalog.backToCatalog = "Back to dictionary";

// 积分兑换模块
zh.points = {
  ...zh.points,
  redeemTitle: "🎁 积分兑换 · 新伙伴",
  redeemSub: "用积分兑换一只随机的普通级基础宠物（每天限 1 次）",
  redeemPrice: "兑换价格",
  redeemBtn: "兑换新伙伴",
  redeeming: "兑换中…",
  redeemProgress: "再获得 {need} 积分即可兑换一只新伙伴！",
  redeemProgressReady: "积分已满，快来兑换新伙伴吧！",
  redeemDailyLimit: "每天限兑换 1 次",
  redeemOk: "🎉 兑换成功！新伙伴已加入你的图鉴",
  redeemFail: "兑换失败，请稍后重试",
  redeemNoPoints: "积分不足（需要 500 积分）",
  redeemAlready: "今天已兑换过，明天再来吧~",
};
en.points = {
  ...en.points,
  redeemTitle: "🎁 Points Redemption · New Companion",
  redeemSub: "Redeem a random common base pet with points (limit 1 per day)",
  redeemPrice: "Price",
  redeemBtn: "Redeem companion",
  redeeming: "Redeeming…",
  redeemProgress: "Earn {need} more points to redeem a new companion!",
  redeemProgressReady: "Enough points - redeem your new companion now!",
  redeemDailyLimit: "Limit: 1 per day",
  redeemOk: "🎉 Redeemed! Your new companion is ready",
  redeemFail: "Redemption failed, please try again",
  redeemNoPoints: "Not enough points (need 500)",
  redeemAlready: "Already redeemed today, come back tomorrow~",
};

fs.writeFileSync("messages/zh.json", JSON.stringify(zh, null, 2) + "\n", "utf8");
fs.writeFileSync("messages/en.json", JSON.stringify(en, null, 2) + "\n", "utf8");

const flat = (o, p = "") =>
  Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? flat(v, p + k + ".") : [p + k]));
const zd = new Set(flat(zh));
const ed = new Set(flat(en));
const d = [...zd].filter((k) => !ed.has(k)).concat([...ed].filter((k) => !zd.has(k)));
console.log("alignment:", d.length ? d.join(", ") : "PERFECT ✅ (" + zd.size + " keys)");
