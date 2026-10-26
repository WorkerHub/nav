# nav API 契约（冻结，ONE-168）

字段命名 camelCase。变更须回父单 ONE-167 由 Mike 裁决。

## 公开

### GET /api/public

200 JSON。只含 `visibility=public` 的分类与链接（分类内嵌其公开链接）；私有分类、私有链接、以及「private 分类下的 public 链接」（可见性取更严一方）完全不出现。响应 `Cache-Control: public, max-age=60`。

```json
{
  "categories": [
    {
      "id": "uuid",
      "name": "分类名",
      "icon": null,
      "sortOrder": 0,
      "links": [
        {
          "id": "uuid",
          "categoryId": "uuid",
          "title": "标题",
          "url": "https://…",
          "iconUrl": null,
          "description": null,
          "sortOrder": 0
        }
      ]
    }
  ],
  "searchEngines": [
    {
      "id": "uuid",
      "name": "Google",
      "urlTemplate": "https://www.google.com/search?q={q}",
      "icon": null,
      "sortOrder": 0,
      "isDefault": true
    }
  ],
  "settings": {
    "siteTitle": "nav",
    "backgroundUrl": "",
    "logoUrl": "",
    "theme": "system",
    "columns": 0
  }
}
```

## 私有

### GET /api/private

需有效会话 Cookie（`nav_session`，HttpOnly / Secure / SameSite=Lax）。未登录一律：
- 状态 `401`
- Body `{"error":"unauthorized"}`
- Header `Cache-Control: no-store`

已登录返回与 `/api/public` **同结构**的全量数据（公开 + 私有），`Cache-Control: no-store`。

## 鉴权（/api/auth/*）

| 方法 | 路径                   | 说明                                                                                                                                                                                                                         |
| ---- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET  | `/api/auth/setup`      | `{"enabled":true}` 表示可创建所有者                                                                                                                                                                                          |
| POST | `/api/auth/setup`      | header `X-Setup-Secret`；body `{username, password}`（password ≥ 8）→ 201 并下发会话，附 `tablePrefix` 与 `migrations:[{name,status}]`（账本迁移结果）；已有账号 → 403；表前缀冲突 → 409 `{"error":"table prefix conflict"}` |
| POST | `/api/auth/login`      | body `{username, password}` → `{success, user}`；若已启用 TOTP → `{requires2fa:true, tempToken}`；失败 401 `{"error":"invalid credentials","remainingAttempts":N}`；连续失败 5 次锁定 15 分钟 → 429                          |
| POST | `/api/auth/2fa/verify` | body `{tempToken, code}`（TOTP 6 位）→ 200 并下发会话；错误码 401                                                                                                                                                            |
| POST | `/api/auth/logout`     | 吊销当前会话                                                                                                                                                                                                                 |
| GET  | `/api/auth/session`    | 会话探测：`{"authenticated":true,"userId":…}`；未登录 401 JSON                                                                                                                                                               |

