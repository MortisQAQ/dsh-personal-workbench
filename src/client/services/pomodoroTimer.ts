/**
 * 番茄钟的**唯一权威源**（模块级单例 store）。
 *
 * ## 它解决什么
 *
 * 计时器原先的状态在组件里，于是：关掉侧栏 = 计时消失；中央面板与侧栏各一份 = "两个工作钟"。
 * 现在状态在这里，UI 只是投影（`usePomodoro` 是薄适配层）：
 *
 * - **关闭任何界面都不影响计时**：ticker 挂在本模块上，只在 running 时存在；
 * - **开多少个界面都只有一份**：`useSyncExternalStore` 订阅同一快照；
 * - **刷新/重开宿主后继续**：持久化的是 `endsAt` 绝对时刻，恢复时按它重算（见 `restorePomodoro`）。
 *
 * ## 三条性能纪律（有测试兜底）
 *
 * 1. `getSnapshot()` 返回**引用稳定**的对象 —— 只有状态真的变了才换新对象
 *    （每次 new 一个对象会让 React 认为"一直在变"，每秒几十次渲染）；
 * 2. tick **不写 localStorage** —— 走时靠 `endsAt` 重算，只在状态转换时落盘；
 * 3. 只有**显示用的秒数真的变了**才通知订阅者 —— 运行中 ≤1 次/秒，暂停/空闲 0 次。
 */
import {
  initialSession, reducePomodoro, restorePomodoro, nextSegmentId,
  type PomodoroEvent, type PomodoroSession,
} from '../../shared/pomodoroMachine.js'
import { saveSession } from './pomodoroService.js'

const SESSION_KEY = 'dsh-workbench:pomodoro-session'
const RECORDED_KEY = 'dsh-workbench:pomodoro-recorded'
/** 已记账段 id 的保留上限（只为跨窗口去重，不需要长期保留）。 */
const RECORDED_MAX = 200
const TICK_MS = 1000

