// 全站统一联系方式 · 契约测试
// 覆盖：
//   1) CONTACT_INFO 常量值与派生链接（tencent:// / mailto:）
//   2) 旧邮箱 support@aiabw.com 全站清零扫描（src/ + messages/）
//   3) 展示层接线：页脚 / 悬浮客服 / 法律页模块 / 联系页 / FAQ / 订阅页 / 登录注册 / 设置页 / 导航
//   4) i18n 双语 parity（contact 命名空间 + support/login/register/settings/subscription/nav 新 key）
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const config = await import("../src/lib/config.ts");

// === 1) 常量与派生链接 ========================================================
test("contact: CONTACT_INFO exact values", () => {
  const c = config.CONTACT_INFO;
  assert.equal(c.qqGroup, "1005445619");
  assert.equal(
    c.qqGroupJoinUrl,
    "https://qm.qq.com/cgi-bin/qm/qr?k=Hf0R51LVoGSeLQN3X8kc-BLzZuAx8YAT&jump_from=webapi&authKey=z2houMdX3NE9PijBT5Cek6RUhJVJnOngHw+R+QCvWF64RD0MZtSjaz9UQsd+z2uN"
  );
  assert.equal(c.customerServiceQQ, "1206309834");
  assert.equal(c.customerServiceEmail, "1206309834@qq.com");
  assert.equal(c.xHandle, "@Aiabw_com");
  assert.equal(c.xUrl, "https://x.com/Aiabw_com");
  assert.equal(c.email, "aiabw@outlook.com");
});

test("contact: derived URLs follow spec formats", () => {
  assert.equal(
    config.QQ_SERVICE_URL,
    "tencent://message/?uin=1206309834&Site=&Menu=yes"
  );
  assert.equal(config.EMAIL_URL, "mailto:aiabw@outlook.com");
  // QQ 群加群链接必须为腾讯官方 qm.qq.com 域名
  assert.ok(
    config.CONTACT_INFO.qqGroupJoinUrl.startsWith("https://qm.qq.com/"),
    "qqGroupJoinUrl 必须是腾讯官方加群页"
  );
  // SOCIAL.x 默认值同步为 @Aiabw_com（env 可覆盖，但测试环境下必须为新账号）
  assert.equal(config.SOCIAL.x, "https://x.com/Aiabw_com");
});

// === 2) 旧联系方式清零 ========================================================
test("contact: legacy support@aiabw.com fully removed from src/ and messages/", () => {
  const roots = ["src", "messages"].map((r) =>
    fileURLToPath(new URL(`../${r}`, import.meta.url))
  );
  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name === "node_modules" || name === ".next") continue;
        walk(p);
      } else if (/\.(ts|tsx|json|mjs|cjs)$/.test(name)) {
        const text = readFileSync(p, "utf8");
        if (text.includes("support@aiabw.com")) offenders.push(p);
      }
    }
  };
  for (const r of roots) walk(r);
  assert.deepEqual(offenders, [], `旧邮箱残留: ${offenders.join(", ")}`);
});

test("contact: no leftover 'search group ID to join' plain text anywhere", () => {
  const roots = ["src", "messages"].map((r) =>
    fileURLToPath(new URL(`../${r}`, import.meta.url))
  );
  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name === "node_modules" || name === ".next") continue;
        walk(p);
      } else if (/\.(ts|tsx|json|mjs|cjs)$/.test(name)) {
        const text = readFileSync(p, "utf8");
        if (text.includes("搜索群号加入")) offenders.push(p);
      }
    }
  };
  for (const r of roots) walk(r);
  assert.deepEqual(offenders, [], `"搜索群号加入"残留: ${offenders.join(", ")}`);
});

// === 3) 展示层接线 ============================================================
test("contact: footer renders all 4 channels from CONTACT_INFO", () => {
  const s = read("src/components/layout/Footer.tsx");
  assert.match(s, /CONTACT_INFO,\s*EMAIL_URL,\s*QQ_SERVICE_URL/);
  assert.match(s, /CONTACT_INFO\.qqGroupJoinUrl/);
  assert.match(s, /socialQqGroup/);
  assert.match(s, /socialQqService/);
  assert.match(s, /socialX/);
  assert.match(s, /socialEmail/);
  assert.match(s, /QQIcon/);
  assert.match(s, /MailIcon/);
  assert.ok(!s.includes("TelegramIcon"), "页脚不再展示 Telegram");
});

test("contact: floating support panel renders all 4 channels", () => {
  const s = read("src/components/layout/FloatingSupport.tsx");
  assert.match(s, /QQ_SERVICE_URL/);
  assert.match(s, /EMAIL_URL/);
  assert.match(s, /CONTACT_INFO\.xUrl/);
  assert.match(s, /socialQqGroupHint/);
  assert.match(s, /CONTACT_INFO\.qqGroupJoinUrl/);
  assert.match(s, /socialQqGroupJoin/);
  assert.ok(!s.includes("SOCIAL.telegram"), "悬浮面板不再展示 Telegram");
});

test("contact: SupportContact module renders all 4 channels", () => {
  const s = read("src/components/layout/SupportContact.tsx");
  assert.match(s, /QQ_SERVICE_URL/);
  assert.match(s, /EMAIL_URL/);
  assert.match(s, /CONTACT_INFO\.xUrl/);
  assert.match(s, /CONTACT_INFO\.qqGroupJoinUrl/);
  assert.match(s, /socialQqGroup/);
  assert.ok(!s.includes("TelegramIcon"), "法律页模块不再展示 Telegram");
});


