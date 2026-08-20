// Decode the __next_f flight payload and search for the provider's locale prop.
// Usage: node scripts/verify-flight.cjs <url>
(async () => {
  const h = await (await fetch(process.argv[2] || "https://www.aiabw.com/zh")).text();
  const pushes = [];
  const re = /self\.__next_f\.push\(\[1,"((?:\\.|[^"])*)"\]\)/g;
  let m;
  while ((m = re.exec(h))) pushes.push(m[1]);
  if (!pushes.length) { console.log("no flight pushes found"); return; }
  let flight = "";
  for (const p of pushes) { try { flight += JSON.parse('"' + p + '"'); } catch {} }
  const zh = flight.indexOf('"locale":"zh"') >= 0;
  const en = flight.indexOf('"locale":"en"') >= 0;
  console.log("flight_len=" + flight.length + " locale_zh=" + zh + " locale_en=" + en);
  const i = flight.indexOf('"locale"');
  if (i >= 0) console.log("ctx=" + JSON.stringify(flight.slice(Math.max(0, i - 40), i + 60)));
})().catch((e) => { console.error("ERR " + e.message); process.exit(2); });
