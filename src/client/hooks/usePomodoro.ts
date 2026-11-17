/**
 * 番茄钟的 **React 适配层**（薄到只剩订阅）。
 *
 * 状态机与持久化都在 `services/pomodoroTimer.ts`；这里不持有任何计时 state——
 * 于是"关掉界面计时就没了"这类问题在结构上不可能再出现。
 *
 * `useSyncExternalStore` 的快照必须**引用稳定**（store 已保证），否则 React 会
 * 认为一直在变、每秒渲染几十次。
 */
import { useSyncExternalStore } from 'react'
import { getSnapshot, pomodoroActions, subscribe } from '../services/pomodoroTimer.js'
import type { PomodoroPhase, PomodoroSession, PomodoroStatus } from '../../shared/pomodoroMachine.js'

export type { PomodoroPhase, PomodoroStatus }

export interface PomodoroView extends PomodoroSession {
  /** 开始 / 暂停 / 继续（按当前状态自动选）。 */
  toggle: () => void
  /** 丢掉当前段，回到"待开始"（不记账）。 */
  reset: () => void
  /** 跳到下一阶段（不记账）。 */
  skip: () => void
}

export function usePomodoro(): PomodoroView {
  const session = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { ...session, ...pomodoroActions }
}
