# 工作台响应式回归（`scripts/repro/responsive/`）

> 为「**1000px 以上优先**」的两栏重构准备的浏览器回归。
> 真组件 + 真生产 CSS + 真 Chromium 量布局；会**真的失败并给出非零退出码**，同时留截图与 JSON。

## 1. 两条线，各管一段（别把组件层当宿主 E2E）

| 层 | 跑什么 | 证明什么 | 不证明什么 |
| --- | --- | --- | --- |
| **组件层**（`harness-responsive.mjs`，默认） | `lib/` 里**已编译的真实组件** + `WORKBENCH_CSS` 渲染成 DOM，在 headless Chromium 里量 6 档容器宽度 | 两栏几何、横向溢出、控件是否被压坏、详情列是否在容器内且可命中、Tab 焦点可见性 | 宿主 E2E：没有 React 运行时（点击不改状态）、没有后端、没有宿主外壳；**导航切换 / 点开详情 / 真实交互不在这一层** |
| **live 层**（`--stage live`） | 连**已经在跑的宿主**（默认 http://127.0.0.1:63432），在真页面上点导航、点行、量溢出 | 实际挂载后的行为：导航真的切视图、详情真的打开 | 不是回归基线：它验的是**已装盘的那份构建**（`buildId` 与本地 `lib/` 不一致时会在报告里标出来） |

组件层用的是 `lib/`（**构建产物**）。改完源码要先 `pnpm build`，否则量的是旧产物
（脚本会记录并核对 `lib/build-info.json` 的 `buildId`；跑的过程中被别的会话重建会直接判本次作废）。

## 2. 怎么跑

```sh
# 六档宽度（1440 / 1200 / 1000 / 760 / 480 / 360），默认口径
node scripts/repro/responsive/harness-responsive.mjs

# 现有断点 ±1px 的 16 档（1100 / 900 / 760 / 720 是 CSS 里真实存在的断点）
node scripts/repro/responsive/harness-responsive.mjs --boundary

# 重构收尾：<1000px 的发现也阻断
node scripts/repro/responsive/harness-responsive.mjs --strict

# 只跑自检（种缺陷，验证判据不空转）
node scripts/repro/responsive/harness-responsive.mjs --selftest-only

# 追加 live 层（需要 token，见第 6 节）
DSH_WEB_TOKEN=<token> node scripts/repro/responsive/harness-responsive.mjs --stage live

# 有头看一眼它到底怎么摆
node scripts/repro/responsive/harness-responsive.mjs --headed
```

**退出码**：`0` 无阻断级失败 · `1` 有阻断级失败或脚本异常 · `2` 前置缺失（没有浏览器 / `lib` 缺失或在构建中 / live 缺 token 或选择器）。
`2` **不是通过**：它表示"这次没验"。

## 3. 严重度政策（这是与用户口径绑定的约定）

- 容器宽度 **≥ 1000px**：发现即 **blocking**（阻断，退出码 1）。
- 容器宽度 **< 1000px**：发现记 **watch** —— **照样测量、照样截图、照样进 JSON 与终端汇总**，只是默认不阻断。
  重构收尾用 `--strict` 提级为阻断。
- **以下永远 blocking**（与宽度无关）：样式没加载上、页面是空的、宽度没设上去、自检（种缺陷）没被抓到、
  源码外壳已漂移、两栏结构前提缺失、本轮构建变过。
- **watch 不等于跳过**：没有任何检查会被静默略过。跳过会让人以为"那些宽度没问题"。

## 4. 判据清单（都在 `lib/checks.mjs`，纯函数，可读可测）

