/**
 * 组件层页面装配：**真实组件（SSR）+ 真实生产 CSS + 照源码手写的外壳**。
 *
 * ============================ 这一层是什么 / 不是什么 ============================
 *
 * **是**：把 `lib/client/components/*.js` 里**真实的**已编译组件用 `renderToStaticMarkup`
 * 渲染成 DOM，套上 `lib/client/styles.js` 的**真实 WORKBENCH_CSS**，在真 Chromium 里量布局。
 * 数据是夹具（mock），所以内容压力可控且可复现。
 *
 * **不是**：宿主 E2E。这里没有 React 运行时（组件是静态 HTML，点击不会改状态）、
 * 没有真实后端、没有 DSH 宿主外壳。**导航切换 / 点开详情 / 真实键盘交互都在 live 层**
 * （`live-mount-probe.mjs`），那才是宿主 E2E。
 *
 * ============================ 外壳为什么手写 ============================
 *
 * 外壳（`.wb-panel-host` / `.wb-sidebar-surface` / `.wb-h` / `.wb-body > .wb-split > .wb-nav + section.wb-detail`）
 * 来自 `src/client/app/*.tsx`，那些是 `.tsx` 且**不在** `tsconfig.build.json` 的 include 里，
 * 因此没有可 import 的 `lib/` 产物 —— 只能照源码手写一份。手写必漂移，所以
 * `sourceGuards.mjs` 会读源码核对这里假设的类名/属性/选择器仍在，不在就当场失败。
 *
 * ============================ 视图覆盖范围 ============================
 *
 * | 视图 | 用的真实组件 |
 * | --- | --- |
 * | 任务列表 tasks | `TaskTreeRows`（TaskList.tsx） |
 * | 日期面板 day | `DayPanel` + `PlanPanel`（DayPanel.tsx） |
 * | 知识库 knowledge | `KnowledgeToolbar` + `KnowledgeList` + `KnowledgePager` |
 * | 点子 ideas | `IdeaCardGrid` |
 *
 * **未覆盖**（源码是 `.tsx` 且未编译成独立模块）：`CalendarView`（月/周网格）、`TodayPane`、
 * `TaskDetailPane` / `KnowledgeDetailPane` / `IdeasDetailPane`（详情栏）与各弹窗。
 * 详情栏在这里是**结构替身**：用真实类名（`.wb-detail-actions` / `.wb-detail-tabs` / `.wb-card`）
 * 铺出真实的内容压力，只为验布局参与度与可达性，不代表详情栏实现。
 */
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DICTS, IDEA_CLUSTERS, IDEA_KINDS, KNOWLEDGE_KINDS, PLAN, TASK_ROOTS, TASKS, ideaCards, knowledgeEntries } from './fixtures.mjs'

/** 仓库根：scripts/repro/responsive/lib/page.mjs → ../../../.. */
export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))

const load = (relative) => import(pathToFileURL(join(REPO_ROOT, relative)).href)

const styles = await load('lib/client/styles.js')
const taskListModule = await load('lib/client/components/TaskList.js')
const knowledgeModule = await load('lib/client/components/KnowledgeList.js')
const ideasModule = await load('lib/client/components/IdeaCardGrid.js')
const dayPanelModule = await load('lib/client/components/DayPanel.js')
const presentation = await load('lib/client/listPresentation.js')

export const WORKBENCH_CSS = String(styles.WORKBENCH_CSS)

/**
 * 外壳契约：手写外壳里用到的类名 / 属性 / 选择器。
 * `sourceGuards.mjs` 拿它去源码里核对；改外壳必须先改它。
 */
export const SHELL_CONTRACT = Object.freeze({
  classes: ['wb-panel-host', 'wb-app-scope', 'wb-app', 'wb-h', 'wb-title', 'wb-segmented', 'wb-seg', 'wb-body', 'wb-split', 'wb-nav', 'wb-detail', 'wb-detail-heading', 'wb-detail-back', 'wb-detail-reopen', 'wb-focus-tools'],
  attributes: ['data-open', 'data-dsh-personal-workbench-view', 'data-detail-active', 'data-has-selection'],
  sources: ['src/client/app/WorkbenchHeader.tsx', 'src/client/app/WorkbenchBody.tsx', 'src/client/app/WorkbenchSplit.tsx', 'src/client/styles.ts'],
})

