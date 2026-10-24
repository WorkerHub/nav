# nav · Design System MASTER.md

> 项目：nav（个人导航起始页，nav.oneboy.app）｜版本：v1.0｜生成日期：2026-02-24
> 来源：ui-ux-pro-max `search.py --design-system`（`design-system/nav/MASTER.generated-by-search.md` 为其原始输出留档）+ 针对性 domain/stack 查询（见文末「检索留痕」）。
> 本文件是 nav 前端唯一视觉与交互规范。页面级 override 放 `design-system/nav/pages/<page>.md`，存在时覆盖本文件。

---

## 0. 绑定技术栈（先于一切视觉决策，冻结）

| 层          | 选型                                                   | 用法约束                                                                              |
| ----------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| UI 组件     | **shadcn/ui（Nova 风格）**，Radix UI 为无样式基础件    | 按钮、输入框、卡片、对话框、下拉、表单、Toast 等一律用 shadcn/ui 组件；不要手写等价物 |
| 仪表盘/后台 | **Kumo（@cloudflare/kumo）** 可选用于后台表格/设置面板 | 与 shadcn/ui 并存时以 shadcn/ui 为通用层                                              |
| 图标        | **Lucide**（`lucide-react`）                           | 所有图标来自 Lucide；禁止 emoji 图标、禁止混入其它图标库                              |
| 动画        | **Motion**（`motion` / framer-motion 后继）            | 入场、拖拽、微交互一律用 Motion；禁止手写 keyframes 做等价动画                        |
| 布局        | **react-resizable-panels**                             | 后台需要可调分栏时使用                                                                |
| 拖拽排序    | **@dnd-kit**（core / sortable / utilities）            | 后台分类、链接、搜索引擎排序一律用 dnd-kit                                            |
| 状态        | **Zustand**                                            | 全局状态（登录态、公开/私有数据、编辑态）用 Zustand；局部态用组件内 state             |
| 样式        | Tailwind CSS（shadcn/ui 同源）+ CSS 变量 token         | token 走下方变量表，禁止组件里写裸 hex                                                |
| 字体        | Google Fonts（Poppins + Open Sans）                    | 见 Typography                                                                         |

**反平行主题**：不产出 HTML+Tailwind 独立主题、不引入第二套设计系统；所有视觉都落在上述栈的组件与 token 上。
**手搓禁令**：组件库能原生表达的组件/行为（Dialog、DropdownMenu、Tooltip、Toast、Sortable、动画）一律用依赖原生实现；确需自研的必须在交付汇报里写明理由。

---

## 1. Pattern（页面与布局模式）

产品形态：**现代毛玻璃起始页** —— 全屏背景图 + 毛玻璃卡片承载的搜索框、图标网格与分类锚点栏。

### 1.1 页面结构（公开页 `/`）

1. **背景层**：全屏背景图（`settings.background_url`），固定不随滚动；上覆一层半透明暗/亮罩（`rgba(15,23,42,0.45)` 或浅色等价）保证前景可读。
2. **顶部锚点栏**（sticky）：分类名横向排列，点击滚动定位到对应分类区块，滚动时高亮当前区块；最右为低调登录入口（未登录）或「后台」+ 退出（已登录）。
3. **搜索区**（首屏中央偏上）：毛玻璃大搜索框 + 引擎切换（当前引擎图标 + 下拉菜单）；`/` 键聚焦、Enter 提交（按 `url_template` 的 `{q}` 替换）。
4. **导航区**：「我的导航」标题 + 分类分节；每节是图标网格（桌面 7–8 列，平板 5–6 列，手机 4 列）。
5. **私有区**（仅登录后）：与公开区同构的分节，视觉上以毛玻璃卡片边缘的 accent 描边/「私有」徽标区分；**未登录时该区块在 DOM 与数据中完全不存在**。

### 1.2 后台（`/admin`）

- 左侧导航（分类 / 链接 / 搜索引擎 / 站点设置 / 导入导出），右侧内容区；窄屏折叠为顶部标签。
- 列表行 = 可拖拽排序（dnd-kit sortable）+ 显式上下移动按钮（键盘/单指替代，WCAG 2.2 Dragging Movements）。
- 编辑一律用 Dialog 表单（shadcn/ui Form + react-hook-form 模式），不用独立编辑页。

### 1.3 登录（`/login` 或弹层）

- `/api/private` 返回 401 JSON 时前端**弹登录 Dialog**，不整页跳转；登录成功后原地拉取私有区。
- 两种方式并列：密码 + TOTP、Passkey；用 shadcn/ui Tabs 切换。

