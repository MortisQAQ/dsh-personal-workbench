/**
 * 右侧栏 tab 表面（feature #1：**工作台能在 sidebar 里打开，而不是必须占满会话页**）。
 *
 * ## 它解决什么
 *
 * 迁移前，工作台内容只挂在 `shell.overlay`（满屏层）与 `main`（中央键槽）上，
 * 打开面板 = 让整个会话区让位。用户要的是"和文件、终端、浏览器并列的一个侧栏 tab"。
 *
 * DSH 的右侧栏有一套**公开的扩展席位**（见 `ctx.sidebarRight` / `ctx.sidebarRightTabs`）：
 *
 * 1. 类型 — `sidebarRightTabs.register({ id, kind, patterns?, priority?, canOpen?, title, guide? })`；
 * 2. 正文 — `slots.register({ name: 'sidebar.right.pane.tab', key: <id> }, Body)`；
 * 3. 标题 — `slots.register({ name: 'sidebar.right.pane.tab.title', key: <id> }, Title)`（可选）；
 * 4. 入口 — `ctx.sidebarRight.openTab(kind)`，或右栏引导页里的一个 `guide` 入口框。
 *
 * 本模块只放**纯声明与纯判定**（不 import React、不碰 DOM），所以能被 `node --test` 直接测：
 * 定义形状、页面地址、以及"同一时刻谁来渲染那棵 App「只有一份」"的判据。
 *
 * ## 为什么"只有一份"要单独建模
 *
 * `WorkbenchApp` 体内有轮询、toast、Modal（见 `constants.ts` 的说明与 2026-09-12 事故：
 * 挂两份 → 弹框重复、点一次「暂存」要点 5–8 次、背景一次比一次黑）。
 * 侧栏 tab 与中央面板是**两个宿主位置**，但它们必须共用**同一个**渲染权：
 * 侧栏 tab 挂载期间，中央面板只画一句"已在右侧栏打开"，不再渲染第二棵树。
 *
 * 这个"渲染权"就是 {@link SurfacePresence}，判定只有 {@link decideSurfaceOwner} 一处。
 */

/**
 * 本实现在 tab 系统里的身份，同时也是**正文/标题槽位的 key**。
 *
 * 契约要求全系统唯一（`id` 重复注册会抛错），所以用包名而不是 "workbench"。
 */
export const WORKBENCH_TAB_ID = '@dely0/dsh-personal-workbench'

/** tab 类型判别符（`openTab(kind)` 用它）。不能与内置 kind（guide/files/browser/…）重名。 */
export const WORKBENCH_TAB_KIND = 'workbench'

/**
 * 页面型 tab 的地址：`sidebar://<kind>`。
 *
 * 这个拼法是宿主自己的簿记（`pageAddress`），调用方**只报 kind**；
 * 这里保留它是为了 `title(address)` 与测试能对上宿主实际传入的值。
 */
export function workbenchTabAddress(): string {
  return `sidebar://${WORKBENCH_TAB_KIND}`
}

/** 引导页里的入口框（右栏空态那张列表里的一格）。 */
export interface WorkbenchGuideEntry {
  readonly id: string
  readonly description: string
  readonly order: number
}

/** 注册给 `sidebarRightTabs.register` 的声明（只列我们真正用到的字段）。 */
export interface WorkbenchTabDefinition {
  readonly id: string
  readonly kind: string
  /** tab 芯片文字，**打开那一刻**取值。 */
  readonly title: (address: string) => string
  readonly guide: readonly WorkbenchGuideEntry[]
}

/**
 * 构造 tab 类型声明。
 *
 * - 不声明 `patterns`：这是**页面型**（按 kind 打开），不是资源型；
 * - 不声明 `priority`：默认档就是 `extension`（产品外类型，最高档）；
 * - 不声明 `canOpen`：页面型没有地址可认领，宿主用 kind 直接决定。
 *
 * @param label - 用户可见的 tab 名（跟随语言：入口文案走 `entryText`）。
 * @param guideDescription - 引导入口框的一句话说明。
 */
export function workbenchTabDefinition(label: string, guideDescription: string): WorkbenchTabDefinition {
  return {
    id: WORKBENCH_TAB_ID,
    kind: WORKBENCH_TAB_KIND,
    title: () => label,
    guide: [{ id: WORKBENCH_TAB_KIND, description: guideDescription, order: 0 }],
  }
}

/** 表面归属：谁在渲染那棵唯一的 App。 */
export type SurfaceOwner = 'sidebar' | 'center' | 'none'

/**
 * 判定"这一轮谁来渲染 App"，**唯一实现**。
 *
 * 优先级刻意是"侧栏优先"：
 *
 * - 侧栏 tab 已经挂着 → 它就是当前表面，中央面板只画提示（否则就是两棵树）；
 * - 否则沿用中央面板的老判据（宿主 `activePanelId` 优先、本地标志回落）——
 *   这条判据**不在本函数里重算**，由调用方把 `centerVisible` 传进来。
 *
 * @param input.sidebarMounted - 侧栏 tab 正文当前是否挂载。
 * @param input.centerVisible - 中央面板是否该显示内容（= `shouldShowPanel(...)` 的结果）。
 */
export function decideSurfaceOwner(input: { sidebarMounted: boolean; centerVisible: boolean }): SurfaceOwner {
  if (input.sidebarMounted) return 'sidebar'
  if (input.centerVisible) return 'center'
  return 'none'
}

/** 渲染权句柄：模块级单例，只由侧栏正文的挂载/卸载驱动。 */
export interface SurfacePresence {
  /** 侧栏正文挂载（幂等：重复调用只通知一次）。 */
  enter: () => void
  /** 侧栏正文卸载（幂等）。 */
  leave: () => void
  /** 当前是否由侧栏承载。 */
  isMounted: () => boolean
  /** 订阅变化；返回退订函数。 */
  subscribe: (listener: () => void) => () => void
  /** 清空（插件重建时用）。 */
  reset: () => void
}

/**
 * 建一个渲染权句柄。
 *
 * 为什么是工厂而不是直接导出一个单例：单测需要互不干扰的实例
 * （同一进程里跑两遍"挂上/摘掉"不能靠 reset 顺序），生产用下面的 `sidebarSurfacePresence`。
 */
export function createSurfacePresence(): SurfacePresence {
  let mounted = false
  const listeners = new Set<() => void>()
  const notify = (): void => {
    for (const listener of [...listeners]) {
      try { listener() } catch { /* 单个订阅者出错不影响其它 */ }
    }
  }
  return {
    enter: () => {
      if (mounted) return
      mounted = true
      notify()
    },
    leave: () => {
      if (!mounted) return
      mounted = false
      notify()
    },
    isMounted: () => mounted,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    reset: () => {
      listeners.clear()
      if (!mounted) return
      mounted = false
    },
  }
}

/** 生产用的渲染权句柄（侧栏正文挂载/卸载 = 唯一写入点）。 */
export const sidebarSurfacePresence = createSurfacePresence()

/** 侧栏承载时，中央面板显示的那句话（可观测：不让人对着一片空白猜）。 */
export const CENTER_DELEGATED_HINT = '工作台已在右侧栏打开；关掉右侧栏里的「工作台」标签即可在这里打开。'
