/**
 * 右侧栏 tab 表面（feature #1）：**本插件与宿主右侧栏之间契约的唯一一份**，
 * 加上"同一时刻谁来渲染那棵唯一的 App"的唯一判定。
 *
 * ## 宿主契约（2026-11-17 从安装版 DSH 的 app.asar 实读取证，不是凭记忆）
 *
 * 证据：`app.asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar-right` 的
 * `lib/client.js` 与 `README.md`。四条要点决定了本模块里所有的形状：
 *
 * 1. **类型** —— `ctx.sidebarRightTabs.register({ id, kind, patterns?, priority?, canOpen?, title, guide?, keepMounted?, multiple? })`。
 *    `register()` 内部用 `this.ctx.effect(...)` 包住注册，但**那个 ctx 是宿主包自己的 fiber**、
 *    不是我们的 —— 所以它返回的 disposer 是我们唯一的撤销手段（见 `sidebarRegistration.ts`）。
 * 2. **页面地址** —— `pageAddress(kind) = \`sidebar://\${kind}\``（宿主 `contract/seed.js`）；
 *    `title(pageAddress(kind))` 在**打开那一刻**取值并写进 tab 记录，之后改语言不会改写已开 chip
 *    （宿主 README："Titles are fixed at open time"）。
 * 3. **正文/标题** —— `slots.register({ name: 'sidebar.right.pane.tab', key: definition.id }, Body)`，
 *    `key` 必须等于类型 `id`。框架注入的钩子是**无参**的：
 *    `function useTabInfo() { return { sidebar, panel, tab } }`（宿主 `tabInfoFactory`）。
 *    读它的唯一入口是 `sidebarTabInfo.ts` 的 `readTabInfo()`。
 * 4. **引导页入口框** —— `guide` 每项至少要有 `id` 与 `title()`，`description` 也必须是**函数**
 *    （宿主渲染时直接 `entry.title()` / `entry.description?.()`），并按 `order` 排序。
 *    旧实现传的是 `{ id, description: <字符串>, order }`：没有 `title`、`description` 不是函数
 *    → 引导页一渲染就 `TypeError`。`id` 在同一 provider 内必须唯一（重复会让 `register()` 抛错）。
 *
 * ## 本模块的硬性约束
 *
 * 不 import React、不碰 DOM、不读 `document` —— 所以能被 `node --test` 直接测
 * （`test/sidebarSurface.test.mjs`）。想锁住的行为必须写在这里；写进组件等于放弃测试。
 */

/** 本实现在 tab 系统里的身份，同时也是**正文/标题槽位的 key**（宿主按它取"生效中的那一份"）。 */
export const WORKBENCH_TAB_ID = '@dely0/dsh-personal-workbench'

/** tab 类型判别符（`openTab(kind)` 用它）。与内置 kind 重名会让 `register` 抛错。 */
export const WORKBENCH_TAB_KIND = 'workbench'

/** 正文/标题槽位的名字（宿主 `contract/slots.ts` 的拼写；拼错=注定挂不上）。 */
export const SIDEBAR_TAB_BODY_SLOT = 'sidebar.right.pane.tab'
export const SIDEBAR_TAB_TITLE_SLOT = 'sidebar.right.pane.tab.title'

/**
 * 页面型 tab 的地址：`sidebar://<kind>`。
 *
 * 与宿主 `contract/seed.js` 的 `pageAddress(kind)` 逐字一致（已核对安装版源码）。
 * 调用方**只报 kind** —— 这个拼法是宿主的簿记，保留此函数是为了 `title(address)` 与测试能对上。
 */
export function workbenchTabAddress(): string {
  return `sidebar://${WORKBENCH_TAB_KIND}`
}

/**
 * 引导页里的一个入口框（宿主 `EntryBox` 真正读取的形状）。
 *
 * - `title` / `description` 都是**取值函数**：引导页每次渲染都会调它们，所以语言能即时跟上
 *   （与"会冻结在打开那一刻"的 tab chip 不同）；
 * - `order` 交给宿主的 `sort((a, b) => a.order - b.order)`；不给数字会得到 `NaN` 比较，
 *   排序静默退化成注册顺序 —— 能跑，但等于把"顺序"这个语义丢掉，所以这里要求必填。
 */
export interface WorkbenchGuideEntry {
  readonly id: string
  readonly title: () => string
  readonly description?: () => string
  readonly order: number
}

/** 注册给 `sidebarRightTabs.register` 的声明（只列我们真正用到的字段）。 */
export interface WorkbenchTabDefinition {
  readonly id: string
  readonly kind: string
  /** tab 芯片文字，宿主在**打开那一刻**调用一次并写进记录。 */
  readonly title: (address: string) => string
  readonly guide: readonly WorkbenchGuideEntry[]
}

