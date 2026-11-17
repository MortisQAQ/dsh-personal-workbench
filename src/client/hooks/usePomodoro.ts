/**
 * 番茄钟状态机：专注 → 休息 → 专注。
 *
 * 与上一版的差别（2026-11-16）：
 * - **完成一段专注时真的会记录**。上一版的记录条件写在 `PomodoroTimer` 的 effect 里
 *   （`!isActive && timeLeft === 0 && !isBreak`），而钩子在专注结束时先切到休息并重置
 *   时长，这个条件永远不成立 —— 于是"今日已专注"恒为 0。
 * - 记录动作收敛到本钩子（唯一知道"一段专注结束了"的地方），组件只负责渲染。
 * - 定时器类型不写 `NodeJS.Timeout`（浏览器里没有这个全局类型）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { saveSession } from '../services/pomodoroService.js'

export type PomodoroPhase = 'work' | 'break'

export interface PomodoroState {
  /** 剩余秒数。 */
  remaining: number
  phase: PomodoroPhase
  running: boolean
  /** 本次挂载后完成的番茄数（持久统计见 `DailyStats`）。 */
  completed: number
  toggle: () => void
  reset: () => void
}

export const usePomodoro = (workDuration: number = 25 * 60, breakDuration: number = 5 * 60): PomodoroState => {
  const [remaining, setRemaining] = useState(workDuration)
  const [phase, setPhase] = useState<PomodoroPhase>('work')
  const [running, setRunning] = useState(false)
  const [completed, setCompleted] = useState(0)
  /**
   * 一次"归零"只处理一次。
   *
   * 没有这个闸门时，React 18 的严格模式会双跑 effect —— 一段专注被记两次。
   * 归零结算后把 remaining 重置成 >0，effect 会用 same-run 的旧值再进来一次。
   */
  const settled = useRef(false)

  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => {
      setRemaining((value) => (value > 0 ? value - 1 : 0))
    }, 1000)
    return () => clearInterval(timer)
  }, [running])

  useEffect(() => {
    if (remaining > 0) {
      settled.current = false
      return
    }
    if (settled.current) return
    settled.current = true
    if (phase === 'work') {
      saveSession(workDuration)
      setCompleted((value) => value + 1)
      setPhase('break')
      setRemaining(breakDuration)
      return
    }
    setPhase('work')
    setRemaining(workDuration)
    setRunning(false)
  }, [remaining, phase, workDuration, breakDuration])

  const toggle = useCallback(() => {
    setRunning((value) => !value)
  }, [])

  const reset = useCallback(() => {
    setRunning(false)
    setPhase('work')
    setRemaining(workDuration)
    settled.current = false
  }, [workDuration])

  return { remaining, phase, running, completed, toggle, reset }
}
