# 域名与 HTTPS 配置文档（艾比世界 Phase 12）

> 适用：`aiabw.com` 正式域名接入 Vercel（含中国优化端点与 Cloudflare 可选接入）。
> 上游：`VERCEL_DEPLOY.md`（部署主流程）→ 本文档（域名/HTTPS 专项细节）；验收清单 `CHECKLIST.md` §5/§6。
> 代码单一数据源：`src/lib/site.ts` —— `SITE_URL` 默认值 = `https://www.aiabw.com`，即 **www 为主域（canonical）**。

---

## 1. 域名规划总览

| 域名 | 角色 | 记录类型 | 记录值 | 说明 |
| --- | --- | --- | --- | --- |
| `www.aiabw.com` | **主站（canonical）** | CNAME | `cname-china.vercel-dns.com` | 与 `SITE_URL` 默认值一致；sitemap/OG/canonical 全部输出此域 |
| `aiabw.com` | 裸域跳转 | A | `76.227.212.86` | Vercel 侧配置 308 → `https://www.aiabw.com` |

**为什么 www 为主域**：`src/lib/site.ts` 的 `SITE_URL` 默认值就是 `https://www.aiabw.com`，SEO 输出（canonical/hreflang/sitemap/OG）以此为基准；裸域仅承担跳转，避免双域并存导致 SEO 权重分散与 Cookie 域割裂。

**端点选择（中国优化 vs 全球）**：

| 端点 | CNAME（子域） | A 记录（裸域） | 适用 |
| --- | --- | --- | --- |
| 中国优化（本文默认） | `cname-china.vercel-dns.com` | `76.227.212.86` | 域名已完成 **ICP 备案**，面向中国大陆访问优化 |
| 全球 | `cname.vercel-dns.com` | `76.76.21.21` | 未备案域名 / 面向海外 |

> ⚠️ **ICP 备案前提**：中国优化端点面向已备案域名；未备案域名使用中国大陆优化线路可能被运营商拦截或解析异常。未备案时请改用全球端点。**最终以 Vercel Dashboard → Domains 页面实际显示的记录值为准**（Dashboard 会按项目设置给出应配置的值）。

## 2. DNS 记录配置（DNS 服务商侧）

> 在哪配置 = 谁持有域名的 **NS（权威 DNS）**：用注册商默认 DNS 就在注册商面板配；已接入 Cloudflare 就在 Cloudflare 面板配（此时注册商面板的记录不生效）。

### 2.1 必配两条记录

| 主机记录 | 类型 | 值 | TTL |
| --- | --- | --- | --- |
| `www` | CNAME | `cname-china.vercel-dns.com` | 300s（切换期用短 TTL，稳定后可调回 600/3600） |
| `@`（裸域） | A | `76.227.212.86` | 300s |

### 2.2 配置前检查（避免隐性冲突）

| 检查项 | 要求 | 原因 |
| --- | --- | --- |
| 同名旧记录 | 删除 `www` / `@` 上残留的旧 A / CNAME / 停放页记录 | 同主机记录多值会轮询解析，部分用户打到旧服务器 |
| AAAA（IPv6） | 删除指向他处的 AAAA；除非 Vercel Dashboard 另行提供 | IPv6 客户端优先走 AAAA，指外 = 绕过 Vercel |
| CAA | 若设置过 CAA，须含 `0 issue "letsencrypt.org"`；从未设置则无需动 | 未放行的 CAA 会直接阻断 Vercel 签发 Let's Encrypt 证书 |
| NS 归属 | `nslookup -type=NS aiabw.com` 确认权威 DNS 是哪一家 | 记录建在错误的面板 = 永远不生效（见 §7 排查 3） |

## 3. Vercel 域名绑定步骤

1. Vercel Dashboard → 项目 `aiabw` → **Settings → Domains**。
2. 输入 `www.aiabw.com` → **Add**。Vercel 立即显示期望的 DNS 记录（CNAME）与当前检测状态。
3. 再输入 `aiabw.com` → **Add**。Vercel 识别为裸域后给出 A 记录指引，并提供 **Redirect to www.aiabw.com** 选项 —— **勾选它**（裸域仅跳转，见 §1）。
4. 按 §2 在 DNS 服务商处配好两条记录，回到 Domains 页点 **Refresh** 触发重新检测。
5. 检测通过 → Vercel 自动向 Let's Encrypt 申请证书（通常 1–10 分钟，最长数小时），两个域名**各自独立签发**一张证书（SAN 覆盖对应域名）。
6. 最终状态核对：