| id | 判什么 | 为什么 |
| --- | --- | --- |
| `setup:width` | 量到的容器宽 == 请求宽 | 宽度没设上去时，后续断言会因为"没有元素"而全绿 |
| `setup:css-applied` | `.wb-body` display=flex、`.wb-nav` overflow-x=auto | 样式表没加载时布局测量全部作废（踩过一次：页面与 css 相对路径写错） |
| `structure:nonempty` | 5 个导航页签 + 视图里有内容行 | 空页面会让布局断言恒真 |
| `overflow:root` | 文档不横滚（附"谁把文档撑宽了"） | 用户口径"无横向溢出" |
| `overflow:axis` | 任何 `overflow != visible` 的元素 `scrollWidth <= clientWidth` | 藏着看不见 / 要横滚都算溢出。`text-overflow: ellipsis` 属于设计截断，单独统计不算失败 |
| `layout:columns-in-container` | 列表列与详情列都在容器水平范围内 | 详情列被挤出右边 = 看不见也点不到 |
| `layout:detail-usable` | 详情列宽 ≥ 320px | 两栏并排时右侧不能被压成一条缝 |
| `layout:nav-ratio` | ≥1000px：420 ≤ 列表列 ≤ min(56%, 880) | 与 `.wb-nav { flex: 0 0 min(56%,880px); min-width:420px }` 同一条口径 |
| `layout:side-by-side` | ≥1001px：列表在左、详情在右 | 两栏布局的**唯一**验收形态 |
| `layout:stacked` | ≤760px（sidebar 表面）：详情在列表下方 | 与 `@container (max-width:760px)` 对齐 |
| `controls:min-size` | 可见控件不退化（<12px = 压成一条线） | 15×20 的行内展开按钮是刻意紧凑，不算缺陷（阈值取 12 就是为了不制造噪音） |
| `controls:text-not-clipped` | 控件文字不被裁 | "看得见但读不出" |
| `detail:hit-testable` | 详情列中心 `elementFromPoint` 命中详情列 | 没有被浮层盖住；折叠线以下/视口外不算（那由 layout 系列负责，避免同一根因报两次） |
| `keyboard:reach` / `focus-visible` / `focus-inside` / `focus-affordance` | 真实 Tab 键走查：能 Tab 到、焦点有可见尺寸、在容器内、聚焦后外观有变化 | 焦点不可见 = 键盘用户迷路；这条不看 CSS 细节，只比"聚焦前后外观签名" |
| `selftest:*` | 每轮**种 4 个已知缺陷**，判据必须把它们抓住 | 判据自身失效比没有判据更危险（"变异探针"） |
| `source:*` | 外壳假设的类名/属性还在源码里；`.wb-split` 有布局规则；container query 还在 | 手写外壳不许悄悄过时 |
| `harness:build-stable` | 本轮运行期间 `lib` 没被重建 | 混了两个构建的测量无法归因 |

## 5. 证据（默认 `test-results/responsive/<runId>/`，gitignored）

```
report.json          全部判据 + 观察量（每场景每宽度的容器/列表/详情宽、是否并排、溢出数）+ 环境（浏览器路径 / buildId / git 提交）
workbench.css        本次用的真实样式表（可离线复现）
pages/*.html         每个场景的完整页面（含夹具；selftest-*.html 是种缺陷页）
screenshots/*.png    场景 × 宽度各一张（含 keyboard-* 与 live-*）
```

`report.json` 里的 `observations` 是给**人看和 diff** 的：宽度数字的变化本身就是回归信号，
比"红了/绿了"更容易定位是哪次改动把布局挤坏的。

## 6. live 层（只读；不改真实数据、不重启宿主）

1. **token**：只从环境变量 `DSH_WEB_TOKEN`（或 `DSH_VERIFY_TOKEN`）读，**绝不进 argv、绝不落盘**。
   没有 token 时页面返回 401（`dsh web authentication required`）—— 此时 live 层 `not-run`，退出码 2。
2. **选择器**：`selectors.mjs` 里 `value` 为 `null` 的项表示"还没定稿"。
   缺了就**拒绝开跑**（不猜选择器去点真实界面），并列出缺哪些。
   - 已可兜底：`panelHost` / `viewRoot` / `detailRoot`（用工作台自己的类名）
   - **必须由用户提供**：`entryButton`（打开面板的入口）、`navTabButton`（5 个视图导航按钮）、`detailRow`（点开详情的那一行）
