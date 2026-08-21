// Fill the en.legal.goodsBody content (run after _i18n-legal-en.cjs).
const fs = require("fs");
const en = JSON.parse(fs.readFileSync("messages/en.json", "utf8"));

en.legal.goodsBody = [
  "These rules apply to the acquisition, synthesis, recharge, use and disposal of virtual pets, points and other virtual goods on the Platform. Please read carefully before purchase or use.",
  "1. Nature of Virtual Goods",
  "1.1 Virtual pets and points are in-game virtual assets, not currency, and cannot be exchanged for legal tender;",
  "1.2 Legally obtained virtual assets are usable only within Platform rules.",
  "2. Recharge",
  "2.1 Recharge only through official Platform channels and confirm the amount and receiving account;",
  "2.2 Network delay may occur; if crediting takes too long, contact support@aiabw.com.",
  "3. No Refunds for Virtual Pets",
  "3.1 Once adopted, synthesized, evolved or purchased, virtual pets are delivered and consumed - no refunds or returns;",
  "3.2 Spent points (synthesis, gacha, UGC purchases) are non-refundable;",
  "3.3 Mandatory legal provisions, if any, prevail.",
  "4. Transparent Synthesis & Evolution Rules",
  "4.1 Synthesis follows a 3:1 rule: consuming 3 pets of the same species and rarity yields 1 pet one rarity tier higher;",
  "4.2 Evolution chain: Common -> Uncommon -> Rare -> Epic -> Legendary; Legendary is the peak and cannot be consumed;",
  "4.3 Rarity probabilities are published in the Dictionary; results are determined randomly under the published rules and are auditable.",
  "5. Data Loss & Fault Recovery",
  "5.1 If user virtual assets are lost or wrongly deducted due to Platform bugs, faults or operational errors, the Platform will verify, restore the data, or grant equivalent compensation;",
  "5.2 Users should report anomalies promptly and the Platform will handle them after verification.",
  "6. No Offline Resale or Illegal Trading",
  "6.1 Any form of offline resale, transfer or selling of virtual pets, points or accounts is prohibited;",
  "6.2 Using virtual assets for gambling, money laundering or other illegal activities is prohibited;",
  "6.3 Violations may lead to asset freezing, account suspension and legal liability.",
  "7. Miscellaneous",
  "7.1 These rules and the Terms of Service together form the complete agreement; in case of conflict, these rules prevail;",
  "7.2 The Platform may update these rules as needed; updates take effect upon announcement on the Platform.",
].join("\n");

fs.writeFileSync("messages/en.json", JSON.stringify(en, null, 2) + "\n", "utf8");
console.log("en.json goodsBody filled");