/** 视图 → 本次真正参与渲染的已编译模块（写进证据，避免"到底测了什么"说不清）。 */
export const VIEW_MODULES = Object.freeze({
  tasks: ['lib/client/components/TaskList.js', 'lib/client/components/TaskProgress.js'],
  day: ['lib/client/components/DayPanel.js', 'lib/client/components/PlanPanel.js', 'lib/client/components/TaskList.js'],
  knowledge: ['lib/client/components/KnowledgeList.js', 'lib/client/components/TabBar.js', 'lib/client/components/TagFilter.js'],
  ideas: ['lib/client/components/IdeaCardGrid.js'],
})

/**
 * 渲染并挡掉与判据无关的服务端噪音。
 *
 * `useLayoutEffect does nothing on the server` 在 SSR 每个组件都会打一条：
 * 它不影响静态标记，但会把真正的 React 报错淹没。
 */
function render(element) {
  const original = console.error
  console.error = (...args) => {
    const text = args.map((arg) => (typeof arg === 'string' ? arg : '')).join(' ')
    if (text.includes('useLayoutEffect does nothing on the server')) return
    original(...args)
  }
  try {
    return renderToStaticMarkup(element)
  } finally {
    console.error = original
  }
}

// ── 四个视图的**真实组件**片段 ────────────────────────────────────────────────

export function tasksFragment() {
  return render(h(taskListModule.TaskTreeRows, {
    roots: TASK_ROOTS,
    depth: 0,
    expanded: new Set(['task-0']),
    toggle: () => {},
    dicts: DICTS,
    onOpen: () => {},
    selectedId: 'task-2',
    pending: null,
  }))
}

export function dayFragment() {
  return render(h(dayPanelModule.DayPanel, {
    day: '2026-11-17',
    isToday: true,
    readOnly: false,
    extraTabsAvailable: true,
    tab: 'plan',
    onTabChange: () => {},
    plan: PLAN,
    candidateRows: [{ id: 'task-6', title: '候选任务 A' }, { id: 'task-7', title: '候选任务 B' }],
    promptInfo: { truncated: false, notice: '' },
    planTree: TASK_ROOTS.slice(0, 4),
    overdueTree: TASK_ROOTS.slice(4, 6),
    unscheduledTree: TASK_ROOTS.slice(6, 8),
    doneTree: [],
    doneContextIds: new Set(),
    overdueContextIds: new Set(),
    unscheduledContextIds: new Set(),
    planContextIds: new Set(),
    groupSummaryOf: () => '已排 2 / 共 3 个子任务 · 合计 105 分钟',
    expanded: new Set(['task-0']),
    onToggleExpanded: () => {},
    sourceLabelOf: () => '到期',
    tasks: TASKS,
    dicts: DICTS,
    selectedId: 'task-2',
    pending: null,
    busy: false,
    onOpen: () => {},
    onSort: () => {},
    onComplete: async () => {},
    onDefer: async () => {},
    onEffortChange: async () => {},
    onMinutesChange: async () => {},
    onProgressChange: async () => {},
    onClearPlan: () => {},
    onSavePlan: async () => {},
    report: { subTab: 'day', onSubTabChange: () => {}, isFuture: false, current: null, sessionActive: false, onGenerate: () => {}, onDelete: () => {} },
    onScheduleToday: () => {},
    scheduledIds: new Set(['task-2']),
    schedulingTaskId: null,
  }))
}