3. 只做只读动作：打开面板、点导航、点一行看详情。**不提交任何表单、不点写操作**；
   同时用 CDP 的 Network 域记录所有请求，把非 GET 的列进 `live:read-only`（watch），
   让人确认没有落库。
4. 会核对宿主 `buildId` 与本地 `lib` 的 `buildId`（不一致时说明 live 验的是已装盘的那份构建）。

## 7. 覆盖范围（如实写，避免"看起来都验了"）

**组件层覆盖**：任务列表（`TaskTreeRows`）、日期面板（`DayPanel` + `PlanPanel`）、
知识库（`KnowledgeToolbar` + `KnowledgeList` + `KnowledgePager`）、点子（`IdeaCardGrid`）、
顶栏 5 个导航页签（照源码复刻的标记）、详情列（**结构替身**，真类名假内容）。

**未覆盖**（源码是 `.tsx` 且不在 `tsconfig.build.json` 的 include 里，没有可 import 的产物）：
`CalendarView`（月/周网格）、`TodayPane`（今日装配）、`TaskDetailPane` / `KnowledgeDetailPane` /
`IdeasDetailPane`（详情栏实现）、各弹窗（SSR 不支持 `createPortal`）。这些交给 live 层。

## 8. 已知当前状态（2026-11-17 首次跑出来的实况）

工作区正在做的两栏重构（`src/client/app/WorkbenchSplit.tsx` 是**未提交的新文件**）只加了外壳，
`styles.ts` 里**还没有任何 `.wb-split` 规则** → `.wb-nav` / `.wb-detail` 上下堆叠，
`flex: 0 0 min(56%, 880px)` 与 `flex: 1` 全部失效，列表列被内容撑到 1097 / 1342 / 761 / 895px，
在 1000px 容器下直接把 `.wb-app-scope` 撑出横向溢出。

因此本脚本**当前是红的**，这是真实状态而不是脚本 bug；它由下面几条断言抓出来：

```
source:split-layout-rule      styles.ts 里没有 .wb-split 规则
layout:side-by-side           @1440/1200：两列不是左右并排（而是上下堆叠）
layout:nav-ratio              @1440/1200/1000：列表列宽度由内容决定，不受 flex basis 约束
overflow:axis                 @1000（tasks/day）：.wb-app-scope 被撑到 1114/1359px
```

补上 `.wb-split` 的布局规则后这些会自然变绿 —— **不要为了让脚本变绿去放宽判据**：
判据对应的是"两栏在 1000px 以上优先成立"这个验收口径。

## 9. 文件结构

```
harness-responsive.mjs   入口：前置检查 / 场景矩阵 / 键盘走查 / 自检 / 汇总 / 证据
live-mount-probe.mjs     live 层（只读宿主验证；也可单独 node 运行）
selectors.mjs            live 层选择器契约（待用户定稿的项显式为 null）
lib/widths.mjs           宽度矩阵 + 严重度政策（纯函数）
lib/checks.mjs           全部判据（纯函数，不碰浏览器/fs）
lib/probe.mjs            页面内测量函数（自包含，toString 送进浏览器）
lib/page.mjs             真实组件 SSR + 真样式 + 手写外壳（含外壳契约 SHELL_CONTRACT）
lib/sourceGuards.mjs     源码级护栏（外壳漂移 / .wb-split 规则 / container query）
lib/fixtures.mjs         夹具数据（mock）
```

## 10. 加新判据时的三条纪律

1. **判据只写一处**（`lib/checks.mjs`），浏览器里只负责"量"（`lib/probe.mjs`）。
2. **新判据必须能在 `--selftest` 里被种缺陷抓住**：加一条判据就加一个 selftest 用例，
   否则没人知道它会不会永远绿。
3. **别用固定 sleep**：等布局靠 `requestAnimationFrame` 与 `document.fonts.ready`，
   等状态靠有上限的轮询（本项目历史上固定 sleep 制造过多起假红/假绿）。