type Listener = () => void
export type PomodoroCompletion = { phase: 'break'; cycles: number; durationSeconds: number }

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function readPersisted(now: number, workSeconds: number, breakSeconds: number): PomodoroSession {
  const base = initialSession({ workSeconds, breakSeconds, now })
  const raw = storage()?.getItem(SESSION_KEY)
  if (raw === null || raw === undefined || raw === '') return base
  try {
    const parsed = JSON.parse(raw) as Partial<PomodoroSession>
    if (typeof parsed !== 'object' || parsed === null) return base
    /** 逐字段校验：存储里的东西一律不可信（手改过、旧版本写过别的形状）。 */
    const candidate: PomodoroSession = {
      ...base,
      phase: parsed.phase === 'break' ? 'break' : 'work',
      status: parsed.status === 'running' || parsed.status === 'paused' ? parsed.status : 'idle',
      segmentSeconds: numberOr(parsed.segmentSeconds, base.segmentSeconds),
      endsAt: typeof parsed.endsAt === 'number' && Number.isFinite(parsed.endsAt) ? parsed.endsAt : null,
      remainingSeconds: numberOr(parsed.remainingSeconds, base.remainingSeconds),
      startedAt: typeof parsed.startedAt === 'string' && parsed.startedAt !== '' ? parsed.startedAt : null,
      segmentId: typeof parsed.segmentId === 'string' && parsed.segmentId !== '' ? parsed.segmentId : base.segmentId,
      cycles: Math.max(0, numberOr(parsed.cycles, 0)),
      workSeconds,
      breakSeconds,
    }
    /** 运行中却没有 endsAt：不可恢复，退回空闲（宁可归零，也不要一个永远不动的倒计时）。 */
    if (candidate.status === 'running' && candidate.endsAt === null) {
      return { ...candidate, status: 'idle', remainingSeconds: candidate.segmentSeconds, startedAt: null }
    }
    return candidate
  } catch {
    return base
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function readRecorded(): string[] {
  const raw = storage()?.getItem(RECORDED_KEY)
  if (raw === null || raw === undefined || raw === '') return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function markRecorded(segmentId: string): void {
  const store = storage()
  if (store === null) return
  try {
    const next = [...readRecorded(), segmentId].slice(-RECORDED_MAX)
    store.setItem(RECORDED_KEY, JSON.stringify(next))
  } catch { /* 存储不可用时退化为不持久化 */ }
}

/** 一段专注只记一次（多窗口同时结算时，后到的那一次会被这里挡掉）。 */
function recordOnce(effect: { segmentId: string; durationSeconds: number; startedAt: string }): boolean {
  if (readRecorded().includes(effect.segmentId)) return false
  const started = new Date(effect.startedAt)
  saveSession(effect.durationSeconds, Number.isNaN(started.getTime()) ? new Date() : started)
  markRecorded(effect.segmentId)
  return true
}

let state: PomodoroSession = initialSession({ workSeconds: 25 * 60, breakSeconds: 5 * 60, now: Date.now() })
let restored = false
const listeners = new Set<Listener>()
const completionListeners = new Set<(event: PomodoroCompletion) => void>()
let timer: ReturnType<typeof setInterval> | null = null
let disposed = false

function notify(): void {
  for (const listener of [...listeners]) {
    try { listener() } catch { /* 一个订阅者出错不影响其它与计时本身 */ }
  }
}

function ensureTicker(): void {
  if (typeof setInterval !== 'function') return
  if (state.status !== 'running') {
    if (timer !== null) { clearInterval(timer); timer = null }
    return
  }
  if (timer !== null) return
  timer = setInterval(() => { dispatch({ type: 'tick', now: Date.now() }) }, TICK_MS)
  /**
   * Node 里 `setInterval` 返回 Timeout，**不 unref 会让进程永远不退出** ——
   * 单测进程会因此挂住（实测：整个 `node --test` 卡到超时）。
   * 浏览器里它是数字，没有 unref，所以这里做形状判断而不是直接调用。
   */
  const maybeUnref = (timer as unknown as { unref?: () => void }).unref
  if (typeof maybeUnref === 'function') maybeUnref.call(timer)
}

function persist(): void {
  const store = storage()
  if (store === null) return
  try { store.setItem(SESSION_KEY, JSON.stringify(state)) } catch { /* 存储满/被禁用：只影响恢复，不影响本次计时 */ }
}

function emitCompletion(cycles: number, durationSeconds: number): void {
  for (const listener of [...completionListeners]) {
    try { listener({ phase: 'break', cycles, durationSeconds }) } catch { /* 同上 */ }
  }
}

/**
 * 应用事件（store 内部唯一的状态写入点）。
 *
 * @param event - 见 `pomodoroMachine`。
 * @param options.persist - 是否落盘；默认**仅在状态转换时**落盘（tick 不落盘）。
 */
export function dispatch(event: PomodoroEvent, options: { persist?: boolean } = {}): void {
  if (disposed) return
  restore()
  const before = state
  const result = reducePomodoro(before, event)
  if (!result.changed) return
  state = result.state
  /** 落盘口径：tick 只改剩余秒数 → 不写；其余动作（开始/暂停/重置/跳过/配置/结算）都写。 */
  const shouldPersist = options.persist ?? event.type !== 'tick'
  if (shouldPersist) persist()
  ensureTicker()
  for (const effect of result.effects) {
    if (effect.type === 'record') {
      if (recordOnce(effect)) emitCompletion(result.state.cycles, effect.durationSeconds)
    }
  }
  notify()
}

/** 首次访问时从 localStorage 恢复（含"离开期间已到点"的结算）。 */
export function restore(): void {
  if (restored) return
  restored = true
  const now = Date.now()
  const persisted = readPersisted(now, state.workSeconds, state.breakSeconds)
  const result = restorePomodoro(persisted, now)
  state = result.state
  for (const effect of result.effects) {
    if (effect.type === 'record' && recordOnce(effect)) emitCompletion(state.cycles, effect.durationSeconds)
  }
  ensureTicker()
}

/** 当前快照（**引用稳定**：状态不变时返回同一个对象）。 */
export function getSnapshot(): PomodoroSession {
  restore()
  return state
}

export function subscribe(listener: Listener): () => void {
  restore()
  listeners.add(listener)
  ensureTicker()
  return () => { listeners.delete(listener) }
}

/** 订阅"完成一段专注"（用于提示/通知；不影响计时本身）。 */
export function subscribeCompletion(listener: (event: PomodoroCompletion) => void): () => void {
  completionListeners.add(listener)
  return () => { completionListeners.delete(listener) }
}

/** 把设置里的两个时长同步进 store（下一段生效）。 */
export function configureTimers(workMinutes: number, breakMinutes: number): void {
  dispatch({ type: 'configure', workSeconds: Math.round(workMinutes * 60), breakSeconds: Math.round(breakMinutes * 60) })
}

export const pomodoroActions = {
  start: (): void => { dispatch({ type: 'start', now: Date.now() }) },
  pause: (): void => { dispatch({ type: 'pause', now: Date.now() }) },
  resume: (): void => { dispatch({ type: 'resume', now: Date.now() }) },
  reset: (): void => { dispatch({ type: 'reset', now: Date.now() }) },
  skip: (): void => { dispatch({ type: 'skip', now: Date.now() }) },
  toggle: (): void => {
    restore()
    if (state.status === 'running') dispatch({ type: 'pause', now: Date.now() })
    else if (state.status === 'paused') dispatch({ type: 'resume', now: Date.now() })
    else dispatch({ type: 'start', now: Date.now() })
  },
}

/** 测试/热重载用：停表并清空订阅（生产路径不调用）。 */
export function __resetPomodoroStoreForTest(workSeconds = 25 * 60, breakSeconds = 5 * 60): void {
  if (timer !== null) { clearInterval(timer); timer = null }
  listeners.clear()
  completionListeners.clear()
  state = initialSession({ workSeconds, breakSeconds, now: Date.now() })
  /** 置 false：下一次访问会重新读 storage —— 测试据此模拟"第二个窗口"的恢复路径。 */
  restored = false
  disposed = false
}

export { nextSegmentId }
