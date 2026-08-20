// Add "艾比每日灵感" home keys to zh.json + en.json (aligned).
const fs = require("fs");
const zh = JSON.parse(fs.readFileSync("messages/zh.json", "utf8"));
const en = JSON.parse(fs.readFileSync("messages/en.json", "utf8"));

zh.home = {
  ...zh.home,
  dailyLoading: "每日灵感加载中…",
  fortune:
    "🔮 今日运势：{sign}星座的你，今天适合遇见一只【{name}】。它{trait}，能为你带来平静与灵感。",
  fortuneEmpty: "🔮 今天还没有幸运宠诞生，明天再来看看吧~",
  meet: "去遇见它",
  recentTitle: "🎉 刚刚诞生的伙伴",
  recentItem: "玩家 {user} 刚刚领养的 {name} {id}",
  recentEmpty: "今天还没有新伙伴诞生，快来成为第一个！",
  zodiacFire: "火象",
  zodiacEarth: "土象",
  zodiacAir: "风象",
  zodiacWater: "水象",
};
en.home = {
  ...en.home,
  dailyLoading: "Loading today's inspiration…",
  fortune:
    "🔮 Today's fortune: a {sign} day — meet a {name} today. It is {trait}, bringing you calm and inspiration.",
  fortuneEmpty: "🔮 No lucky pet yet today — check back tomorrow!",
  meet: "Meet it now",
  recentTitle: "🎉 Just born companions",
  recentItem: "Player {user} just adopted {name} {id}",
  recentEmpty: "No new companions today — be the first!",
  zodiacFire: "Fire",
  zodiacEarth: "Earth",
  zodiacAir: "Air",
  zodiacWater: "Water",
};

fs.writeFileSync("messages/zh.json", JSON.stringify(zh, null, 2) + "\n", "utf8");
fs.writeFileSync("messages/en.json", JSON.stringify(en, null, 2) + "\n", "utf8");

const flat = (o, p = "") =>
  Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === "object" ? flat(v, p + k + ".") : [p + k],
  );
const zd = new Set(flat(zh));
const ed = new Set(flat(en));
const diff = [...zd].filter((k) => !ed.has(k)).concat([...ed].filter((k) => !zd.has(k)));
console.log("alignment:", diff.length ? diff.join(", ") : "PERFECT ✅ (" + zd.size + " keys)");