| Dashboard 状态 | 含义 | 动作 |
| --- | --- | --- |
| `Valid Configuration` | DNS 已命中，证书已签发或签发中 | 等证书 Ready，进入 §6 验证 |
| `Pending` / 证书签发中 | DNS 已过，证书在签发 | 等待；>30 分钟见 §7 排查 1 |
| `Invalid Configuration` | DNS 检测不通过 | 按 §7 排查 1/3 逐项核对 |

> 证书续期全自动（Let's Encrypt 90 天周期，Vercel 到期前自动 renew），无需人工介入；保持 DNS 记录稳定即可。

## 4. 使用 Cloudflare（可选）

> 不接入 Cloudflare 时跳过本节（记录建在注册商/其他 DNS 商即可）。接入后 **NS 切到 Cloudflare**，§2 的两条记录建在 Cloudflare 面板。

### 4.1 SSL/TLS 模式（必须 Full (Strict)）

Cloudflare → 域名 → **SSL/TLS → Overview**：

| 模式 | 用户→CF | CF→Vercel 回源 | 结论 |
| --- | --- | --- | --- |
| Off | HTTP | HTTP | ❌ 全链路明文，禁用 |
| Flexible | HTTPS | **HTTP** | ❌ **禁用**：Vercel 对 HTTP 请求一律 308 回 HTTPS → **重定向循环**（ERR_TOO_MANY_REDIRECTS） |
| Full | HTTPS | HTTPS（不校验源证书） | 可用但不推荐（容忍源站证书异常） |
| **Full (Strict)** | HTTPS | HTTPS + **校验源证书** | ✅ **必须选此项**：Vercel 已为域名签发有效 Let's Encrypt 证书，满足严格校验 |

### 4.2 代理模式（灰云 vs 橙云）

| 模式 | 行为 | 取舍 |
| --- | --- | --- |
| **DNS only（灰云，推荐）** | Cloudflare 仅做权威 DNS，流量直连 Vercel 边缘 | ✅ Vercel 域名校验与证书签发零干扰；无双层 CDN 叠加；排障最简单 |
| Proxied（橙云） | CF 边缘终止 TLS，再回源 Vercel | 获得 CF WAF/CDN 能力；但 Vercel DNS 检测会看到 CF 的 IP（Dashboard 可能提示 `Invalid Configuration`，证书一般仍可通过 HTTP-01 挑战透传签发）；双层 CDN 可能增加延迟；**排障时先切回灰云** |

**橙云模式的附加要求**：
- SSL/TLS 仍为 **Full (Strict)**（见 §4.1，Flexible 必循环）；
- **SSL/TLS → Edge Certificates → Always Use HTTPS**：开启（用户侧 HTTP 直接在 CF 边缘跳 HTTPS）；
- 域名跳转（裸域 → www）**只在 Vercel 一层配置**（§3 第 3 步），不要在 Cloudflare Rules 里再配一条相向/同向规则，两层跳转互打也会产生循环。

## 5. DNS 配置检查清单

> 逐条打勾；全部通过后再做 §6 验证。对应 `CHECKLIST.md` §5/§6 的展开版。

