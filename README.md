# nav

单人个人导航 / 浏览器起始页（公开 + 私有双层链接）。Cloudflare Workers + D1，域名 `nav.oneboy.app`。

Monorepo：
- `worker/` — Hono Worker 后端（D1 schema 与迁移、鉴权、三组 API、setup 流程）
- `web/` — React + Vite 前端（子单 B 开发中，目前为占位）

## 本地开发

```bash
pnpm install
cp worker/.dev.vars.example worker/.dev.vars   # 填入本地 SESSION_SECRET / SETUP_SECRET
pnpm dev          # 同时起 worker (wrangler dev) 与 web (vite)
```

`worker/.dev.vars` 与真实密钥永不入库（`.gitignore` 已排除）。

## 测试 / 校验

```bash
pnpm typecheck    # web + worker
pnpm test         # worker 单测（vitest，真 SQLite 内存库跑迁移与 API 契约）
pnpm lint && pnpm format:check
```

## 部署

合并 `main` 后 GitHub Actions（`.github/workflows/deploy.yml`）自动部署 Cloudflare。
需要在仓库 Secrets 配置（见 PR 说明，凭证不写入代码 / issue / 评论）：

| Secret                  | 用途                       |
| ----------------------- | -------------------------- |
| `CLOUDFLARE_API_TOKEN`  | wrangler 部署              |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户            |
| `SESSION_SECRET`        | 会话签名密钥（≥16 位随机） |
| `SETUP_SECRET`          | setup 初始化令牌           |

`worker/wrangler.toml` 中的 `CLOUDFLARE_ACCOUNT_ID_PLACEHOLDER`、`D1_DATABASE_ID_PLACEHOLDER` 需替换为实际值（或改用 wrangler 部署时的环境注入）。

## 初始化（setup）

线上首次部署、库中无账号时开放 setup：`POST /api/auth/setup`（header `X-Setup-Secret`）创建唯一所有者账号，创建后 setup 永久关闭，不设注册接口。

## API 契约

见 `docs/api-contract.md`（与前端冻结的 DTO 清单）。
