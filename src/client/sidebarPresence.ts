/**
 * 渲染权句柄：`WorkbenchApp` 这棵树**此刻由谁承载**。
 *
 * ## 它解决什么
 *
 * `WorkbenchApp` 体内有轮询、toast、Modal（见 `constants.ts` 与 2026-09-12 事故：
 * 挂两份 → 弹框重复、点一次「暂存」要点 5–8 次、背景一次比一次黑）。
 * 侧栏 tab 与中央面板是**两个宿主位置**，同一刻只能有一个在渲染这棵树。
 * 归属判定只有 `sidebarSurface.ts` 的 `decideSurfaceOwner()` 一处，本模块只负责**记状态**。
 *
 * ## 为什么是"按实例记名"而不是一个布尔（本轮修的真 bug）
 *
 * 宿主允许**两个横向面板**（`sidebar-right` README："the product allows two horizontal panes"），
 * 而页面型 tab 的去重范围是"**每个 pane 内**"，所以同一个 pane 组里可以同时挂着
 * **两个**本插件的正文（两个 pane 各一个）。旧实现是布尔 `enter()` / `leave()`：
 *
 * ```text
 * 实例 A enter → mounted = true
 * 实例 B enter → 幂等吞掉（不记录 B 存在过）
 * 实例 A leave → mounted = false        ← 但 B 还挂着！中央面板于是又渲染一棵 App
 * 结果：屏幕上两个 WorkbenchApp 同时在跑（重复弹框 / 重复轮询）
 * ```
 *
 * 这是"同一个语义被独立计算多次"的典型变体：`leave()` 并不知道自己是不是**最后一个**。
 * 所以这里按实例 id 记名，只有**全空**才交还渲染权。
 *
 * ## 约束
 *
 * 不 import React、不碰 DOM。可被 `node --test` 直接测（`test/sidebarPresence.test.mjs`）。
 */

/**
 * 渲染权句柄：模块级单例，写入点只有侧栏正文的挂载/卸载/可见性上报。
 */
export interface SurfacePresence {
  /** 领一个实例 id（每次挂载领一个，互不干扰）。 */
  mintId: () => string
  /** 某个实例挂上了（幂等：同一 id 重复调用只记一次）。 */
  claim: (id: string) => void
  /** 某个实例卸载了（幂等；未知 id 不会影响别人）。 */
  release: (id: string) => void
  /** 宿主报告这个实例的可见性（不报 = 未知，不猜）。 */
  setVisible: (id: string, visible: boolean) => void
  /** 是否有任意实例挂着（= 侧栏占用渲染权）。 */
  isMounted: () => boolean
  /** 是否有实例自报"宿主说我在显示"。 */
  isVisible: () => boolean
  /** 当前挂载的实例数（诊断用）。 */
  count: () => number
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
  const mounted = new Set<string>()
  const visible = new Set<string>()
  const listeners = new Set<() => void>()
  let minted = 0
  /** 只有状态**真的**变了才通知：否则每次挂载都会触发一轮无意义重渲染。 */
  const notify = (): void => {
    for (const listener of [...listeners]) {
      try { listener() } catch { /* 单个订阅者出错不影响其它 */ }
    }
  }
  return {
    mintId: () => {
      minted += 1
      return `surface-${minted}`
    },
    claim: (id) => {
      if (mounted.has(id)) return
      mounted.add(id)
      notify()
    },
    release: (id) => {
      const hadMounted = mounted.delete(id)
      const hadVisible = visible.delete(id)
      if (hadMounted || hadVisible) notify()
    },
    setVisible: (id, next) => {
      if (next) {
        if (visible.has(id)) return
        visible.add(id)
        notify()
        return
      }
      if (!visible.delete(id)) return
      notify()
    },
    isMounted: () => mounted.size > 0,
    isVisible: () => visible.size > 0,
    count: () => mounted.size,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    reset: () => {
      // 先摘订阅者再清状态：重建后旧订阅者持有的是旧闭包，通知它们没有意义。
      listeners.clear()
      mounted.clear()
      visible.clear()
    },
  }
}

/** 生产用的渲染权句柄（侧栏正文的挂载/卸载/可见性是唯一写入点）。 */
export const sidebarSurfacePresence = createSurfacePresence()
