// Asset size budget gate: fails if any file under public/ exceeds ASSET_MAX_KB (default 100 KB).
// Guards against 33MB-background-style regressions. Called from CI (resource-check / PR) and locally:
//   node scripts/check-assets.js
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const publicDir = path.join(root, "public");
const maxBytes = Number(process.env.ASSET_MAX_KB ?? 100) * 1024;

const offenders = [];
function walk(dir, rel = "") {
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const abs = path.join(dir, name);
    const relPath = rel ? `${rel}/${name}` : name;
    const st = fs.lstatSync(abs);
    if (st.isDirectory()) walk(abs, relPath);
    else if (st.size > maxBytes) offenders.push({ relPath, kb: st.size / 1024 });
  }
}
walk(publicDir);

if (offenders.length) {
  console.error(
    `✗ ${offenders.length} asset(s) exceed the ${maxBytes / 1024} KB budget (public/):`,
  );
  for (const o of offenders) console.error(`  - ${o.relPath}  ${o.kb.toFixed(1)} KB`);
  console.error("Optimize them (see scripts/optimize-images.mjs) or raise ASSET_MAX_KB deliberately.");
  process.exit(1);
}
console.log(`✓ all public assets within the ${maxBytes / 1024} KB budget`);