export function knowledgeFragment() {
  const filters = Object.assign({}, knowledgeModule.EMPTY_KNOWLEDGE_FILTERS)
  const page = presentation.buildListPage({
    items: knowledgeEntries(presentation.toContentItem),
    query: { tab: knowledgeModule.selectedKind(filters), keyword: '', tags: [], sortKey: 'updatedAt', sortDir: 'desc', page: 0, pageSize: filters.pageSize },
    now: Date.parse('2026-11-17T10:00:00+08:00'),
    tabOf: (entry) => entry.kindCode,
    tabCodes: KNOWLEDGE_KINDS.map((kind) => kind.code),
  })
  return render(h('div', null,
    h(knowledgeModule.KnowledgeToolbar, {
      filters,
      tabs: knowledgeModule.kindTabs(KNOWLEDGE_KINDS, page.tabCounts),
      tagCounts: page.tagCounts,
      total: page.total,
      onChange: () => {},
      onClear: () => {},
      onCreate: () => {},
      onSummarizeDoc: () => {},
    }),
    h(knowledgeModule.KnowledgeList, { page, dicts: KNOWLEDGE_KINDS, selectedId: 'kb-2', onOpen: () => {} }),
    h(knowledgeModule.KnowledgePager, { page, pageSize: 10, onPage: () => {}, onPageSize: () => {} }),
  ))
}

export function ideasFragment() {
  return render(h(ideasModule.IdeaCardGrid, {
    ideas: ideaCards(presentation.toContentItem),
    dicts: IDEA_KINDS,
    selectedId: 'idea-0',
    pickedIds: new Set(['idea-1']),
    clusters: IDEA_CLUSTERS,
    onOpen: () => {},
    onTogglePick: () => {},
    onFileInto: () => {},
    onCreateFolder: () => {},
  }))
}

export const VIEWS = Object.freeze(['tasks', 'day', 'knowledge', 'ideas'])

/** 取某个视图的片段（渲染一次后缓存：DayPanel 很重，同一进程只渲染一次）。 */
const fragmentCache = new Map()
export function viewFragment(view) {
  if (!fragmentCache.has(view)) {
    const built = view === 'tasks'
      ? tasksFragment()
      : view === 'day'
        ? dayFragment()
        : view === 'knowledge' ? knowledgeFragment() : ideasFragment()
    fragmentCache.set(view, built)
  }
  return fragmentCache.get(view)
}
// ── 照源码复刻的外壳 ────────────────────────────────────────────────────────

const VIEW_ATTR = 'data-dsh-personal-workbench-view'

/**
 * 顶栏（逐条对应 `WorkbenchHeader.tsx` 的 DOM：5 个导航页签 + 待处理胶囊 + 5 个按钮）。
 *
 * 导航页签是**真标签**：`今日 / 日历 / 任务 / 知识库 / 点子`。本层不切视图（无 React 运行时），
 * 只验"五个入口在每种容器宽度下都完整可见、可聚焦、不被压成一条线"。
 */
export function headerFragment(extra) {
  const extraHtml = extra === undefined ? '' : extra
  return [
    '<div class="wb-h">',
    '<div class="wb-title">个人工作台</div>',
    '<div class="wb-segmented">',
    '<button class="wb-seg" type="button">今日</button>',
    '<button class="wb-seg" type="button">日历</button>',
    '<button class="wb-seg on" type="button">任务</button>',
    '<button class="wb-seg" type="button">知识库</button>',
    '<button class="wb-seg" type="button">点子</button>',
    '</div>',
    '<div style="flex:1"></div>',
    '<button class="wb-pending-pill" type="button">待处理 <span class="count">3</span></button>',
    '<button class="wb-btn primary" type="button"><span class="wb-label">快速录入</span></button>',
    '<button class="wb-btn" type="button"><span class="wb-label">新建</span></button>',
    '<button class="wb-btn" type="button"><span class="wb-label">设置</span></button>',
    '<button class="wb-btn" type="button"><span class="wb-label">收起全部</span></button>',
    '<button class="wb-btn" type="button"><span class="wb-label">返回对话</span></button>',
    extraHtml,
    '</div>',
  ].join('')
}

/**
 * 详情栏的**结构替身**（真类名、假内容）。
 *
 * 为什么必须有内容：详情列是两栏布局的另一半。内容太少时任何宽度都"放得下"，
 * 那些断言会恒真 —— 夹具必须给足压力（长文本 + 多个 tab + 按钮组）。
 */
