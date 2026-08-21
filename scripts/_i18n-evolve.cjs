// Add evolution + AI-image i18n keys (zh/en aligned).
const fs = require("fs");
const zh = JSON.parse(fs.readFileSync("messages/zh.json", "utf8"));
const en = JSON.parse(fs.readFileSync("messages/en.json", "utf8"));

// ---- api ----
zh.api = { ...zh.api,
  invalidEvolveSet: "融合需要 3 只同物种同稀有度的宠物",
  notSameGroup: "3 只宠物必须同物种且同稀有度",
  legendaryTop: "传说级已是顶点，无需再融合",
  evolveFailed: "融合失败，请稍后重试",
};
en.api = { ...en.api,
  invalidEvolveSet: "Fusion needs 3 pets of the same species and rarity",
  notSameGroup: "The 3 pets must share the same species and rarity",
  legendaryTop: "Legendary is already the peak",
  evolveFailed: "Fusion failed, please try again",
};

// ---- petsCatalog ----
zh.petsCatalog = { ...zh.petsCatalog,
  evolvable: "✨ 可融合",
  evolve: "灵力融合",
  evolveHint: "集齐 3 只同物种、同稀有度的伙伴，即可灵力融合升级！",
  evolveConsume: "将消耗 {count} 只 {name}",
  evolveSelect: "选择要融合的 3 只",
  evolving: "融合中…",
  evolveSuccess: "🎉 融合成功！",
  evolveFail: "融合失败",
  maxEvolved: "👑 满级",
};
en.petsCatalog = { ...en.petsCatalog,
  evolvable: "✨ Fusible",
  evolve: "Spirit fusion",
  evolveHint: "Collect 3 companions of the same species & rarity to fuse them with spirit power!",
  evolveConsume: "Consumes {count} × {name}",
  evolveSelect: "Pick 3 to fuse",
  evolving: "Fusing…",
  evolveSuccess: "🎉 Fusion success!",
  evolveFail: "Fusion failed",
  maxEvolved: "👑 MAX",
};

// ---- myPets banner ----
zh.myPets = { ...zh.myPets,
  evolveBanner: "🧪 发现你有 3 只相同的伙伴？试试灵力融合吧！",
  evolveGo: "去融合 →",
};
en.myPets = { ...en.myPets,
  evolveBanner: "🧪 Got 3 identical companions? Try fusing them at the Dictionary!",
  evolveGo: "Fuse now →",
};

fs.writeFileSync("messages/zh.json", JSON.stringify(zh, null, 2) + "\n", "utf8");
fs.writeFileSync("messages/en.json", JSON.stringify(en, null, 2) + "\n", "utf8");

const flat = (o, p = "") =>
  Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? flat(v, p + k + ".") : [p + k]));
const zd = new Set(flat(zh));
const ed = new Set(flat(en));
const diff = [...zd].filter((k) => !ed.has(k)).concat([...ed].filter((k) => !zd.has(k)));
console.log("alignment:", diff.length ? diff.join(", ") : "PERFECT ✅ (" + zd.size + " keys)");
