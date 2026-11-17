/**
 * 右侧栏 tab 表面的**注册事务**：类型 → 正文 → 标题，一起成功或一起撤回。
 *
 * ## 上一版的三个真缺陷（2026-11-17 修）
 *
 * 三处注册的生命周期**都不属于我们**：tab 类型挂在 sidebar-right 包的 `ctx.effect` 上，
 * 两个 `slots.inject` 的 effect 挂在 renderer 包的 fiber 上。
 *
 * 1. **注入回调取消（泄漏）**：不主动调 disposer 就永不撤销。旧实现把 disposer 攒进模块级
 *    数组、只在**下一次** `apply()` 开头倒掉 → 插件卸载后侧栏里那个 tab 还在（点开是
 *    `workbenchHost === undefined` 的空壳），再加载时 `id` 还被占着 → 宿主 `register()`
 *    直接抛 `tab type id "..." is already registered`。
 * 2. **注册失败不回滚**：类型成功、正文抛错时旧实现直接 `return` → 用户多出一个
 *    **点开是空白**的 tab。
 * 3. **迟到的失败没人接**：槽位尚未声明时 `slots.inject` 不立即回调，之后的抛错发生在
 *    effect 里，被宿主 `queueMicrotask` 甩成未处理拒绝 —— 外层 try/catch **接不到**。
 *
 * 所以：任一步失败 → 撤回已成功的步骤 + 一条可读日志；`dispose()` 可重放、幂等，
 * 是唯一撤销入口（由 `apply()` 的 cleanup 调用）。
 *
 * ## 约束
 *
 * 不 import React、不碰 DOM：`body` / `titleComponent` 是**不透明值**（`unknown`），只原样转交。
 * 所以整条事务能用假对象跑 `node --test`（回滚 / 取消 / 幂等 / 迟到失败 / 迟到取消）。
 */
import {
  SIDEBAR_TAB_BODY_SLOT, SIDEBAR_TAB_TITLE_SLOT, WORKBENCH_TAB_ID, WORKBENCH_TAB_KIND,
  workbenchTabDefinition, type WorkbenchTabDefinitionInput,
} from './sidebarSurface.js'

/** 宿主 `ctx.sidebarRightTabs` 的最小镜像。 */
export interface SidebarTabRegistryLike {
  register: (definition: unknown) => unknown
}

/** 宿主 `ctx.slots` 的最小镜像（`inject` 可能**稍后**才回调）。 */
export interface SidebarSlotsLike {
  inject: (name: string, callback: () => unknown) => unknown
  register: (options: Record<string, unknown>, component: unknown) => unknown
}

/** `ctx.inject(['sidebarRight','sidebarRightTabs'], scope => ...)` 递进来的作用域。 */
export interface SidebarScopeLike {
  readonly sidebarRightTabs?: SidebarTabRegistryLike
  readonly slots?: SidebarSlotsLike
}

/** 事务里已经成功生效的阶段（排查"侧栏里为什么没有我"的证据）。 */
export type SidebarRegistrationStage = 'tabs' | 'body' | 'title'

/** 注册事务入参。 */
export interface SidebarSurfaceRegistrationInput {
  /** 失败的唯一日志出口（由调用方给，便于单测断言文案）。 */
  readonly warn: (message: string) => void
  /** 成功时的日志出口（可选）。 */
  readonly info?: (message: string) => void
  /** 文案（芯片标题 / 引导卡）。 */
  readonly text: WorkbenchTabDefinitionInput
  /** 正文组件（不透明值，原样转交宿主）。 */
  readonly body: unknown
  /** 标题组件（可选；不注册时宿主用打开那一刻捕获的芯片文字）。 */
  readonly titleComponent?: unknown
}

/** 注册事务句柄。 */
export interface SidebarSurfaceRegistration {
  /** 撤回本事务的全部注册（幂等、可重放；逆序）。 */
  readonly dispose: () => void
  /** 当前生效的阶段（诊断用）。 */
  readonly stages: () => readonly SidebarRegistrationStage[]
  /** 是否因为失败而撤回过（诊断用）。 */
  readonly rolledBack: () => boolean
}

/** 已登记的可撤销项。 */
interface Tracked {
  readonly label: string
  readonly dispose: () => void
}

/** 空事务：什么都没注册，也不会有副作用。 */
function emptyRegistration(): SidebarSurfaceRegistration {
  return { dispose: () => {}, stages: () => [], rolledBack: () => false }
}

/**
 * 执行注册事务。顺序固定 类型 → 正文 → 标题（后两步依赖第一步的 `id`）：
 *
 * - 缺 `sidebarRightTabs.register` / 缺 `slots` → 打日志、返回空事务（**中央面板照常可用**）；
 *   只注册类型而不注册正文等于造一个空壳 tab，所以缺 slots 时两步都不做；
 * - 类型注册抛错 → 打日志、返回空事务（没有可回滚的东西，但状态必须可观测）；
 * - 正文注册失败 → **回滚类型**（不留点开空白的 tab）；
 * - 标题注册失败 → **不回滚**（可选增强；宿主退用捕获的芯片文字），只打一条日志。
 *
 * @param scope - `ctx.inject` 递进来的作用域。
 * @param input - 见 {@link SidebarSurfaceRegistrationInput}。
 * @returns 事务句柄；调用方必须持有并在卸载时 `dispose()`。
 */