export function detailFragment() {
  return [
    '<div class="wb-detail-actions"><button class="wb-btn primary" type="button">完成任务</button>',
    '<button class="wb-btn" type="button">延后</button><button class="wb-btn" type="button">归档</button></div>',
    '<div class="wb-detail-tabs"><button class="wb-detail-tab on" type="button">详情<span class="count">3</span></button>',
    '<button class="wb-detail-tab" type="button">子任务<span class="count">2</span></button>',
    '<button class="wb-detail-tab" type="button">会话</button><button class="wb-detail-tab" type="button">提醒</button></div>',
    '<div class="wb-card"><h4>把工作台两栏布局在 1000px 以上优先收敛</h4>',
    '<p style="margin:0 0 8px">结构替身：真实详情栏（TaskDetailPane 等）未编译成独立模块，本层只验布局参与度与可达性。</p>',
    '<span class="wb-chip" style="background:rgba(79,134,247,.14);color:#4F86F7;border:1px solid rgba(79,134,247,.45)">代码实现</span> ',
    '<span class="wb-chip" style="background:rgba(231,99,76,.14);color:#E7634C;border:1px solid rgba(231,99,76,.45)">紧急</span></div>',
    '<div class="wb-card"><h4>备注</h4><p style="margin:0">一段长文本，用来把详情列撑出真实的滚动高度，避免"内容太少所以什么宽度都放得下"的假绿。</p></div>',
    '<div class="wb-card"><h4>子任务</h4><p style="margin:0">子任务 1 / 子任务 2 / 子任务 3</p></div>',
  ].join('')
}

/**
 * 组装一页。
 *
 * @param {{shell: 'panel'|'surface', sidebarWidthPx?: number, navMarkup: string, headerExtra?: string,
 *          detailStyle?: string, omitChrome?: boolean}} options
 */
export function assemblePage(options) {
  const sidebar = options.sidebarWidthPx === undefined ? 0 : options.sidebarWidthPx
  const header = options.omitChrome === true ? '' : headerFragment(options.headerExtra)
  const body = options.omitChrome === true
    ? options.navMarkup
    : [
      '<div class="wb-body">',
      '<div class="wb-split" data-detail-active="1" data-has-selection="1">',
      '<div class="wb-nav" tabindex="-1" aria-label="浏览内容">',
      '<button type="button" class="wb-btn wb-detail-reopen">查看详情</button>',
      // ⚠️ 专注工具在**真实 DOM 里是 .wb-nav 的第一个子节点**（WorkbenchBody 的顺序）。
      // 早先它被放在 .wb-body 下当兄弟 → .wb-body 是 row 方向 flex，
      // 于是它在右侧长出一条 88px 的"第三列"，把详情列挤到 272px 并制造
      // 360px 下的 6px 横向溢出：**这是夹具抄错了，不是产品缺陷**。
      '<details class="wb-focus-tools"><summary>专注工具</summary><div class="wb-pomodoro"></div></details>',
      options.navMarkup,
      '</div>',
      '<section class="wb-detail" aria-label="详情"' + (options.detailStyle === undefined ? '' : ' style="' + options.detailStyle + '"') + '>',
      '<div class="wb-detail-heading"><button type="button" class="wb-btn wb-detail-back">返回列表</button><span>详情</span></div>',
      detailFragment(),
      '</section>',
      '</div>',
      '</div>',
    ].join('')
  const inner = [
    '<div class="wb-app-scope" ' + VIEW_ATTR + '>',
    '<div class="wb-app">',
    header,
    body,
    '</div>',
    '</div>',
  ].join('')
  const shell = options.shell === 'surface'
    ? '<div class="wb-sidebar-surface" data-probe="container" style="width:100%;height:100%">' + inner + '</div>'
    : '<div class="wb-panel-host" data-open="1" data-probe="container" style="--wb-sidebar-w:' + sidebar + 'px">' + inner + '</div>'
  return pageDocument(shell)
}