- [ ] Vercel → Settings → Domains 已添加 `www.aiabw.com`
- [ ] 已添加 `aiabw.com`，并设置 **Redirect to www.aiabw.com**
- [ ] `www` 的 CNAME = `cname-china.vercel-dns.com`（未备案域名：`cname.vercel-dns.com`，以 Dashboard 显示为准）
- [ ] `@` 的 A 记录 = `76.227.212.86`（未备案域名：`76.76.21.21`）
- [ ] `www` / `@` 上无残留的旧 A / CNAME / 停放记录
- [ ] 无指向他处的 AAAA 记录
- [ ] CAA 记录（如存在）已放行 `letsencrypt.org`
- [ ] 两条记录 TTL = 300s（切换期）
- [ ] 已确认 NS 归属，记录建在正确的 DNS 面板
- [ ] （用 Cloudflare 时）SSL/TLS 模式 = **Full (Strict)**
- [ ] （用 Cloudflare 时）代理模式已决策：推荐灰云；橙云则已开 Always Use HTTPS 且跳转仅在 Vercel 层
- [ ] Vercel Dashboard 两个域名均 `Valid Configuration` 且证书已 Ready
- [ ] `NEXT_PUBLIC_SITE_URL` / `NEXT_PUBLIC_APP_URL` = `https://www.aiabw.com`，改后已 **Redeploy**
- [ ] §6 HTTPS 验证全部通过

## 6. HTTPS 验证步骤

> Windows PowerShell 注意：`curl` 是 `Invoke-WebRequest` 别名，参数不兼容 —— 统一用 **`curl.exe`**（Windows 10+ 自带）。DNS 查询用 `nslookup` 或 `Resolve-DnsName`。

### 6.1 命令行验证（curl + nslookup）

| # | 命令 | 期望结果 |
| --- | --- | --- |
| 1 | `nslookup www.aiabw.com` | 解析出 CNAME 链 → `…vercel-dns.com`，最终 A 记录为 Vercel IP |
| 2 | `nslookup aiabw.com` | A 记录 = `76.227.212.86`（中国优化）或 `76.76.21.21`（全球） |
| 3 | `curl.exe -sI https://www.aiabw.com` | `HTTP/2 200`，响应头含 `server: Vercel` |
| 4 | `curl.exe -sI http://www.aiabw.com` | `HTTP/1.1 308`，`location: https://www.aiabw.com/…`（Vercel 默认强制 HTTPS） |
| 5 | `curl.exe -sI https://aiabw.com` | `308`，`location: https://www.aiabw.com/`（裸域 → 主域） |
| 6 | `curl.exe -sI http://aiabw.com` | `308`（一跳或两跳，最终落到 `https://www.aiabw.com/`） |
| 7 | `curl.exe -vI https://www.aiabw.com 2>&1 \| Select-String "subject:|issuer:|expire"` | 证书 `issuer` 含 **Let's Encrypt**（R10/R11/E1 等），`subject` 覆盖对应域名，未过期 |

全球传播核对（部分地区打不开时）：`https://dnschecker.org` 分别查 `www.aiabw.com`（CNAME）与 `aiabw.com`（A），大部分节点命中即正常。

### 6.2 浏览器验证

- [ ] 地址栏访问 `https://www.aiabw.com` → **锁标志**，点击查证书：颁发者 = Let's Encrypt，SAN 覆盖当前域名，有效期在 90 天周期内
- [ ] 访问 `http://aiabw.com`、`http://www.aiabw.com`、`https://aiabw.com` 三个入口 → 最终地址栏均为 `https://www.aiabw.com/…`
- [ ] 用**无痕窗口**做上述跳转测试（旧 301/308 会被浏览器持久缓存，普通窗口可能误导判断）
- [ ] F12 → Console：**无 Mixed Content 警告**（本仓素材均为相对路径/Blob https，理论零混合内容；出现警告 = 某资源被写死 http，需修代码而非 DNS）
- [ ] 抽查关键页：`/zh`（首页艾比区块）、`/zh/codex`、`/zh/supply`、登录/注册页
- [ ] （可选）SSL Labs 体检：`https://www.ssllabs.com/ssltest/analyze.html?d=www.aiabw.com` → 评级 A 及以上

### 6.3 上线回归（打生产，全链路）

```powershell
$env:SMOKE_BASE="https://www.aiabw.com"; node scripts/smoke-aibi-frontend.mjs
```

期望 `=== Phase 5-11 smoke: 42/42 passed ===`（验收口径同 `VERCEL_DEPLOY.md` §3 第 3 步）。

## 7. 常见失败排查