### 1.4 图标策略（链接/分类图标）

1. 优先真实 favicon：`https://www.google.com/s2/favicons?domain=<host>&sz=64` 或目标站 `/favicon.ico`（`links.icon_url` 显式给出时优先）。
2. 加载失败回退 **首字圆**：取域名或标题首字符，背景色 = `hash(domain) % 调色板`（下方 8 色安全调色板），文字白色，字号随容器。
3. 图标容器固定尺寸（40px / 48px），预留空间防 CLS。

---

## 2. Style（风格基调）

- **主风格：Glassmorphism（毛玻璃）** —— 来自 ui-ux-pro-max `styles.csv` 命中（style id `glassmorphism`）。
  - 背景模糊 `backdrop-filter: blur(16px)`（范围 10–20px），半透明白 `rgba(255,255,255,0.14–0.22)`（暗底）或 `rgba(255,255,255,0.55–0.72)`（亮底），1px 半透明描边 `rgba(255,255,255,0.22)`，多层 z-depth 表现纵深。
  - 必须有「鲜活背景」：背景图本身要有色彩与明暗层次，毛玻璃才成立；纯灰背景上不要用毛玻璃。
- **辅风格：Modern / Minimal**（SaaS-General 生成档，Dial：variance 4 / motion 3 / density 5）——克制留白、清晰层级、低噪音。
- 双模式：默认跟随系统（`prefers-color-scheme`），亮/暗都支持；**不默认暗色**（生成档 Anti-pattern 明示）。
- 图标视觉家族统一：Lucide 单一线性风格（1.75–2px stroke），不混面性图标。

---

## 3. Colors（颜色）

### 3.1 语义 token（CSS 变量，生成档 SaaS-General 调色板，落在 shadcn/ui 变量命名上）

| 语义             | 值        | CSS 变量               | 用途                       |
| ---------------- | --------- | ---------------------- | -------------------------- |
| Primary          | `#2563EB` | `--primary`            | 主按钮、链接高亮、当前锚点 |
| On Primary       | `#FFFFFF` | `--primary-foreground` | 主按钮文字                 |
| Secondary        | `#3B82F6` | `--secondary`          | 次按钮、引擎切换           |
| Accent/CTA       | `#EA580C` | `--accent`             | 关键 CTA、私有区描边       |
| Background       | `#F8FAFC` | `--background`         | 页面基底（背景图未加载时） |
| Foreground       | `#1E293B` | `--foreground`         | 正文                       |
| Card             | `#FFFFFF` | `--card`               | 卡片（毛玻璃基色）         |
| Muted            | `#E9EFF8` | `--muted`              | 次要面                     |
| Muted Foreground | `#475569` | `--muted-foreground`   | 次要文字                   |
| Border           | `#E2E8F0` | `--border`             | 描边                       |
| Destructive      | `#DC2626` | `--destructive`        | 删除/危险操作              |
| Ring             | `#2563EB` | `--ring`               | 焦点环                     |

暗色模式按 shadcn/ui 惯例覆盖为深蓝灰基底（`#0B1220` 级），前景转 `#E2E8F0`，保持 4.5:1。

### 3.2 毛玻璃 token

- `--glass-blur: 16px`；`--glass-bg-light: rgba(255,255,255,0.62)`；`--glass-bg-dark: rgba(17,24,39,0.55)`；`--glass-border-light: rgba(255,255,255,0.35)`；`--glass-border-dark: rgba(255,255,255,0.14)`。
- 阅读性优先：毛玻璃面上的正文必须过 4.5:1；背景图过亮时加深罩层，不靠模糊硬扛。

### 3.3 首字圆调色板（favicon 回退）

`#2563EB` `#7C3AED` `#0891B2` `#059669` `#D97706` `#DC2626` `#DB2777` `#475569`（8 色，均可承载白字）。

---

## 4. Typography（排版）

- **标题：Poppins**（500/600/700）；**正文：Open Sans**（400/600）——ui-ux-pro-max「Modern Professional」组合，现代、友好、界面可读。
- 字号基线 16px，行高 1.5；最小正文 12px（仅辅助文字），主文案 ≥14px。
- 字阶：页面标题 32px / 区块标题 20–24px / 卡片标题 14–16px / 辅助 12–13px。
- 链接卡片标题单行省略（`text-ellipsis whitespace-nowrap`），域名小字灰显；标题与域名两行固定高度防跳动。
- Google Fonts 引入（自托管亦可，v1 用 CDN）：
```css
@import url("https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&family=Poppins:wght@500;600;700&display=swap");
```

---

## 5. Effects（效果与动效）