export function registerSidebarSurface(
  scope: SidebarScopeLike | undefined,
  input: SidebarSurfaceRegistrationInput,
): SidebarSurfaceRegistration {
  const tracked: Tracked[] = []
  const stages: SidebarRegistrationStage[] = []
  let cancelled = false
  let disposed = false
  let rolledBack = false
  const tabs = scope?.sidebarRightTabs
  const slots = scope?.slots

  /** 逆序撤回（后登记的先撤）。单个失败不影响其它：卸载阶段不再纠缠。 */
  const disposeAll = (): void => {
    while (tracked.length > 0) {
      const entry = tracked.pop()
      try { entry?.dispose() } catch (error) {
        input.warn(`[workbench] 撤销侧栏注册 ${entry?.label ?? '?'} 失败：${String(error)}`)
      }
    }
    stages.length = 0
  }
  /**
   * 登记一项撤销动作。**已经取消过**之后再登记（典型是迟到回调）→ 立刻撤销、不进数组：
   * 否则那次注册会永远活着，正是上一版的泄漏形态。
   */
  const track = (label: string, dispose: () => void): void => {
    if (cancelled) {
      try { dispose() } catch { /* 已取消，失败只影响这一次迟到注册 */ }
      return
    }
    tracked.push({ label, dispose })
  }
  const cancel = (): void => { cancelled = true; disposeAll() }
  const rollback = (reason: string): void => {
    rolledBack = true
    input.warn(reason)
    cancel()
  }

  if (tabs === undefined || typeof tabs.register !== 'function') {
    input.warn('[workbench] 未取到 sidebarRightTabs.register：右侧栏 tab 表面不注册（中央面板照常可用）')
    return emptyRegistration()
  }
  if (slots === undefined || typeof slots.inject !== 'function' || typeof slots.register !== 'function') {
    input.warn('[workbench] 右侧栏作用域里没有 slots 服务：侧栏 tab 的正文无处挂载，表面不注册（中央面板照常可用）')
    return emptyRegistration()
  }

  // ① 类型
  try {
    const dispose = tabs.register(workbenchTabDefinition(input.text))
    if (typeof dispose === 'function') track('tabs', dispose as () => void)
    stages.push('tabs')
  } catch (error) {
    input.warn(`[workbench] 右侧栏 tab 类型注册失败（id=${WORKBENCH_TAB_ID} kind=${WORKBENCH_TAB_KIND}）：${String(error)}`)
    return emptyRegistration()
  }

  /**
   * 把一个槽位注册包成"可取消 + 失败可回滚"。`slots.inject` 可能在这一刻**之后**才回调，
   * 所以回调里必须自己 try/catch（否则错误被宿主甩进 microtask，外层接不到），
   * 并在已取消时立刻把注册还回去（见 `track`）。
   */
  const registerSlot = (
    stage: SidebarRegistrationStage,
    slot: string,
    component: unknown,
    onFail: (message: string) => void,
  ): void => {
    if (cancelled) return
    const injectDispose = slots.inject(slot, () => {
      if (cancelled) return undefined
      try {
        const result = slots.register({ name: slot, key: WORKBENCH_TAB_ID }, component)
        if (typeof result !== 'function') return undefined
        const disposer = result as () => void
        // 回调是**同步执行**（槽位已声明）时，track 会正常入账；
        // 迟到执行时若已取消，track 会立刻撤销它。
        track(stage, disposer)
        if (!cancelled) stages.push(stage)
        return disposer
      } catch (error) {
        onFail(`[workbench] 侧栏 ${slot} 槽位注册失败（key=${WORKBENCH_TAB_ID}）：${String(error)}`)
        return undefined
      }
    })
    if (typeof injectDispose === 'function') track(`inject:${slot}`, injectDispose as () => void)
  }

  // ② 正文：失败必须回滚类型（否则用户得到一个点开空白的 tab）
  registerSlot('body', SIDEBAR_TAB_BODY_SLOT, input.body, (message) => {
    rollback(`${message}；已撤回类型注册，不留空壳 tab（中央面板照常可用）`)
  })
  if (rolledBack) return { dispose: () => {}, stages: () => [], rolledBack: () => true }
  /**
   * 正文还没注册上 = 槽位此刻尚未声明，`slots.inject` 已挂起等待（宿主声明后自动注册）。
   *
   * 这条日志是**唯一**能把"待命"和"注册好了"分开的证据：旧实现的 `hasSlot` 探针
   * 只在 `entriesOfSlot` 抛错时才说"没有"，而它是个快照读取器、不会因此抛错 →
   * 探针恒为 true，等于没有保护。这里改成如实报告当前状态，不用定时器、不猜。
   */
  if (!stages.includes('body')) {
    input.info?.(`[workbench] 正文槽位 ${SIDEBAR_TAB_BODY_SLOT} 此刻尚未声明：已挂起等待，宿主声明后自动注册`)
  }

  // ③ 标题：可选增强，失败只少一个自定义标题（宿主退用捕获的文字），不回滚
  if (input.titleComponent !== undefined) {
    registerSlot('title', SIDEBAR_TAB_TITLE_SLOT, input.titleComponent, (message) => {
      input.warn(`${message}；标题槽位是可选项，本次仍用打开那一刻捕获的芯片文字`)
    })
  }

  input.info?.(`[workbench] 已注册右侧栏 tab 表面（kind=${WORKBENCH_TAB_KIND}）：从右侧栏引导页的「工作台」入口打开`)

  return {
    dispose: () => {
      if (disposed) return
      disposed = true
      cancel()
    },
    stages: () => [...stages],
    rolledBack: () => rolledBack,
  }
}
