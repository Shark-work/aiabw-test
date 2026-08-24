// 品牌名统一：代码中 Aibi World / Abi World → AIABW（宠物名/域名 aiabw.com 保留）
const fs = require("fs");
const files = [
  "src/app/api/agent/daily-digest/route.ts",
  "src/app/api/gacha/draw/route.ts",
  "src/app/api/pet/buy/route.ts",
  "src/app/[locale]/pets/page.tsx",
  "src/app/[locale]/layout.tsx",
  "src/lib/agent-profile.ts",
  "src/lib/agent-psychology.ts",
  "src/lib/handbook.ts",
  "src/lib/pet-config.ts",
  "src/lib/utils.ts",
];
let total = 0;
for (const f of files) {
  const c = fs.readFileSync(f, "utf8");
  const out = c.split("Aibi World").join("AIABW").split("Abi World").join("AIABW");
  if (out !== c) {
    fs.writeFileSync(f, out, "utf8");
    const n = (c.match(/Aibi World|Abi World/g) || []).length;
    total += n;
    console.log(f, "->", n, "replaced");
  }
}
console.log("total:", total);
