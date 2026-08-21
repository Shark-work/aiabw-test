// Add legal pages keys (en) + footer nav keys.
const fs = require("fs");
const en = JSON.parse(fs.readFileSync("messages/en.json", "utf8"));

en.footer = { ...en.footer, privacy: "Privacy Policy", virtualGoods: "Virtual Goods & Recharge Rules" };

en.legal = {
  backHome: "← Back to home",
  lastUpdated: "Last updated: 2026-08-21",
  termsTitle: "Aibi World Terms of Service",
  termsBody: [
    "Aibi World (aiabw.com, \"the Platform\") is an online service for AI virtual pet raising, interaction and content sharing. Please read these Terms carefully before using the Platform; by registering, logging in or continuing to use the service, you agree to these Terms.",
    "1. Services",
    "1.1 The Platform provides AI virtual pet adoption, synthesis, evolution, chat, points and virtual goods;",
    "1.2 The Platform may adjust or suspend part of the services based on business needs, with advance notice via in-app announcements.",
    "2. Account",
    "2.1 Users register with a valid email and are responsible for all activity under their account;",
    "2.2 Users must not transfer, lend, sell or otherwise share accounts;",
    "2.3 Contact support@aiabw.com immediately if the account shows abnormal activity.",
    "3. Virtual Pets & Virtual Assets",
    "3.1 Virtual pets and points are in-game virtual assets usable only within Platform rules;",
    "3.2 Users hold usage rights per Platform rules; the Platform reserves the right to handle rule-violating accounts and assets.",
    "4. User Conduct",
    "4.1 No bots, scripts or automation that interfere with normal operations;",
    "4.2 No data manipulation, fake traffic, attacks or service sabotage;",
    "4.3 No use of the Platform for any unlawful activity.",
    "5. Service Changes, Interruption & Termination",
    "5.1 The Platform will announce maintenance in advance where possible and restore service promptly;",
    "5.2 Serious violations may lead to warnings, feature restrictions or account suspension.",
    "6. Disclaimer & Disputes",
    "6.1 To the extent permitted by law, the Platform is not liable for interruptions caused by force majeure or third parties;",
    "6.2 These Terms are governed by the laws of the People's Republic of China; disputes shall be settled by friendly negotiation first, otherwise submitted to the competent court at the Platform operator's domicile.",
  ].join("\n"),
  privacyTitle: "Aibi World Privacy Policy",
  privacyBody: [
    "The Platform values your personal information and applies appropriate security measures in accordance with laws and regulations. This policy explains how we collect, use, store and protect your information.",
    "1. Information We Collect",
    "1.1 Account: the email address you register with;",
    "1.2 Device: an anonymous device id (anonymousId) for guest-mode data attribution and migration;",
    "1.3 Interaction data: chat content with virtual pets, adoption/synthesis/evolution records, and points changes, used to provide core services.",
    "2. Purposes of Use",
    "2.1 To provide core features such as pet raising, chat and marketplace;",
    "2.2 To protect account security and detect abnormal logins or abuse;",
    "2.3 To improve the product through de-identified analytics.",
    "3. Storage & Protection",
    "3.1 Data is stored in secured cloud environments with encrypted transport and storage;",
    "3.2 Data is retained only as long as necessary for the service purpose;",
    "3.3 Without your consent we do not sell or rent your personal information to third parties, except as required by law.",
    "4. Your Rights",
    "4.1 You may review and edit your profile and pet memories anytime after signing in;",
    "4.2 To delete your account and related data, contact support@aiabw.com.",
    "5. Children",
    "Users under 14 must use the Platform under a guardian's supervision; guardians are responsible for minors' usage.",
    "6. Policy Updates",
    "This policy may be updated from time to time and will be announced on the Platform; material changes will be notified prominently.",
  ].join("\n"),
  goodsTitle: "Virtual Goods & Recharge Rules",
  goodsBody: "",
};

fs.writeFileSync("messages/en.json", JSON.stringify(en, null, 2) + "\n", "utf8");
console.log("en.json base updated (goodsBody placeholder)");
