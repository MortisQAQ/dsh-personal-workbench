/**
 * 宿主注入的 `useTabInfo()` 的**唯一读取入口**。
 *
 * ## 为什么好好的一个 hook 需要单独一个模块
 *
 * 因为上一版把它读错了，而这个错**没有任何类型检查会拦**（宿主类型在我们这边是 structural
 * 镜像，不是 import）。实证（2026-11-17，安装版 DSH `app.asar` 内
 * `@deepseek-ai/dsh-client-ui-sidebar-right/lib/client.js` · `tabInfoFactory`）：
 *
 * ```js
 * return function useTabInfo() {
 *   ...
 *   return { sidebar: {...}, panel: {...}, tab: { ...tab, visible, navigation, signal, actions } }
 * }
 * ```
 *
 * **它没有 selector 参数**。旧实现按 `useTabInfo(sel => sel.tab)` 调用 —— 入参被静默忽略，
 * 拿回来的是根对象；调用方再按 `tabInfo.actions.close` 读 → 恒为 `undefined`
 * → 「开完 AI 会话自动收面板」这类关闭动作**永远失效**，只留一条 console.warn。
 *
 * 所以这里把三件事收在一处，调用方**不许**自己调 `props.useTabInfo`：
 * 1. 不传实参；2. 兼容"根对象"与"直接是 tab 记录"两种形状；3. 失败给**可读原因**而不是抛。
 *
 * ## 约束
 *
 * 不 import React、不碰 DOM。唯一"副作用"是调用传进来的函数本身（由调用方保证那是 hook）。
 * 因此可被 `node --test` 直接测：`test/sidebarTabInfo.test.mjs`。
 */

/** 宿主 `tab.actions` 里我们用到的那一个动作（其余动作没消费者，不镜像）。 */
export interface HostTabActions {
  readonly close?: () => void
}

/** 宿主 `tab` 记录里我们真正读的字段（其余字段宿主自己用，读了就是耦合）。 */
export interface HostTabRecord {
  readonly id?: string
  readonly title?: string
  /** 宿主自家判据：这个正文此刻是否真的在显示（**标题槽位里恒为 false**）。 */
  readonly visible?: boolean
  readonly actions?: HostTabActions
}

/** 宿主 `useTabInfo()` 返回值的结构镜像。 */
export interface HostTabInfo {
  readonly tab?: HostTabRecord
  readonly sidebar?: { readonly expanded?: boolean; readonly fullscreen?: boolean }
  readonly panel?: { readonly id?: string; readonly isFloating?: boolean }
}

/** 读 `useTabInfo` 的结果：成功给形状，失败给**可读原因**（不静默给 undefined 让人猜）。 */
export type TabInfoRead =
  | { readonly ok: true; readonly info: HostTabInfo }
  | { readonly ok: false; readonly reason: 'missing-hook' | 'threw'; readonly message?: string }

/**
 * 调用宿主注入的 `useTabInfo` —— **不带任何实参**（宿主签名是 `() => info`）。
 *
 * 三条失败路径都返回 `{ ok: false }` 而不是抛：
 *
 * - 宿主没给这个 prop（旧宿主 / 槽位形状变了）→ `missing-hook`；
 * - 宿主自己抛（`sidebarRight: tab "..." is not committed in session "..."`）→ `threw` + 原文。
 *   在正文插槽里这意味着"宿主还没把 tab 提交进 store"，是可观测的装配问题，
 *   不该让整棵工作台白屏。
 * - 返回值不是对象 → 归一成空形状（`ok: true`、无 `tab`），下游照样安全。
 */
export function readTabInfo(useTabInfo: unknown): TabInfoRead {
  if (typeof useTabInfo !== 'function') return { ok: false, reason: 'missing-hook' }
  try {
    return { ok: true, info: normalizeTabInfo((useTabInfo as () => unknown)()) }
  } catch (error) {
    return { ok: false, reason: 'threw', message: String(error) }
  }
}

/**
 * 本 tab 记录的 `visible`。宿主没给就返回 `undefined`（**不要**当成 false）：
 * "未知"和"明确不可见"是两回事，混起来会让诊断结论说谎。
 */
export function tabVisibleOf(read: TabInfoRead): boolean | undefined {
  return read.ok ? read.info.tab?.visible : undefined
}

/**
 * 本 tab 的关闭动作（= 宿主 `tab.actions.close`）。
 *
 * 拿不到就返回 `undefined`，由调用方打一条**说清原因**的日志并放弃关闭 ——
 * 不静默假装关掉了（那会让"开完 AI 会话就收面板"看起来像没反应）。
 */
export function tabCloseActionOf(read: TabInfoRead): (() => void) | undefined {
  return read.ok ? read.info.tab?.actions?.close : undefined
}

/**
 * 把宿主返回值归一成 {@link HostTabInfo}。
 *
 * 兼容两种形状，因为它们是同一语义的两种写法：
 * - `{ sidebar, panel, tab }` —— 宿主真实返回；
 * - 直接是 tab 记录 —— 旧实现按 selector 调用时"以为"拿到的形状（以及万一宿主换回 selector 式）。
 *
 * 归一成**新对象且只保留已知字段**：调用方拿不到原始引用，也就读不到没归一化的字段。
 */
function normalizeTabInfo(raw: unknown): HostTabInfo {
  if (typeof raw !== 'object' || raw === null) return {}
  const source = raw as Record<string, unknown>
  const nested = source['tab']
  if (typeof nested === 'object' && nested !== null) return { tab: normalizeTabRecord(nested) }
  return looksLikeTabRecord(source) ? { tab: normalizeTabRecord(source) } : {}
}

function looksLikeTabRecord(source: Record<string, unknown>): boolean {
  return source['actions'] !== undefined || source['id'] !== undefined || source['visible'] !== undefined
}

function normalizeTabRecord(raw: unknown): HostTabRecord {
  if (typeof raw !== 'object' || raw === null) return {}
  const source = raw as Record<string, unknown>
  const actions = source['actions']
  return {
    ...(typeof source['id'] === 'string' ? { id: source['id'] } : {}),
    ...(typeof source['title'] === 'string' ? { title: source['title'] } : {}),
    ...(typeof source['visible'] === 'boolean' ? { visible: source['visible'] } : {}),
    ...(typeof actions === 'object' && actions !== null ? { actions: normalizeTabActions(actions) } : {}),
  }
}

function normalizeTabActions(raw: object): HostTabActions {
  const close = (raw as { close?: unknown }).close
  return typeof close === 'function' ? { close: close as () => void } : {}
}
