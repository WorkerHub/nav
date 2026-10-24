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

| 方法 | 路径                   | 说明                                                                                                                                                                                                |
| ---- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET  | `/api/auth/setup`      | `{"enabled":true}` 表示可创建所有者                                                                                                                                                                 |
| POST | `/api/auth/setup`      | header `X-Setup-Secret`；body `{username, password}`（password ≥ 8）→ 201 并下发会话；已有账号 → 403                                                                                                |
| POST | `/api/auth/login`      | body `{username, password}` → `{success, user}`；若已启用 TOTP → `{requires2fa:true, tempToken}`；失败 401 `{"error":"invalid credentials","remainingAttempts":N}`；连续失败 5 次锁定 15 分钟 → 429 |
| POST | `/api/auth/2fa/verify` | body `{tempToken, code}`（TOTP 6 位）→ 200 并下发会话；错误码 401                                                                                                                                   |
| POST | `/api/auth/logout`     | 吊销当前会话                                                                                                                                                                                        |
| GET  | `/api/auth/session`    | 会话探测：`{"authenticated":true,"userId":…}`；未登录 401 JSON                                                                                                                                      |

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

- `GET /api/admin/settings` → `{siteTitle, backgroundUrl, theme, columns}`
- `PUT /api/admin/settings` body 可含 `{siteTitle, backgroundUrl, theme(light|dark|system), columns(1–12)}` → 更新后对象

## 说明

- favicon 自动抓取不在后端做：前端直接请求目标站 / 公共 favicon 服务，失败回退首字圆；后端只存 `iconUrl` 字段。
- 点击计数、服务健康状态为预留字段，v1 不实现（SPEC 第 5 节）。
- 会话 Cookie `nav_session`：HS256 JWT 签名 + `sessions` 表吊销，7 天有效。