/** 把外壳塞进完整页面（极简 reset + 100% 高度，模拟宿主根元素）。 */
export function pageDocument(bodyHtml) {
  return [
    '<!DOCTYPE html>',
    '<html lang="zh-CN" data-dsh-personal-workbench-official>',
    '<head><meta charset="utf-8"><title>responsive harness</title>',
    // ⚠️ 页面落在 <evidence>/pages/ 里，样式表在上一级 —— 写成 "workbench.css" 会静默变成
    // **没有样式**的页面：布局断言全部对着裸 HTML 跑（2026-11-17 实测踩到，nav/detail 都成了整宽）。
    '<link rel="stylesheet" href="../workbench.css">',
    '<style>html,body{margin:0;padding:0;height:100%;background:#101014;color:#eee;}',
    '#probe-host{width:100vw;height:100vh;}</style></head>',
    '<body><div id="probe-host">' + bodyHtml + '</div></body></html>',
  ].join('')
}

/**
 * 造一个场景页。
 *
 * @param {{shell: 'panel'|'surface', view: string, sidebarWidthPx?: number, widthPx?: number}} options
 */
export function buildScenarioPage(options) {
  return assemblePage({
    shell: options.shell,
    sidebarWidthPx: options.sidebarWidthPx,
    navMarkup: viewFragment(options.view),
  })
}

/**
 * `--selftest` 用的**种缺陷页面**。
 *
 * 每一页只种一个已知缺陷，并声明"哪条判据必须红"。
 * 判据如果对种下去的缺陷仍然全绿，说明判据本身失效（比没有判据更危险）——
 * 这正是项目规范里"变异探针"的做法。
 *
 * @param {string} id
 * @returns {{html: string, expectFailed: string[], note: string}}
 */
export function buildSelftestPage(id) {
  if (id === 'overflow') {
    return {
      html: assemblePage({ shell: 'panel', navMarkup: viewFragment('tasks') + '<div style="width:2400px;height:8px"></div>' }),
      expectFailed: ['overflow:axis'],
      note: '列表里塞一个 2400px 宽的子元素 → .wb-nav 必须报横向溢出',
    }
  }
  if (id === 'squeeze') {
    return {
      // 只写 width/height 不够：.wb-btn 自带 padding+border，实测仍会撑到 18x14，
      // 于是"种下的缺陷"比阈值还大（第一版就是这么假绿的）。把 padding/border 一并清零。
      html: assemblePage({ shell: 'panel', navMarkup: viewFragment('tasks'), headerExtra: '<button class="wb-btn" type="button" style="padding:0;border:0;width:6px;height:6px"></button>' }),
      expectFailed: ['controls:min-size'],
      note: '顶栏塞一个 6x6（padding/border 清零）的按钮 → 必须报控件退化',
    }
  }
  if (id === 'detail-out') {
    return {
      // ⚠️ 必须用 min-width 种缺陷：详情列现在是 flex:1 1 0 + min-width:0 的收缩列，
      // 只写 width:2000px 会被 flex 直接压回容器内 —— 那时"没报错"是**布局真的没坏**，
      // 不是判据失效。min-width 是 flex 无法收缩的下界，才能真的把它挤出容器。
      html: assemblePage({ shell: 'panel', navMarkup: viewFragment('tasks'), detailStyle: 'min-width:2000px' }),
      expectFailed: ['layout:columns-in-container'],
      note: '详情列 min-width 2000px（flex 压不回去）→ 必须报"详情列被挤出容器"',
    }
  }
  if (id === 'empty') {
    return {
      html: assemblePage({ shell: 'panel', navMarkup: '', omitChrome: true }),
      expectFailed: ['structure:nonempty'],
      note: '整页空白 → 必须报"页面是空的"，否则所有布局断言都会恒真',
    }
  }
  throw new Error('未知的 selftest 用例：' + id)
}

/** 全部 selftest 用例 id（主流程按这个顺序跑）。 */
export const SELFTEST_IDS = Object.freeze(['overflow', 'squeeze', 'detail-out', 'empty'])
