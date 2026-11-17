/**
 * 番茄钟状态机：专注 → 休息 → 专注。
 *
 * ## 两处关键口径（2026-11-17 重写）
 *
 * 1. **倒计时按时间戳算，不靠 tick 累加**。
 *    老实现每秒 `setRemaining(v => v - 1)`：浏览器把后台标签页的定时器节流到
 *    1 次/分钟时，25 分钟的专注要跑 25 分钟才走 25 格 —— "专注了多久"直接失真，
 *    而本次需求正是"记录每日专注时间"。现在存 `deadline`，每次 tick 用
 *    `ceil((deadline - now)/1000)` 重新算，节流只影响刷新频率，不影响走时。
 *
 * 2. **记账用的是这一段自己的时长**，不是"当前设置里的时长"。
 *    用户跑到第 10 分钟把专注改成 50 分钟，这一段仍按开始时的 25 分钟记账；
 *    否则日统计会凭空翻倍（老的 `saveSession(workDuration)` 就有这个问题）。
 *
 * 记录的其它约定见 `pomodoroService.saveSession`：跨零点的一段算在开始那天。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { saveSession } from '../services/pomodoroService.js'
import { POMODORO_BREAK_MINUTES_DEFAULT, POMODORO_WORK_MINUTES_DEFAULT, clampPomodoroMinutes } from '../../shared/pomodoro.js'

export type PomodoroPhase = 'work' | 'break'

export interface PomodoroState {
  /** 剩余秒数。 */
  remaining: number
  phase: PomodoroPhase
  running: boolean
  /** 本次挂载后完成的番茄数（持久统计见 `DailyStats`）。 */
  completed: number
  /** 生效中的专注/休息时长（分钟，已夹取）。 */
  workMinutes: number
  breakMinutes: number
  toggle: () => void
  reset: () => void
}

export interface UsePomodoroOptions {
  /** 专注时长（分钟）；越界会被夹到 1–180。 */
  workMinutes?: number
  /** 休息时长（分钟）；越界会被夹到 1–180。 */
  breakMinutes?: number
}

export const usePomodoro = ({ workMinutes, breakMinutes }: UsePomodoroOptions = {}): PomodoroState => {
  const work = clampPomodoroMinutes(workMinutes, POMODORO_WORK_MINUTES_DEFAULT) * 60
  const rest = clampPomodoroMinutes(breakMinutes, POMODORO_BREAK_MINUTES_DEFAULT) * 60

  const [remaining, setRemaining] = useState(work)
  const [phase, setPhase] = useState<PomodoroPhase>('work')
  const [running, setRunning] = useState(false)
  const [completed, setCompleted] = useState(0)

  /** 本段结束的墙钟时刻（毫秒）；暂停时为 null。 */
  const deadline = useRef<number | null>(null)
  /** 本段开始时刻（记账用）。 */
  const segmentStart = useRef<Date | null>(null)
  /** 本段的名义时长（秒）—— 记账按它，而不是"当前设置"。 */
  const segmentSeconds = useRef(work)
  /** 一次"归零"只结算一次（严格模式会双跑 effect）。 */
  const settled = useRef(false)

  /**
   * 按时钟重算剩余，而不是自减。
   *
   * 500ms 一跳：秒数不会因为节流而慢，同时比 1s 更不容易出现"数着数着跳两下"。
   */
  useEffect(() => {
    if (!running) return
    const tick = (): void => {
      const end = deadline.current
      if (end === null) return
      setRemaining(Math.max(0, Math.ceil((end - Date.now()) / 1000)))
    }
    tick()
    const timer = setInterval(tick, 500)
    return () => clearInterval(timer)
  }, [running])

  /** 结算：专注段记账并进入休息；休息段结束回到待开始的专注。 */
  useEffect(() => {
    if (!running || remaining > 0) {
      if (remaining > 0) settled.current = false
      return
    }
    if (settled.current) return
    settled.current = true
    if (phase === 'work') {
      saveSession(segmentSeconds.current, segmentStart.current ?? new Date())
      setCompleted((value) => value + 1)
      /** 休息自动开跑（保持原来的手感），并按**当前设置**的休息时长起算。 */
      setPhase('break')
      segmentSeconds.current = rest
      segmentStart.current = new Date()
      deadline.current = Date.now() + rest * 1000
      setRemaining(rest)
      return
    }
    setPhase('work')
    setRunning(false)
    deadline.current = null
    segmentStart.current = null
    segmentSeconds.current = work
    setRemaining(work)
  }, [running, remaining, phase, rest, work])

  /**
   * 空闲时跟随设置变化（"改完立刻看到新的分钟数"）。
   *
   * 跑着的时候**不动**：正在计时的这一段有它自己的协议，中途改设置只会让人怀疑计时器坏了。
   */
  useEffect(() => {
    if (running) return
    const target = phase === 'work' ? work : rest
    segmentSeconds.current = target
    segmentStart.current = null
    deadline.current = null
    settled.current = false
    setRemaining(target)
  }, [running, phase, work, rest])

  /**
   * 开始 / 暂停。
   *
   * 刻意**不用** `setRunning(prev => …)` 的写法：React 要求更新函数是纯的，
   * 而这里要顺手改 deadline/segmentStart 两个 ref —— 在更新函数里做副作用，
   * 严格模式下会被执行两次（第二次还可能带着过期的 remaining）。
   */
  const toggle = useCallback(() => {
    if (running) {
      /** 暂停：把墙钟换算成剩余秒数，避免"暂停期间继续流逝"。 */
      const end = deadline.current
      if (end !== null) setRemaining(Math.max(0, Math.ceil((end - Date.now()) / 1000)))
      deadline.current = null
      setRunning(false)
      return
    }
    if (segmentStart.current === null) segmentStart.current = new Date()
    deadline.current = Date.now() + Math.max(0, remaining) * 1000
    setRunning(true)
  }, [running, remaining])

  const reset = useCallback(() => {
    setRunning(false)
    setPhase('work')
    deadline.current = null
    segmentStart.current = null
    segmentSeconds.current = work
    settled.current = false
    setRemaining(work)
  }, [work])

  return {
    remaining,
    phase,
    running,
    completed,
    workMinutes: Math.round(work / 60),
    breakMinutes: Math.round(rest / 60),
    toggle,
    reset,
  }
}