Passkey（WebAuthn，/api/auth/passkey/*，@simplewebauthn/server v14）：

| 方法       | 路径                                                         | 说明                                              |
| ---------- | ------------------------------------------------------------ | ------------------------------------------------- |
| POST       | `/register/options`                                          | 登录后注册 passkey 的 options（rpID = 请求 host） |
| POST       | `/register/verify`                                           | 校验注册响应，落库 `passkey_credentials`          |
| POST       | `/authenticate/options`                                      | 免登录取断言 options（可带 `{username}`）         |
| POST       | `/authenticate/verify`                                       | 校验断言，成功即建会话                            |
| GET/DELETE | `/credentials`                                               | 查看 / 清除 passkey                               |
| GET        | `/totp`、POST `/totp/setup`、`/totp/enable`、`/totp/disable` | TOTP 管理（disable 需再输密码）                   |

登录失败锁定：`login_attempts` 表按 username+IP 计数，5 次失败锁定 15 分钟；`/2fa/verify` 对同一 tempToken 连续 5 次错误即作废。

## 后台（/api/admin/*，全部需会话，未登录 401 JSON `{"error":"unauthorized"}`）

### 分类

- `GET /api/admin/categories` → `{categories:[{id,name,icon,sortOrder,visibility,createdAt,updatedAt}]}`
- `POST /api/admin/categories` body `{name, icon?, sortOrder?, visibility?}`（visibility: `public`|`private`）→ 201 `{id,…}`
- `PUT /api/admin/categories/:id`（字段同上，部分更新）→ 更新后对象
- `DELETE /api/admin/categories/:id` → `{success:true}`（级联删除其链接）
- `POST /api/admin/categories/reorder` body `{ids:[…]}`（顺序即 sortOrder）→ `{success:true}`

### 链接

- `GET /api/admin/links` → `{links:[{id,categoryId,title,url,iconUrl,description,sortOrder,visibility,createdAt,updatedAt}]}`
- `POST /api/admin/links` body `{title, url, categoryId, iconUrl?, description?, sortOrder?, visibility?}` → 201 `{id}`
- `PUT /api/admin/links/:id`（部分更新）→ 更新后对象
- `DELETE /api/admin/links/:id` → `{success:true}`
- `POST /api/admin/links/reorder` body `{ids:[…]}` → `{success:true}`

### 搜索引擎

- `GET /api/admin/search-engines` → `{searchEngines:[{id,name,urlTemplate,icon,sortOrder,isDefault}]}`
- `POST /api/admin/search-engines` body `{name, urlTemplate(含 {q}), icon?, sortOrder?, isDefault?}` → 201 `{id}`
- `PUT /api/admin/search-engines/:id` → `{id}`（设 `isDefault:true` 会自动清掉其他默认）
- `DELETE /api/admin/search-engines/:id` → `{success:true}`
- `POST /api/admin/search-engines/reorder` body `{ids:[…]}` → `{success:true}`

### 站点设置

- `GET /api/admin/settings` → `{siteTitle, backgroundUrl, logoUrl, theme, columns}`
- `PUT /api/admin/settings` body 可含 `{siteTitle, backgroundUrl, logoUrl, theme(light|dark|system), columns(0–12)}` → 更新后对象

`columns` 允许 `0–12`，其中 `0` 表示**未配置**（用默认值）：`0` 原样存入并原样返回，不会被替换成默认列数。`GET /api/admin/settings` 对未配置的库返回 `columns: 0`，所以 `0–12` 都能往返提交；超出范围返回 400 `columns must be between 0 and 12`。

`backgroundUrl` / `logoUrl` 的值可以是外链 URL，也可以是本地上传路径（`/assets/…`，见下节）。`/assets/…` 被替换成**任何**其他值时，旧 R2 对象自动删除；外链旧值一律不删。

`setup_page_enabled`（setup 页面开关）**不在**站点设置白名单内，也不出现在 `SiteSettingsDto` / `/api/public` 输出；它只走下面的系统管理端点。

### 资源（上传图片，ONE-444）

上传对象存在 R2 桶 `nav-assets`（Worker 绑定名 `R2`；`ASSETS` 已被 Workers Static Assets 占用）。对象键 `assets/{purpose}/{uuid}.{ext}`，公开路径 `/assets/{key}`（因此实际形如 `/assets/assets/background/…`，为父单冻结的字面规则）。
- `POST /api/admin/assets`（需会话，`multipart/form-data`）
  - 字段：`file`（必填）、`purpose`（必填，`background` | `logo` | `icon`）。
  - 双重校验：声明的 Content-Type 必须是 `image/png` / `image/jpeg` / `image/webp` / `image/gif` / `image/svg+xml` / `image/x-icon`（也接受 `image/vnd.microsoft.icon`）之一，**且**文件头魔数与之相符；SVG 无魔数，改为校验内容前缀（允许 BOM/空白后）为 `<?xml` 或 `<svg>`。扩展名由校验出的类型决定（png/jpg/webp/gif/svg/ico），不信任文件名。
  - 大小：`background` ≤ 5MB；`logo`、`icon` ≤ 1MB。
  - 201 `{ "path": "/assets/assets/{purpose}/{uuid}.{ext}" }`
  - 400 `{"error":"…"}`：purpose 非法/缺失、缺 file、Content-Type 不支持、内容与声明不符、空文件；413 `{"error":"…"}`：超出该用途上限（文案含实际字节数与上限）。
  - 环境未绑定 R2 → 503 `{"error":"asset storage unavailable: …"}`（不崩）。
- `GET /assets/*`（公开读，无鉴权；`*` 即对象键）
  - 200：正确 `Content-Type`；`Cache-Control: public, max-age=31536000, immutable`；`X-Content-Type-Options: nosniff`（SVG 固定 `image/svg+xml`，不会被当 HTML 解析）。
  - 对象不存在或环境未绑定 R2 → 404。
- `DELETE /api/admin/assets`（需会话）body `{ "key": "assets/{purpose}/{uuid}.{ext}" }`（也接受公开路径形式）→ `{ "success": true }`；缺 key → 400；未绑定 R2 → 503。

自动清旧：`PUT /api/admin/settings` 中 `backgroundUrl` 或 `logoUrl` 从某个 `/assets/…` 值被替换成别的值（外链或新上传路径）时，旧 R2 对象被删除；旧值为外链时不删。

### 系统管理（`/api/admin/setup`、`/api/admin/system*`，需会话）

- `POST /api/admin/setup` → 免密钥跑账本迁移，响应形状与 `POST /api/setup` 完全一致（含 409 冲突形状）
- `GET /api/admin/system` → `{tablePrefix, setupPageEnabled, ledger}`（`ledger` 为账本已记录迁移名，按应用顺序）
- `PUT /api/admin/system/setup-page` body `{enabled: boolean}`（严格布尔，非布尔 400 `{"error":"enabled must be a boolean"}`）→ `{setupPageEnabled}`

## Setup（`/api/setup/*`）

- `GET /api/setup/state` → 无鉴权，`Cache-Control: no-store`，`{enabled, ownerExists, tablePrefix}`；不含任何密钥/哈希。`ownerExists` = `{prefix}users` 行数 > 0（表不存在按 `false`）。`enabled`：未初始化恒 `true`；已初始化时只有 `{prefix}settings.setup_page_enabled = '1'` 为开，缺省（无此行）与 `'0'` 均为关。
- `GET /api/setup/status` → 同一逻辑/同一载荷的兼容别名（SPA 已迁到 `state`）。
- `POST /api/setup` → header `X-Setup-Secret`（只走请求头，无 GET/查询参数形态）；密钥缺失/占位符 → 500 `{"error":"server misconfigured"}`，不匹配 → 403；按来源 IP 每 10 分钟最多 3 次，超限 429（带 `Retry-After` 与 `retryAfterSeconds`）。动作只有账本迁移（不建用户、不改密码、不删表）：200 `{success, tablePrefix, migrations:[{name,status}], ownerExists}`，前缀冲突 409 `{"error":"table prefix conflict","detail":…}`。
- setup 页面开关**只门控页面**，不门控 `POST /api/setup` 与 `POST /api/auth/setup`（密钥即门闩）。

## 说明

- favicon 自动抓取不在后端做：前端直接请求目标站 / 公共 favicon 服务，失败回退首字圆；后端只存 `iconUrl` 字段。
- 点击计数、服务健康状态为预留字段，v1 不实现（SPEC 第 5 节）。
- 会话 Cookie `nav_session`：HS256 JWT 签名 + `sessions` 表吊销，7 天有效。
