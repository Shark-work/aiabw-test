// Add evolution + AI-image i18n keys (zh/en aligned).
const fs = require("fs");
const zh = JSON.parse(fs.readFileSync("messages/zh.json", "utf8"));
const en = JSON.parse(fs.readFileSync("messages/en.json", "utf8"));

// ---- api ----
zh.api = { ...zh.api,
  invalidEvolveSet: "进化需要 3 只同物种同稀有度的宠物",
  notSameGroup: "3 只宠物必须同物种且同稀有度",
  legendaryTop: "传说级已是顶点，无需再进化",
  evolveFailed: "进化失败，请稍后重试",
};
en.api = { ...en.api,
  invalidEvolveSet: "Evolution needs 3 pets of the same species and rarity",
  notSameGroup: "The 3 pets must share the same species and rarity",
  legendaryTop: "Legendary is already the peak",
  evolveFailed: "Evolution failed, please try again",
};

// ---- petsCatalog ----
zh.petsCatalog = { ...zh.petsCatalog,
  evolvable: "✨ 可进化",
  evolve: "融合进化",
  evolveHint: "集齐 3 只同物种、同稀有度的伙伴，即可融合升级！",
  evolveConsume: "将消耗 {count} 只 {name}",
  evolveSelect: "选择要融合的 3 只",
  evolving: "融合中…",
  evolveSuccess: "🎉 进化成功！",
  evolveFail: "进化失败",
  maxEvolved: "👑 满级",
};
en.petsCatalog = { ...en.petsCatalog,
  evolvable: "✨ Evolvable",
  evolve: "Fuse & evolve",
  evolveHint: "Collect 3 companions of the same species & rarity to fuse them up!",
  evolveConsume: "Consumes {count} × {name}",
  evolveSelect: "Pick 3 to fuse",
  evolving: "Fusing…",
  evolveSuccess: "🎉 Evolution success!",
  evolveFail: "Evolution failed",
  maxEvolved: "👑 MAX",
};

// ---- myPets banner ----
zh.myPets = { ...zh.myPets,
  evolveBanner: "🧪 发现你有 3 只相同的伙伴？去图鉴中心试试融合进化吧！",
  evolveGo: "去进化 →",
};
en.myPets = { ...en.myPets,
  evolveBanner: "🧪 Got 3 identical companions? Try fusing them at the Dictionary!",
  evolveGo: "Evolve now →",
};

fs.writeFileSync("messages/zh.json", JSON.stringify(zh, null, 2) + "\n", "utf8");
fs.writeFileSync("messages/en.json", JSON.stringify(en, null, 2) + "\n", "utf8");

const flat = (o, p = "") =>
  Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? flat(v, p + k + ".") : [p + k]));
const zd = new Set(flat(zh));
const ed = new Set(flat(en));
const diff = [...zd].filter((k) => !ed.has(k)).concat([...ed].filter((k) => !zd.has(k)));
console.log("alignment:", diff.length ? diff.join(", ") : "PERFECT ✅ (" + zd.size + " keys)");
