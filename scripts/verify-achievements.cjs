// 一次性验证：探索成就系统（roadmap 任务二，2026-09-23）
// 场景：
//  0) 未登录 GET /api/achievements → 401 SIGN_IN_REQUIRED
//  1) 注册新用户（欢迎礼包 +20）
//  2) 首次 POST /api/exploration/start → newlyUnlocked 含 first-explore(+5)
//  3) GET /api/achievements → 8 徽章列表/进度正确（explorer-10 1/10、master 1/7）
//  4) 重复 GET → 不重复解锁/入账（幂等）
//  5) 签到交叉验证积分余额 = 20 + 5 + 签到分（徽章积分确已入账 users.points）
//  6) 第二次探索 → 不重复解锁 first-explore
// 用法: node scripts/_tmp-verify-achievements.cjs [baseUrl]
const BASE = process.argv[2] || "http://localhost:3100";

function assert(cond, msg) {
  if (!cond) { console.error("FAIL: " + msg); process.exitCode = 1; }
  else console.log("PASS: " + msg);
}

(async () => {
  // 0) 未登录 401
  const unauth = await fetch(BASE + "/api/achievements");
  const unauthBody = await unauth.json().catch(() => ({}));
  assert(unauth.status === 401, "未登录 GET /api/achievements 应 401: " + unauth.status);
  assert(unauthBody.code === "SIGN_IN_REQUIRED", "401 应带 SIGN_IN_REQUIRED: " + JSON.stringify(unauthBody));

  // 1) 注册
  const email = `qaachv_${Date.now()}@test.aiabw`;
  const reg = await fetch(BASE + "/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "qapass2026" }),
  }).then((r) => r.json());
  assert(reg.ok === true && !!reg.token, "注册成功并返回 token: " + email);
  if (!reg.token) { console.error("FATAL", reg); process.exit(1); }
  const H = { Authorization: `Bearer ${reg.token}`, "Content-Type": "application/json" };

  // 2) 首次探索 → 即时解锁「初出茅庐」
  const start = await fetch(BASE + "/api/exploration/start", {
    method: "POST", headers: H, body: "{}",
  }).then((r) => r.json());
  assert(start.ok === true, "首次探索成功: " + JSON.stringify(start).slice(0, 120));
  const nu1 = Array.isArray(start.newlyUnlocked) ? start.newlyUnlocked : [];
  const fe = nu1.find((b) => b.id === "first-explore");
  assert(!!fe, "首次探索 newlyUnlocked 含 first-explore: " + JSON.stringify(nu1));
  assert(fe?.rewardPoints === 5 && fe?.emoji === "🌱", "first-explore 奖励 5 积分: " + JSON.stringify(fe));

  // 3) GET /api/achievements → 面板数据
  const a1 = await fetch(BASE + "/api/achievements", { headers: H }).then((r) => r.json());
  assert(a1.ok === true, "GET /api/achievements ok");
  assert(a1.totalCount === 8, "共 8 枚徽章: " + a1.totalCount);
  assert(a1.unlockedCount === 1, "已解锁 1 枚: " + a1.unlockedCount);
  const bFirst = a1.badges.find((b) => b.id === "first-explore");
  assert(bFirst?.unlocked === true && bFirst.progress === 1 && !!bFirst.unlockedAt, "first-explore 已解锁 1/1 含时间戳");
  const b10 = a1.badges.find((b) => b.id === "explorer-10");
  assert(b10?.unlocked === false && b10.progress === 1 && b10.target === 10, "explorer-10 进度 1/10 未解锁: " + JSON.stringify(b10));
  const bMaster = a1.badges.find((b) => b.id === "master");
  assert(bMaster?.progress === 1 && bMaster.target === 7, "master 进度 = 已解锁非 master 数 1/7: " + JSON.stringify(bMaster));
  const bWiki = a1.badges.find((b) => b.id === "wiki-collector");
  assert(bWiki && bWiki.progress >= 0 && bWiki.progress <= 5, "wiki-collector 进度在 0..5 区间: " + bWiki?.progress);
  assert(Array.isArray(a1.newlyUnlocked) && a1.newlyUnlocked.length === 0, "GET 不重复解锁: " + JSON.stringify(a1.newlyUnlocked));

  // 4) 重复 GET → 幂等（仍 1 枚）
  const a2 = await fetch(BASE + "/api/achievements", { headers: H }).then((r) => r.json());
  assert(a2.ok === true && a2.unlockedCount === 1, "重复 GET 幂等，仍解锁 1 枚: " + a2.unlockedCount);

  // 5) 签到交叉验证积分余额（20 欢迎 + 5 徽章 + 签到分）
  const chk = await fetch(BASE + "/api/user/checkin", {
    method: "POST", headers: H, body: "{}",
  }).then((r) => r.json());
  assert(chk.ok === true, "签到成功: " + JSON.stringify(chk).slice(0, 120));
  // checkin 响应：points = 入账后总额，pointsGain = 本次签到得分
  assert(
    typeof chk.points === "number" && chk.points === 25 + chk.pointsGain,
    `积分余额交叉验证: total(${chk.points}) = 20 欢迎 + 5 徽章 + ${chk.pointsGain} 签到分`,
  );

  // 6) 第二次探索 → 不重复解锁
  const start2 = await fetch(BASE + "/api/exploration/start", {
    method: "POST", headers: H, body: "{}",
  }).then((r) => r.json());
  if (start2.ok === true) {
    const nu2 = Array.isArray(start2.newlyUnlocked) ? start2.newlyUnlocked : [];
    assert(!nu2.some((b) => b.id === "first-explore"), "第二次探索不重复解锁 first-explore: " + JSON.stringify(nu2));
  } else {
    console.log("NOTE: 第二次探索被配额/其它拦截（非本功能范围），跳过: " + JSON.stringify(start2).slice(0, 120));
  }

  console.log(process.exitCode ? "=== RESULT: FAIL ===" : "=== RESULT: ALL PASS ===");
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
