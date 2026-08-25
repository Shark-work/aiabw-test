# 运营与安全脚本使用说明

> 部署完成后按以下顺序初始化站长账号与安全配置。

## 1. 将第一个账号设为管理员

```bash
node scripts/make-admin.cjs <你的邮箱>
```

> 将指定邮箱的 `role` 置为 `admin`，随后即可访问 `https://www.aiabw.com/admin/dashboard`。

## 2. 修改管理员密码

```bash
node scripts/change-admin-password.cjs <邮箱> <新密码>
```

> 仅允许修改 `role = 'admin'` 的账号密码；使用与登录一致的安全哈希（scrypt）。

## 3. 新增管理员

```bash
node scripts/add-admin.cjs <新邮箱> <密码>
```

> 邮箱不存在则创建 `role = 'admin'` 的新用户；已存在则提示（不会覆盖）。

## 4. 解锁被锁定的账号

```bash
node scripts/unlock-user.cjs <邮箱>
```

> 同一账号连续 5 次密码错误会被锁定 30 分钟（`users.locked_until`），
> 误锁 / 客诉时用此脚本立即解锁。

---

## 后台安全机制（部署后自动生效）

| 机制 | 说明 |
|---|---|
| 登录频率限制 | 同一 IP 1 分钟最多 5 次登录，超限返回 429「尝试次数过多，请 60 秒后再试」 |
| 账户锁定 | 同一账号连续 5 次密码错误 → 锁定 30 分钟；成功登录自动解锁 |
| 验证码 | 同一 IP 累计失败 10 次 → 要求数学验证码（如「3 + 5 = ?」） |
| 登录审计 | 每次失败写入 `login_attempts`（ip / email / attempted_at），保留最近 30 分钟用于判定与审计 |
| 后台会话时效 | `/api/admin/*` 校验 `last_login_at` 超过 24 小时 → 401 `reauth`，前端跳转登录页并带 `?reauth=true` |
| 管理员管理 | `/admin/settings/admins`：查看/修改密码/新增管理员/解锁；禁止删除自己的管理员身份 |

## 验证建议

```bash
# 新增一个测试管理员
node scripts/add-admin.cjs testadmin@example.com TestPass123
# 用该账号连续输错 5 次密码 → 应提示账号锁定
# 同 IP 1 分钟内第 6 次登录 → 应返回 429
# 修改密码后新密码可正常登录
node scripts/change-admin-password.cjs testadmin@example.com NewPass456
```
