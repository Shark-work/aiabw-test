import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildFallbackShareText,
  isSocialConfigured,
  oauth1Header,
  publishToWeibo,
  publishToTwitter,
  publishToTelegram,
  publishToSocialecho,
  postBreedShare,
} from "../src/lib/social-poster.ts";

const meta = {
  speciesName: "金毛寻回犬",
  rarity: "legendary",
  element: "fire",
  generation: 3,
  hashId: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
};

test("social: fallback text includes rarity & hashtags", () => {
  const text = buildFallbackShareText(meta);
  assert.ok(text.includes("传说"), "传说级文案");
  assert.ok(text.includes("金毛寻回犬"), "含物种名");
  assert.ok(text.includes("#艾比世界"), "主话题标签");
  assert.ok(text.includes("#传说宠物"), "稀有度话题标签");
  assert.ok(text.includes("第 3 代"), "含代数");

  const epic = buildFallbackShareText({ ...meta, rarity: "epic" });
  assert.ok(epic.includes("史诗"), "史诗级文案");
});

test("social: not configured when no credentials", () => {
  const cfg = isSocialConfigured();
  assert.equal(cfg.x, false);
  assert.equal(cfg.telegram, false);
  assert.equal(cfg.weibo, false);
});

test("social: publishToWeibo without token returns ok:false (no throw)", async () => {
  const r = await publishToWeibo("hello");
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /not configured/);
});

test("social: publishToWeibo success when fetch ok (mock)", async () => {
  process.env.WEIBO_ACCESS_TOKEN = "test-token";
  const orig = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ id: 1 }), { status: 200 });
  try {
    const r = await publishToWeibo("hello 微博");
    assert.equal(r.ok, true);
  } finally {
    global.fetch = orig;
    delete process.env.WEIBO_ACCESS_TOKEN;
  }
});

test("social: publishToWeibo failure (timeout) returns ok:false (no throw)", async () => {
  process.env.WEIBO_ACCESS_TOKEN = "test-token";
  const orig = global.fetch;
  global.fetch = async () => {
    throw new Error("fetch timeout");
  };
  try {
    const r = await publishToWeibo("hello");
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /timeout/);
  } finally {
    global.fetch = orig;
    delete process.env.WEIBO_ACCESS_TOKEN;
  }
});

test("social: publishToTwitter without any token returns ok:false (no throw)", async () => {
  const r = await publishToTwitter("hello");
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /not configured/);
});

test("social: publishToTelegram without token returns ok:false (no throw)", async () => {
  const r = await publishToTelegram("hello");
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /not configured/);
});

test("social: publishToTelegram success when fetch ok (mock)", async () => {
  process.env.TELEGRAM_BOT_TOKEN = "123:ABC";
  process.env.TELEGRAM_CHAT_ID = "-100123";
  const orig = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ ok: true }), { status: 200 });
  try {
    const r = await publishToTelegram("hello 电报");
    assert.equal(r.ok, true);
  } finally {
    global.fetch = orig;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  }
});

test("social: publishToTelegram failure (timeout) returns ok:false (no throw)", async () => {
  process.env.TELEGRAM_BOT_TOKEN = "123:ABC";
  process.env.TELEGRAM_CHAT_ID = "-100123";
  const orig = global.fetch;
  global.fetch = async () => {
    throw new Error("telegram timeout");
  };
  try {
    const r = await publishToTelegram("hello");
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /timeout/);
  } finally {
    global.fetch = orig;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  }
});

test("social: publishToSocialecho without key returns ok:false (no throw)", async () => {
  const r = await publishToSocialecho("hello");
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /not configured/);
});

test("social: publishToSocialecho uses configured key (mock success)", async () => {
  process.env.SOCIALECHO_KEY = "se-key";
  process.env.SOCIALECHO_X_ACCOUNT_ID = "x-account";
  const orig = global.fetch;
  global.fetch = async (url, init) => {
    assert.match(String(url), /socialecho/);
    const body = JSON.parse(String(init.body));
    assert.equal(body.accountId, "x-account");
    assert.equal(body.platform, "x");
    return new Response(JSON.stringify({ id: 1 }), { status: 200 });
  };
  try {
    const r = await publishToSocialecho("hello");
    assert.equal(r.ok, true);
  } finally {
    global.fetch = orig;
    delete process.env.SOCIALECHO_KEY;
    delete process.env.SOCIALECHO_X_ACCOUNT_ID;
  }
});

test("social: publishToTwitter prefers Socialecho when configured", async () => {
  process.env.SOCIALECHO_KEY = "se-key";
  process.env.SOCIALECHO_X_ACCOUNT_ID = "x-account";
  const orig = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ id: 1 }), { status: 200 });
  try {
    const r = await publishToTwitter("hello");
    assert.equal(r.ok, true, "Socialecho 通道优先");
  } finally {
    global.fetch = orig;
    delete process.env.SOCIALECHO_KEY;
    delete process.env.SOCIALECHO_X_ACCOUNT_ID;
  }
});

test("social: oauth1Header produces OAuth signature header", () => {
  const header = oauth1Header({
    method: "POST",
    url: "https://api.twitter.com/2/tweets",
    params: {},
    consumerKey: "ck",
    consumerSecret: "cs",
    token: "tk",
    tokenSecret: "ts",
  });
  assert.ok(header.startsWith("OAuth "), "OAuth 前缀");
  assert.ok(header.includes("oauth_signature="), "含签名");
  assert.ok(header.includes("oauth_version="), "含版本");
});

test("social: postBreedShare with no config resolves (posted:false, no throw)", async () => {
  // 模拟发帖失败场景：未配置凭证 → 整体不发帖但绝不抛错（繁育事务不受影响）
  const r = await postBreedShare(meta);
  assert.equal(r.posted, false);
  assert.equal(r.results.length, 0);
});