- **毛玻璃**：`backdrop-filter: blur(16px)` + 半透明底 + 1px 亮描边；卡片 hover 用阴影加深（`--shadow-md → --shadow-lg`）与 1px 上浮，不放大变形（避免布局抖动）。
- **阴影层级**：`sm 0 1px 2px rgba(0,0,0,.05)` / `md 0 4px 6px rgba(0,0,0,.10)` / `lg 0 10px 15px rgba(0,0,0,.10)` / `xl 0 20px 25px rgba(0,0,0,.15)`。
- **动效（Motion，Dial motion=3/10 微交互档）**：
  - 入场：搜索框/网格卡片 stagger `opacity 0→1, y 8→0`，150–220ms，ease-out。
  - 锚点滚动：`scrollIntoView({ behavior: 'smooth', block: 'start' })`，sticky 栏下留 `scroll-margin-top`。
  - 拖拽：dnd-kit `DndContext` + Motion 布局动画；拖起态加阴影与轻微旋转（≤2°）。
  - 引擎切换 / 登录结果：Toast（shadcn/ui Sonner）。
  - **一律尊重 `prefers-reduced-motion: reduce`**：跳过非必要动画，直接呈现终态。
- **焦点**：所有可交互控件保留可见焦点环（`--ring`），禁用 `outline: none` 而不给替代。
- **交互反馈**：可点元素必须 `cursor: pointer` + hover 反馈；拖拽之外提供「上移/下移」按钮（WCAG 2.2 单指替代）。

---

## 6. Anti-patterns（禁止清单）

- ❌ emoji 当图标；❌ 混用多套图标家族（只用 Lucide）。
- ❌ 私有数据在未登录时"隐藏但存在"——未登录渲染中私有区必须**完全不出现**（DOM、JS bundle 字符串、网络请求都不含）。
- ❌ 手搓等价组件/动画/拖拽/状态库（见第 0 节禁令）。
- ❌ 组件内裸 hex 颜色、固定 px 容器宽度、横向滚动、禁用缩放。
- ❌ 只靠 hover 承载重要操作（触屏失效）；❌ 只靠拖拽排序（必须有按钮/键盘替代）。
- ❌ 移除焦点环、图标按钮无 `aria-label`、placeholder 当唯一标签、错误信息堆在顶部。
- ❌ 低对比文字（<4.5:1）、灰底灰字；❌ 布局抖动的 hover（scale 改变占位）。
- ❌ 动画阻塞导航/输入；单一时长打天下；忽略 reduced-motion。
- ❌ 默认暗色主题（亮色为默认）；❌ 过度动画、视差堆砌。
- ❌ HTML+Tailwind 平行主题、第二套设计系统。

---

## 7. 检索留痕（ui-ux-pro-max，可复核）

| 查询                                                                   | 模式                                                         | 命中                                                                    |
| ---------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `personal start page navigation portal`                                | `--domain product`                                           | Link-in-Bio / Portfolio / Personal Finance 档；Glassmorphism 为次推风格 |
| `modern glassmorphism personal start page navigation background photo` | `--design-system -p nav --variance 4 --motion 3 --density 5` | 生成档原始输出：`design-system/nav/MASTER.generated-by-search.md`       |
| `glassmorphism frosted card background image startpage`                | `--domain style`                                             | style id `glassmorphism`（blur 10–20px、半透明 15–30%、1px 亮描边）     |
| `modern sans serif friendly interface`                                 | `--domain typography`                                        | Modern Professional（Poppins + Open Sans）                              |
| `search input keyboard focus shortcuts`                                | `--domain ux`                                                | 焦点可见、焦点不被遮挡、inputmode                                       |
| `accessible authentication login password passkey`                     | `--domain ux`                                                | 允许密码管理器与粘贴、密码可见性切换、passkey 免认知测试                |
| `drag drop reorder list keyboard alternative`                          | `--domain ux`                                                | WCAG 2.2 拖拽必须有单指/键盘替代                                        |
| `card grid hover tooltip` / `hover vs tap`                             | `--domain ux`                                                | hover 反馈、不依赖 hover                                                |
| `grid icon navigation label`                                           | `--domain icons`                                             | 图标语义/可及性规则（装饰性 aria-hidden、图标按钮需可访问名）           |
| `shadcn ui component theming`                                          | `--stack shadcn`                                             | 组件按需导入、显式 base（radix/aria）、组件原生组合规则                 |
| `favicon avatar initial circle fallback letter`                        | `--domain icons`                                             | **0 命中**：首字圆回退为通用做法，非数据库命中（已在实现中注明）        |
