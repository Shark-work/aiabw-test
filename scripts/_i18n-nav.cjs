// Sync new nav / footer / home-banner / my-pets-imprint i18n keys into zh.json + en.json (kept perfectly aligned).
const fs = require("fs");

const zh = JSON.parse(fs.readFileSync("messages/zh.json", "utf8"));
const en = JSON.parse(fs.readFileSync("messages/en.json", "utf8"));

// ---------- nav ----------
zh.nav = {
  home: "首页",
  catalog: "动物全图鉴",
  myPets: "我的宠物",
  market: "商城",
  journals: "手帐",
  points: "积分",
  login: "登录",
  register: "注册",
  logout: "退出",
  menu: "菜单",
  openMenu: "打开菜单",
  closeMenu: "关闭菜单",
};
en.nav = {
  home: "Home",
  catalog: "Pet Dictionary",
  myPets: "My Pets",
  market: "Market",
  journals: "Journals",
  points: "Points",
  login: "Sign in",
  register: "Register",
  logout: "Sign out",
  menu: "Menu",
  openMenu: "Open menu",
  closeMenu: "Close menu",
};

// ---------- home: rare-pet banner (scarcity) ----------
zh.home.rareBannerTitle = "👑 稀有宠物 · 高光图鉴";
zh.home.rareBannerSub = "传说与史诗艾比就藏在这里，单次合成概率不到 5%";
en.home.rareBannerTitle = "👑 Rare Pets · Radiant Catalog";
en.home.rareBannerSub = "Legend & epic Aibis hide in here — under 5% chance per synthesis";

// ---------- myPets: endowment mark + loss-aversion hint ----------
zh.myPets.imprintMark = "专属印记";
zh.myPets.imprintDate = "由你于 {date} 孕育";
zh.myPets.hungryHint = "🍖 它饿了，去喂食吧！";
zh.myPets.feed = "🍖 去喂食";
en.myPets.imprintMark = "Endowment Mark";
en.myPets.imprintDate = "Born for you on {date}";
en.myPets.hungryHint = "🍖 It's hungry — go feed it!";
en.myPets.feed = "🍖 Feed now";

// ---------- footer: auxiliary navigation ----------
zh.footer.about = "关于我们";
zh.footer.faq = "常见问题";
zh.footer.contact = "联系方式";
zh.footer.terms = "用户协议";
en.footer.about = "About";
en.footer.faq = "FAQ";
en.footer.contact = "Contact";
en.footer.terms = "Terms";

// ---------- pages namespace (about / faq / contact / terms) ----------
zh.pages = {
  backHome: "← 返回首页",
  aboutTitle: "关于艾比世界",
  aboutBody: "艾比世界（aiabw.com）是一个 AI 虚拟宠物养成平台：每一只艾比都拥有独一无二的基因、性格与记忆，会陪你聊天、成长，留下只属于你们的羁绊。",
  faqTitle: "常见问题",
  faqBody: "Q：怎么领养第二只宠物？\nA：先领养第一只艾比，然后在首页或图鉴页选择心仪的伙伴，按提示完成解锁（付费一次，永久多宠）。\n\nQ：宠物饿了会怎样？\nA：超过 3 天没互动，它会变成灰色并显示「饿了 / 想你了」，点击「喂食互动」即可恢复活力。\n\nQ：积分有什么用？\nA：积分可用于购买 UGC 宠物、参与盲盒抽卡；每天签到即可获得积分。",
  contactTitle: "联系我们",
  contactBody: "有任何建议或问题，欢迎通过邮件联系我们：\nsupport@aiabw.com",
  termsTitle: "用户协议",
  termsBody: "使用艾比世界即表示您同意：尊重他人创作内容；虚拟宠物与积分为站内虚拟资产；付费解锁一经完成不支持退款；请勿利用平台从事任何违法活动。",
};
en.pages = {
  backHome: "← Back to home",
  aboutTitle: "About Aibi World",
  aboutBody: "Aibi World (aiabw.com) is an AI virtual pet platform: every Aibi has its own unique genes, personality and memories, chats with you, grows with you, and builds a bond that belongs to you alone.",
  faqTitle: "FAQ",
  faqBody: "Q: How do I adopt a second pet?\nA: Adopt your first Aibi, then pick your favorite companion on the home or dictionary page and unlock it (pay once, multi-pet forever).\n\nQ: What happens when a pet gets hungry?\nA: If you don't interact for over 3 days, it turns gray and shows \"Hungry / Missing you\". Tap \"Feed & cuddle\" to bring it back to life.\n\nQ: What are points for?\nA: Points buy UGC pets and gacha draws; check in daily to earn points.",
  contactTitle: "Contact us",
  contactBody: "For feedback or support, email us at:\nsupport@aiabw.com",
  termsTitle: "Terms of Service",
  termsBody: "By using Aibi World you agree to: respect others' content; virtual pets and points are in-game virtual assets; paid unlocks are non-refundable once completed; do not use the platform for any illegal activity.",
};

fs.writeFileSync("messages/zh.json", JSON.stringify(zh, null, 2) + "\n", "utf8");
fs.writeFileSync("messages/en.json", JSON.stringify(en, null, 2) + "\n", "utf8");

// alignment check
const z2 = JSON.parse(fs.readFileSync("messages/zh.json", "utf8"));
const e2 = JSON.parse(fs.readFileSync("messages/en.json", "utf8"));
const zk = (o) => Object.keys(o);
const flat = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? flat(v, p + k + ".") : [p + k]));
const zd = new Set(flat(z2));
const ed = new Set(flat(e2));
const diff = [...zd].filter((k) => !ed.has(k)).concat([...ed].filter((k) => !zd.has(k)));
console.log("key-alignment diff:", diff.length ? diff.join(", ") : "PERFECT ✅ (" + zd.size + " keys each)");