test("contact: /contact page is a 4-card grid with work hours", () => {
  const s = read("src/app/[locale]/contact/page.tsx");
  assert.match(s, /getTranslations\("contact"\)/);
  for (const k of ["qqGroupTitle", "qqServiceTitle", "xTitle", "emailTitle", "workHours", "backHome"]) {
    assert.ok(s.includes(`t("${k}")`), `/contact 缺少 ${k}`);
  }
  assert.match(s, /QQ_SERVICE_URL/);
  assert.match(s, /EMAIL_URL/);
  assert.match(s, /CONTACT_INFO\.xUrl/);
  assert.match(s, /CONTACT_INFO\.qqGroupJoinUrl/);
  assert.ok(!s.includes("href: null"), "QQ群卡片已改为可点击加群链接");
  assert.match(s, /sm:grid-cols-2/, "四宫格双列布局");
  assert.match(s, /QQIcon|MailIcon|XIcon/);
});

test("contact: FAQ page mounts SupportContact module", () => {
  const s = read("src/app/[locale]/faq/page.tsx");
  assert.match(s, /import\s*\{\s*SupportContact\s*\}/);
  assert.match(s, /<SupportContact\s*\/>/);
});

test("contact: subscribe page FAQ has customer-service entry", () => {
  const s = read("src/components/subscription/subscribe-client.tsx");
  assert.match(s, /QQ_SERVICE_URL/);
  assert.match(s, /CONTACT_INFO\.customerServiceQQ/);
  assert.match(s, /t\("faqSupport"\)/);
  assert.match(s, /href="\/contact"/);
});

test("contact: login/register pages have need-help entry", () => {
  for (const p of ["src/app/[locale]/login/page.tsx", "src/app/[locale]/register/page.tsx"]) {
    const s = read(p);
    assert.match(s, /href="\/contact"/, `${p} 缺少 /contact 链接`);
    assert.match(s, /t\("needHelp"\)/, `${p} 缺少 needHelp`);
  }
});

test("contact: settings page has feedback & help section", () => {
  const s = read("src/app/[locale]/settings/page.tsx");
  assert.match(s, /t\("supportTitle"\)/);
  assert.match(s, /t\("supportDesc"\)/);
  assert.match(s, /t\("supportAction"\)/);
  assert.match(s, /QQ_SERVICE_URL/);
  assert.match(s, /href="\/contact"/);
});

test("contact: site header nav includes /contact entry", () => {
  const s = read("src/components/layout/SiteHeader.tsx");
  assert.match(s, /\{\s*href:\s*"\/contact",\s*label:\s*t\("contact"\)\s*\}/);
});

// === 4) i18n 双语 parity ======================================================
test("contact i18n: contact namespace keys identical in zh/en", () => {
  const zh = JSON.parse(read("messages/zh.json"));
  const en = JSON.parse(read("messages/en.json"));
  assert.ok(zh.contact && en.contact, "contact 命名空间必须存在");
  assert.deepEqual(Object.keys(zh.contact).sort(), Object.keys(en.contact).sort());
  for (const k of Object.keys(zh.contact)) {
    assert.ok(String(zh.contact[k]).length > 0, `zh contact.${k} 为空`);
    assert.ok(String(en.contact[k]).length > 0, `en contact.${k} 为空`);
  }
});

test("contact i18n: new support/login/register/settings/subscription/nav keys in both locales", () => {
  const zh = JSON.parse(read("messages/zh.json"));
  const en = JSON.parse(read("messages/en.json"));
  for (const j of [zh, en]) {
    for (const k of ["socialQqGroup", "socialQqGroupHint", "socialQqGroupJoin", "socialQqService", "socialEmail"]) {
      assert.ok(j.support[k], `support.${k} 缺失`);
    }
    assert.ok(j.login.needHelp, "login.needHelp 缺失");
    assert.ok(j.register.needHelp, "register.needHelp 缺失");
    for (const k of ["supportTitle", "supportDesc", "supportAction"]) {
      assert.ok(j.settings[k], `settings.${k} 缺失`);
    }
    assert.ok(j.subscription.faqSupport, "subscription.faqSupport 缺失");
    assert.ok(j.nav.contact, "nav.contact 缺失");
  }
  // 中文环境展示 QQ 群号与客服号
  assert.ok(zh.support.socialQqGroup.includes("1005445619"));
  assert.ok(zh.support.socialQqService.includes("1206309834"));
  assert.ok(zh.support.socialEmail.includes("aiabw@outlook.com"));
  // 加群行动文案已替换"搜索群号加入"，群号保留为辅助说明
  assert.equal(zh.contact.qqGroupAction, "一键加群");
  assert.equal(en.contact.qqGroupAction, "Join Group");
  assert.equal(zh.support.socialQqGroupJoin, "加入群聊");
  assert.equal(en.support.socialQqGroupJoin, "Join Group");
  assert.ok(zh.contact.qqGroupDesc.includes("1005445619"), "群号保留为辅助说明");
  assert.ok(!zh.support.socialQqGroupHint.includes("搜索群号加入"));
});

test("contact i18n: legal pages use new email, not legacy one", () => {
  const zh = JSON.parse(read("messages/zh.json"));
  const en = JSON.parse(read("messages/en.json"));
  for (const j of [zh, en]) {
    for (const k of ["termsBody", "privacyBody", "goodsBody"]) {
      assert.ok(!j.legal[k].includes("support@aiabw.com"), `legal.${k} 仍含旧邮箱`);
      assert.ok(j.legal[k].includes("aiabw@outlook.com"), `legal.${k} 未替换为新邮箱`);
    }
    assert.ok(!j.pages.contactBody.includes("support@aiabw.com"));
    assert.ok(j.pages.contactBody.includes("aiabw@outlook.com"));
  }
});

