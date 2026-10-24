对应 Multica 子单 ONE-168（父单 ONE-167）。后端全部与仓库骨架；前端由兄弟子单在 `web/` 开发。

## 改了什么

- **仓库骨架**：monorepo（`worker/` Hono + D1、`web/` 前端占位）、Workers Static Assets、`wrangler.toml` 含 D1 binding。
- **D1 schema 与迁移**（`worker/src/db/schema.sql`，全部 `IF NOT EXISTS / OR IGNORE`，可重复执行）：
  `users`、`passkey_credentials`、`sessions`、`login_attempts`、`challenges`、`categories`、`links`、`search_engines`、`settings`。links.icon_url 可空；点击计数、健康状态按 SPEC 预留不实现。
- **鉴权**（单人精简版，沿用 eNotify/Zeta 现行方案）：
  - 密码哈希：PBKDF2-SHA256 100k 迭代（eNotify 同款）
  - Passkey：`@simplewebauthn/server` v14（eNotify 同款库），凭证存 `passkey_credentials`
  - TOTP：SHA1/6 位/30s，WebCrypto 实现（eNotify 同款流程）
  - 会话：`nav_session` Cookie，HttpOnly / Secure / SameSite=Lax，HS256 JWT + `sessions` 表可吊销，7 天
  - 登录接口限流 + 连续失败锁定：5 次失败锁 15 分钟（`login_attempts`，按 username+IP）；`/2fa/verify` 同 tempToken 连错 5 次作废
  - **无注册接口**；setup 用 `X-Setup-Secret` 创建唯一所有者，创建后永久关闭
- **三组 API**（契约见 `docs/api-contract.md`，DTO 冻结清单在内）：
  - `GET /api/public`：只含公开分类+公开链接（private 分类下的 public 链接也按「取更严一方」不下发），可公开缓存
  - `GET /api/private`：未登录 401 `{"error":"unauthorized"}` + `Cache-Control: no-store`；已登录同结构全量数据，no-store
  - `/api/admin/*`：categories / links / search_engines / settings 的 CRUD 与排序更新，未登录一律 401 JSON
- **CI/Deploy**：`.github/workflows/ci.yml`（lint/format/typecheck/build/test）、`deploy.yml`（CI 绿后合并 main 自动 `wrangler deploy`，合并关口归用户）。

## 迁移与回滚

- 迁移：`worker/src/db/schema.sql`（幂等，读接口前自动 ensure）；空库可重复执行。
- 回滚：数据表结构简单，回滚即回退代码版本；无数据迁移脚本，删除表可 `DROP TABLE`（links 级联随 categories 删除）。

## 自测证据

- `pnpm typecheck`（web+worker）✅
- `pnpm test`：**17 passed / 0 failed**（vitest + 真 SQLite 内存库）：迁移幂等 ×3、公开/私有隔离与 401 契约 ×3、setup 生命周期与无注册 ×3、密码登录/锁住 ×3、密码+TOTP 登录 ×2、登录后访问/登出 ×2（另有 TOTP secret/uri 断言）
- `pnpm build`（web+worker）✅ `pnpm lint` / `pnpm format:check` ✅
- `wrangler dev` 实测：`/api/public` 无任何私有数据（含 private 分类下 public 链接）、`/api/private` 未登录 401 + no-store、setup 创建后关闭、密码登录 + TOTP 两步登录各走通、5 次失败后 429 锁定、passkey 注册 options 正常（浏览器侧断言需真实认证器，留待前端联调）

## 需要用户配置的 Secrets（凭证不入库）

`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`SESSION_SECRET`（≥16 位随机）、`SETUP_SECRET`；`wrangler.toml` 中 `CLOUDFLARE_ACCOUNT_ID_PLACEHOLDER` / `D1_DATABASE_ID_PLACEHOLDER` 需替换实际值。

## 与 eNotify/Zeta 的对齐说明

- WebAuthn/TOTP/密码哈希/会话签名均用 eNotify 现行库与算法，未新发明；唯一自研是 RFC6238 计算层（WebCrypto，eNotify 同源实现），未引入新第三方 TOTP 库。
- eNotify 用 KV 做会话/限流；本项目 SPEC 明确「不引入 KV 作主存储」，故 sessions / login_attempts / challenges 落 D1 表，结构已写入 schema。
- 找回路径（SPEC 第 4 节）：v1 对齐 eNotify「部署侧重置」做法——无邮件通道，owner 密码重置走 `X-Setup-Secret` 之外的运维路径（重置方式在后续子单/运维文档明确），不开放自助找回，避免引入邮件依赖。此处如需调整请父单拍板。

⚠️ 合并即自动部署，合并关口归用户；本 PR 停在待评审状态。
