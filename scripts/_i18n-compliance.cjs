// 上线前合规：全局版权/免责声明 + 合成玩法术语去IP化（灵力/元素/融合）
// - footer: copyrightLine / originalNotice / disclaimer（zh/en）
// - 替换 zh/en 中面向用户的「基因/进化」为「灵力/元素/融合」
const fs = require("fs");
const zh = JSON.parse(fs.readFileSync("messages/zh.json", "utf8"));
const en = JSON.parse(fs.readFileSync("messages/en.json", "utf8"));

// 1) Footer 合规三件套
zh.footer = {
  ...zh.footer,
  copyrightLine: "© 2026 艾比世界 (Abi World). All Rights Reserved.",
  originalNotice:
    "本站所有宠物形象、基因设定、物种描述及UI设计均为原创或经合法授权生成，受著作权法保护。未经书面许可，禁止任何形式的转载、抓取或商业使用。",
  disclaimer: "本平台为虚拟互动社区，所有宠物数据仅用于娱乐与收藏，不具备现实货币价值。",
};
en.footer = {
  ...en.footer,
  copyrightLine: "© 2026 Abi World. All Rights Reserved.",
  originalNotice:
    "All pet artwork, genetic settings, species descriptions and UI designs on this site are original or legally licensed and protected by copyright law. Any reproduction, scraping or commercial use without written permission is prohibited.",
  disclaimer:
    "This platform is a virtual interactive community. All pet data is for entertainment and collection only and has no real-world monetary value.",
};

// 2) 玩法术语去 IP 化（zh）
zh.myPets.evolveBanner = "🧪 发现你有 3 只相同的伙伴？试试灵力融合吧！";
zh.myPets.evolveGo = "去融合 →";
zh.petsCatalog.subtitle = "预计算生成 · 字典物种 · 元素筛选";
zh.petsCatalog.evolvable = "✨ 可融合";
zh.petsCatalog.evolve = "灵力融合";
zh.petsCatalog.evolveSuccess = "🎉 融合成功！";
zh.petsCatalog.evolveFail = "融合失败";
zh.petsCatalog.evolveConfirm = "确定要消耗这 3 只 {name} 吗？融合后不可撤销";
zh.petsCatalog.confirmEvolve = "确认融合";
zh.petsCatalog.fuseNormal = "灵力融合成功！一只更强壮的 {name} 诞生了！";
zh.petsCatalog.fuseCritical = "✨ 奇迹发生！灵力觉醒，它变成了更高形态！";
zh.api.invalidEvolveSet = "融合需要 3 只同物种同稀有度的宠物";
zh.api.legendaryTop = "传说级已是顶点，无需再融合";
zh.api.evolveFailed = "融合失败，请稍后重试";
zh.pages.aboutBody = "艾比世界（aiabw.com）是一个 AI 虚拟宠物养成平台：每一只艾比都拥有独一无二的灵力、性格与记忆，会陪你聊天、成长，留下只属于你们的羁绊。";

// 3) 玩法术语去 IP 化（en）
en.myPets.evolveGo = "Fuse now →";
en.petsCatalog.subtitle = "Precomputed · Dictionary species · Element filtering";
en.petsCatalog.evolvable = "✨ Fusible";
en.petsCatalog.evolve = "Spirit fusion";
en.petsCatalog.evolveSuccess = "🎉 Fusion success!";
en.petsCatalog.evolveFail = "Fusion failed";
en.petsCatalog.confirmEvolve = "Confirm fuse";
en.petsCatalog.fuseNormal = "Spirit power fused! A stronger {name} was born!";
en.petsCatalog.fuseCritical = "✨ A miracle! Spirit awakening - it turned into a higher form!";
en.api.invalidEvolveSet = "Fusion needs 3 pets of the same species and rarity";
en.api.evolveFailed = "Fusion failed, please try again";
en.pages.aboutBody =
  "Aibi World (aiabw.com) is an AI virtual pet platform: every Aibi has its own unique spirit, personality and memories, chats with you, grows with you, and builds a bond that belongs to you alone.";

// legal terms（zh）
zh.legal.termsBody = zh.legal.termsBody
  .replace("AI 虚拟宠物领养、合成、进化、互动聊天", "AI 虚拟宠物领养、合成、融合、互动聊天");
// legal goods（zh）
zh.legal.goodsBody = zh.legal.goodsBody
  .replace("一经领养、合成、进化或购买", "一经领养、合成、融合或购买")
  .replace("四、合成与进化规则公开透明", "四、合成与融合规则公开透明")
  .replace("进化链：普通 → 不凡 → 稀有 → 史诗 → 传说，传说为顶点，不再消耗", "融合链：普通 → 不凡 → 稀有 → 史诗 → 传说，传说为顶点，不再消耗");
// legal privacy（zh）
zh.legal.privacyBody = zh.legal.privacyBody.replace("领养/合成/进化记录", "领养/合成/融合记录");

// legal terms（en）
en.legal.termsBody = en.legal.termsBody.replace(
  "adoption, synthesis, evolution, chat",
  "adoption, synthesis, fusion, chat",
);
// legal goods（en）
en.legal.goodsBody = en.legal.goodsBody
  .replace("synthesized, evolved or purchased", "synthesized, fused or purchased")
  .replace("Transparent Synthesis & Evolution Rules", "Transparent Synthesis & Fusion Rules")
  .replace("Evolution chain: Common ->", "Fusion chain: Common ->");
// legal privacy（en）
en.legal.privacyBody = en.legal.privacyBody.replace(
  "adoption/synthesis/evolution records",
  "adoption/synthesis/fusion records",
);

// en onlyEvolvable / noEvolvable → Fusible
en.petsCatalog.onlyEvolvable = "🔮 Fusible only";
en.petsCatalog.noEvolvable = "No fusible companions yet (need 3+ of the same kind)";

fs.writeFileSync("messages/zh.json", JSON.stringify(zh, null, 2) + "\n", "utf8");
fs.writeFileSync("messages/en.json", JSON.stringify(en, null, 2) + "\n", "utf8");

// 4) 校验：对齐 + 残留风险词扫描（UI 可见文案中不得出现 基因/进化/繁殖/突变 组合）
const flat = (o, p = "") =>
  Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? flat(v, p + k + ".") : [p + k]));
const zd = new Set(flat(zh));
const ed = new Set(flat(en));
const d = [...zd].filter((k) => !ed.has(k)).concat([...ed].filter((k) => !zd.has(k)));
console.log("alignment:", d.length ? d.join(", ") : "PERFECT (" + zd.size + " keys)");
const RE = /基因重组|基因突变|可进化|进化成功|进化失败|进化石|CP值|Gene mutation|Genes recombined/;
for (const k of zd) {
  const v = k.split(".").reduce((o, x) => (o && o[x]) || null, zh);
  if (typeof v === "string" && RE.test(v)) console.log("RISK zh:", k, "=", v);
}
for (const k of ed) {
  const v = k.split(".").reduce((o, x) => (o && o[x]) || null, en);
  if (typeof v === "string" && RE.test(v)) console.log("RISK en:", k, "=", v);
}
console.log("compliance done");