| # | 现象 | 最可能原因 | 排查 / 解决 |
| --- | --- | --- | --- |
| 1 | 证书一直未签发：Dashboard `Invalid Configuration` 或 `Pending` >30 分钟 | ① DNS 记录值不符（含橙云遮蔽真实记录）；② CAA 未放行 Let's Encrypt；③ 残留 AAAA/旧 A 记录；④ 记录建错了 DNS 面板 | 按 §2.2 四项逐条核对；橙云先切**灰云**让 Vercel 直接验证，证书 Ready 后再决定要不要回橙云；Domains 页点 **Refresh**；仍失败 → 删除域名重新 Add 触发重新签发 |
| 2 | `ERR_TOO_MANY_REDIRECTS` 重定向循环 | ① Cloudflare SSL/TLS = **Flexible**（CF→Vercel 走 HTTP，Vercel 308 回 HTTPS，死循环）；② Vercel 跳转与 Cloudflare Rules 跳转互打 | SSL/TLS 改 **Full (Strict)**（§4.1）；跳转规则只保留 Vercel 一层（§4.2）；改完用无痕窗口复测（浏览器缓存旧 301 会假性复现） |
| 3 | DNS 改动不生效 / 部分地区打不开 | ① TTL/传播未完成；② 本机 DNS 缓存；③ 记录建在错误面板（NS 已切 Cloudflare 却还在注册商面板改）；④ 未备案域名使用中国优化端点被运营商拦截 | `dnschecker.org` 看全球传播；本机 `ipconfig /flushdns` 后 `nslookup` 复测；`nslookup -type=NS aiabw.com` 确认权威 DNS 归属；未备案 → 改全球端点（§1） |
| 4 | Cloudflare 下页面/资源还是旧版本 | 橙云边缘缓存了旧响应（灰云无此问题） | Cloudflare → **Caching → Configuration → Purge Everything**（或按 URL Purge）；排障期开 **Development Mode**（暂停缓存 3 小时）；浏览器侧配合无痕窗口 |
| 5 | 证书 SAN 只覆盖一个域名，另一个报证书错误 | 只 Add 了一个域名，或另一个验证未通过 | 两个域名都必须在 Vercel 添加且状态 Valid（§3），证书按域名各自签发 |
| 6 | `https://` 能开但 `http://` 不跳转 | 流量未经过 Vercel（DNS 指外）；或橙云下 CF 边缘未开强制跳转 | `curl.exe -sI` 看 `server` 头是否 `Vercel`；橙云开 **Always Use HTTPS**（§4.2） |

## 8. 域名变更的联动项

| 项 | 配置 | 说明 |
| --- | --- | --- |
| SEO 站点 URL | `NEXT_PUBLIC_SITE_URL` / `NEXT_PUBLIC_APP_URL` = `https://www.aiabw.com` | 影响 sitemap/OG/canonical/hreflang（`src/lib/site.ts`）；**NEXT_PUBLIC_ 变量内联进 bundle，改后必须 Redeploy**（`VERCEL_DEPLOY.md` §2） |
| Stripe Webhook | Dashboard 端点 = `https://www.aiabw.com/api/stripe/webhook` | 换域名后旧端点收不到事件，须同步改（`docs/stripe-integration.md` §4） |
| Stripe 支付回跳 | **无需配置** | success/cancel URL 按请求 origin 动态构建（`create-checkout` 路由取 `new URL(req.url).origin`），用户从哪个域名进来就回跳哪个域名 |
| 码支付回调 | `XORPAY_NOTIFY_URL`（如启用）= `https://www.aiabw.com/api/pay/notify` | 换域名后同步改（`CHECKLIST.md` §5） |
| 本地开发 | 不受影响 | Stripe CLI 转发 localhost、dev 库均与正式域名无关 |

## 9. 参考资料

- Vercel 自定义域名：`https://vercel.com/docs/projects/domains`
- Vercel DNS 记录指引（A/CNAME 以项目 Dashboard 显示为准）：`https://vercel.com/docs/domains/working-with-dns`
- Cloudflare SSL/TLS 模式说明：`https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/`
- DNS 全球传播查询：`https://dnschecker.org`
- SSL 体检：`https://www.ssllabs.com/ssltest/`
- Let's Encrypt 与 CAA：`https://letsencrypt.org/docs/caa/`

---

_创建：2026-09-30 · Phase 12（域名与 HTTPS 配置文档）。_