/** 构造 tab 类型声明所需的文案（全是取值函数，语言来源由调用方注入）。 */
export interface WorkbenchTabDefinitionInput {
  /** 芯片 / 引导卡标题。注册期与渲染期都可能被调用，必须每次取最新语言。 */
  readonly title: () => string
  /** 引导卡标题（缺省跟随 {@link title}）。 */
  readonly guideTitle?: () => string
  /** 引导卡说明（缺省不显示：宿主只在 ≤4 个入口时才画说明）。 */
  readonly guideDescription?: () => string
  /** 引导卡排序（缺省 0）。 */
  readonly guideOrder?: number
  /** 引导卡 id（同一 provider 内唯一；缺省用 kind）。 */
  readonly guideId?: string
}

/**
 * 构造 tab 类型声明。
 *
 * - 不声明 `patterns`：这是**页面型**（按 kind 打开），不是资源型；
 * - 不声明 `priority`：默认档就是 `extension`（产品外类型，最高档）；
 * - 不声明 `canOpen`：页面型没有地址可认领，宿主用 kind 直接决定；
 * - 不声明 `keepMounted`：默认 `false`。宿主对 `keepMounted === true` 的类型会在
 *   "被隐藏/切 tab/切会话"时**保留正文挂载**，那样"正文挂着"就不再等于"用户看得见"，
 *   而 {@link decideSurfaceOwner} 的互斥口径正是按挂载算的（见该函数说明）。
 */
export function workbenchTabDefinition(input: WorkbenchTabDefinitionInput): WorkbenchTabDefinition {
  const title = input.title
  const guideTitle = input.guideTitle ?? title
  const description = input.guideDescription
  return {
    id: WORKBENCH_TAB_ID,
    kind: WORKBENCH_TAB_KIND,
    title: () => title(),
    guide: [{
      id: input.guideId ?? WORKBENCH_TAB_KIND,
      title: () => guideTitle(),
      ...(description === undefined ? {} : { description: () => description() }),
      order: input.guideOrder ?? 0,
    }],
  }
}

/** 表面归属：谁在渲染那棵唯一的 App。 */
export type SurfaceOwner = 'sidebar' | 'center' | 'none'

/**
 * 判定"这一轮谁来渲染 App"，**唯一实现**。
 *
 * 优先级刻意是"侧栏优先"，且 `sidebarMounted` 用的是**正文是否挂载**、不是"用户是否看得见"：
 * 一个挂载着的正文一定在渲染它那棵 App（轮询 / toast / Modal 都在跑），所以互斥只能按挂载算。
 * 按"可见"算会在"正文挂着但被宿主隐藏"时渲染出第二棵树 —— 那正是本项目最贵的 bug 类别
 * （2026-09-12：弹框重复、点一次「暂存」要点 5–8 次）。
 *
 * 可见性（`tab.visible`）另走 `sidebarPresence.ts` 的可见计数，只用于**诊断与提示**：
 * "侧栏挂着但看不见"是可观测的异常，不是互斥判据。
 *
 * @param input.sidebarMounted - 侧栏正文当前是否挂载（任意一个实例挂着即为 true）。
 * @param input.centerVisible - 中央面板是否该显示内容（= `shouldShowPanel(...)` 的结果）。
 */
export function decideSurfaceOwner(input: { sidebarMounted: boolean; centerVisible: boolean }): SurfaceOwner {
  if (input.sidebarMounted) return 'sidebar'
  if (input.centerVisible) return 'center'
  return 'none'
}

/**
 * 一句可读的归属结论（日志 / 诊断用）。
 *
 * 出问题时光看 DOM 分不清"侧栏没挂""挂了被隐藏""中央被挤掉"三种情况。
 * 判定本身**不在这里重算** —— 直接复用 {@link decideSurfaceOwner}。
 */
export function describeSurface(input: {
  sidebarMounted: boolean
  sidebarVisible: boolean
  centerVisible: boolean
}): { owner: SurfaceOwner; because: string } {
  const owner = decideSurfaceOwner(input)
  if (owner === 'sidebar') {
    return {
      owner,
      because: input.sidebarVisible
        ? '侧栏 tab 正文在显示：由侧栏承载'
        : '侧栏 tab 正文挂着但宿主报告 visible=false（隐藏/后台会话）：互斥仍归侧栏，避免第二棵树',
    }
  }
  if (owner === 'center') return { owner, because: '侧栏没有正文挂载：由中央面板承载' }
  return { owner, because: '侧栏没有正文挂载，中央面板也不该显示内容' }
}

/** 侧栏承载时，中央面板显示的那句话（可观测：不让人对着一片空白猜）。 */
export const CENTER_DELEGATED_HINT = '工作台已在右侧栏打开；关掉右侧栏里的「工作台」标签即可在这里打开。'
