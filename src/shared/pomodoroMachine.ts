/**
 * 番茄钟**纯状态机**（无 React、无 DOM、无 storage、无定时器）。
 *
 * ## 为什么单独成模块
 *
 * 计时器原先的状态活在某棵组件树里（`usePomodoro` 的 useState），于是"关掉侧栏就没了"、
 * "两个界面各跑一份"。根因不是计时写错，而是**状态所有权没定义**。
 * 现在这里只回答一个问题：**给定状态与一个事件，下一个状态是什么、该产生什么副作用**。
 * 计时由 store 拥有、UI 只做投影，两边都不会再各算一遍。
 *
 * ## 两条刻意的口径
 *
 * 1. **走时用绝对时刻 `endsAt`**：每次 tick 由 `endsAt - now` 重算剩余秒数。
 *    浏览器把后台标签页的定时器节流到 1 次/分钟时，走时依然准确（只是刷新变慢）——
 *    这是"记录每日专注时间"准确性的前提。
 * 2. **记账只发生在"完成的专注段"**：`reset` / `skip` 直接丢弃当前段，不写记录。
 *    这样"番茄数 = 完成数"的口径永远成立，不需要额外解释。
 */

export type PomodoroPhase = 'work' | 'break'
export type PomodoroStatus = 'idle' | 'running' | 'paused'

export interface PomodoroSession {
  phase: PomodoroPhase
  status: PomodoroStatus
  /** 本段的名义时长（秒）—— 记账按它，而不是"当前设置里的时长"。 */
  segmentSeconds: number
  /** 运行中：本段结束的绝对时刻（epoch ms）；暂停/空闲为 `null`。 */
  endsAt: number | null
  /** 暂停/空闲时的剩余秒数；运行中由 `endsAt` 派生（这里保持最后一次计算值）。 */
  remainingSeconds: number
  /** 本段开始的绝对时刻（ISO 8601），记账用；未开始为 `null`。 */
  startedAt: string | null
  /** 本段的唯一 id：跨窗口幂等记账的键。 */
  segmentId: string
  /** 本次会话累计完成的专注段数（跨挂载保留）。 */
  cycles: number
  /** 当前设置里的两个时长（秒），用于下一段。 */
  workSeconds: number
  breakSeconds: number
}

export type PomodoroEvent =
  | { type: 'start'; now: number }
  | { type: 'pause'; now: number }
  | { type: 'resume'; now: number }
  | { type: 'reset'; now: number }
  | { type: 'skip'; now: number }
  | { type: 'tick'; now: number }
  | { type: 'configure'; workSeconds: number; breakSeconds: number }

export type PomodoroEffect =
  /** 一段专注完成了：把它记进日志（`segmentId` 供跨窗口去重）。 */
  | { type: 'record'; segmentId: string; durationSeconds: number; startedAt: string }
  /** 阶段切换（用于提示/通知）。 */
  | { type: 'entered-break'; cycles: number }
  | { type: 'entered-work' }

export interface ReduceResult {
  state: PomodoroSession
  effects: PomodoroEffect[]
  /** 状态是否真的变了（false 时 store 不该通知订阅者）。 */
  changed: boolean
}

let sequence = 0
/** 段 id：时间戳 + 递增序号，够唯一且可读（多窗口也不会撞）。 */
export function nextSegmentId(now: number): string {
  sequence = (sequence + 1) % 100000
  return `seg-${now.toString(36)}-${sequence.toString(36)}`
}

export function initialSession(input: { workSeconds: number; breakSeconds: number; now: number }): PomodoroSession {
  return {
    phase: 'work',
    status: 'idle',
    segmentSeconds: input.workSeconds,
    endsAt: null,
    remainingSeconds: input.workSeconds,
    startedAt: null,
    segmentId: nextSegmentId(input.now),
    cycles: 0,
    workSeconds: input.workSeconds,
    breakSeconds: input.breakSeconds,
  }
}

/** 运行中：按 `endsAt` 重算剩余秒数（可能为 0）。 */
function remainingOf(state: PomodoroSession, now: number): number {
  if (state.status !== 'running' || state.endsAt === null) return state.remainingSeconds
  return Math.max(0, Math.ceil((state.endsAt - now) / 1000))
}

function change(state: PomodoroSession, patch: Partial<PomodoroSession>): ReduceResult {
  return { state: { ...state, ...patch }, effects: [], changed: true }
}

const unchanged = (state: PomodoroSession): ReduceResult => ({ state, effects: [], changed: false })

/**
 * 应用一个事件。
 *
 * @param state - 当前会话。
 * @param event - 见 {@link PomodoroEvent}。
 * @returns 新状态 + 副作用 + 是否变化。
 */
export function reducePomodoro(state: PomodoroSession, event: PomodoroEvent): ReduceResult {
  switch (event.type) {
    case 'configure': {
      const workSeconds = Math.max(1, Math.round(event.workSeconds))
      const breakSeconds = Math.max(1, Math.round(event.breakSeconds))
      if (workSeconds === state.workSeconds && breakSeconds === state.breakSeconds) return unchanged(state)
      /** 只在空闲/暂停时改时长：运行中的段有它自己的协议，中途改只会让人怀疑计时器坏了。 */
      const idle = state.status !== 'running'
      const next: Partial<PomodoroSession> = { workSeconds, breakSeconds }
      if (idle) {
        const target = state.phase === 'work' ? workSeconds : breakSeconds
        next.segmentSeconds = target
        next.remainingSeconds = state.status === 'paused' ? Math.min(state.remainingSeconds, target) : target
      }
      return change(state, next)
    }
    case 'start': {
      if (state.status === 'running') return unchanged(state)
      const seconds = state.status === 'paused' ? Math.max(1, state.remainingSeconds) : state.segmentSeconds
      return change(state, {
        status: 'running',
        endsAt: event.now + seconds * 1000,
        remainingSeconds: seconds,
        startedAt: state.startedAt ?? new Date(event.now).toISOString(),
      })
    }
    case 'pause': {
      if (state.status !== 'running') return unchanged(state)
      return change(state, { status: 'paused', endsAt: null, remainingSeconds: remainingOf(state, event.now) })
    }
    case 'resume': {
      if (state.status !== 'paused') return unchanged(state)
      const seconds = Math.max(1, state.remainingSeconds)
      return change(state, {
        status: 'running',
        endsAt: event.now + seconds * 1000,
        startedAt: state.startedAt ?? new Date(event.now).toISOString(),
      })
    }
    case 'reset': {
      return change(state, {
        phase: 'work',
        status: 'idle',
        endsAt: null,
        remainingSeconds: state.workSeconds,
        segmentSeconds: state.workSeconds,
        startedAt: null,
        segmentId: nextSegmentId(event.now),
      })
    }
    case 'skip': {
      /** 跳过不记账（见文件头第 2 条口径）。 */
      const toBreak = state.phase === 'work'
      const seconds = toBreak ? state.breakSeconds : state.workSeconds
      return {
        state: {
          ...state,
          phase: toBreak ? 'break' : 'work',
          status: 'idle',
          endsAt: null,
          segmentSeconds: seconds,
          remainingSeconds: seconds,
          startedAt: null,
          segmentId: nextSegmentId(event.now),
        },
        effects: [toBreak ? { type: 'entered-break', cycles: state.cycles } : { type: 'entered-work' }],
        changed: true,
      }
    }
    case 'tick': {
      if (state.status !== 'running') return unchanged(state)
      const remaining = remainingOf(state, event.now)
      if (remaining > 0) {
        return remaining === state.remainingSeconds ? unchanged(state) : change(state, { remainingSeconds: remaining })
      }
      /** 到点结算。 */
      if (state.phase === 'work') {
        const effects: PomodoroEffect[] = []
        if (state.startedAt !== null) {
          effects.push({
            type: 'record',
            segmentId: state.segmentId,
            durationSeconds: state.segmentSeconds,
            startedAt: state.startedAt,
          })
        }
        effects.push({ type: 'entered-break', cycles: state.cycles + 1 })
        return {
          state: {
            ...state,
            phase: 'break',
            status: 'running',
            segmentSeconds: state.breakSeconds,
            endsAt: event.now + state.breakSeconds * 1000,
            remainingSeconds: state.breakSeconds,
            startedAt: new Date(event.now).toISOString(),
            segmentId: nextSegmentId(event.now),
            cycles: state.cycles + 1,
          },
          effects,
          changed: true,
        }
      }
      return {
        state: {
          ...state,
          phase: 'work',
          status: 'idle',
          segmentSeconds: state.workSeconds,
          endsAt: null,
          remainingSeconds: state.workSeconds,
          startedAt: null,
          segmentId: nextSegmentId(event.now),
        },
        effects: [{ type: 'entered-work' }],
        changed: true,
      }
    }
  }
}

/**
 * 从持久化快照恢复。
 *
 * 三条口径：
 * 1. 空闲/暂停：原样恢复剩余秒数；
 * 2. 运行中且未到点：**保持运行**，剩余按 `endsAt` 重算（离开多久都认）；
 * 3. 运行中且已过点：结算这一**段**并停在"待开始"（**不**自动连跑后面的段——
 *    你关了两小时，不该凭空多出四个番茄）。
 */
export function restorePomodoro(snapshot: PomodoroSession, now: number): ReduceResult {
  if (snapshot.status !== 'running') return { state: snapshot, effects: [], changed: false }
  const remaining = remainingOf(snapshot, now)
  if (remaining > 0) return { state: { ...snapshot, remainingSeconds: remaining }, effects: [], changed: true }
  const effects: PomodoroEffect[] = []
  if (snapshot.phase === 'work' && snapshot.startedAt !== null) {
    effects.push({ type: 'record', segmentId: snapshot.segmentId, durationSeconds: snapshot.segmentSeconds, startedAt: snapshot.startedAt })
  }
  return {
    state: {
      ...snapshot,
      phase: 'work',
      status: 'idle',
      endsAt: null,
      segmentSeconds: snapshot.workSeconds,
      remainingSeconds: snapshot.workSeconds,
      startedAt: null,
      segmentId: nextSegmentId(now),
      cycles: snapshot.phase === 'work' ? snapshot.cycles + 1 : snapshot.cycles,
    },
    effects,
    changed: true,
  }
}
