/**
 * 顶栏常驻的番茄钟胶囊。
 *
 * 为什么常驻：计时器是**跨视图的会话**，用户切到日历/知识库/点子时仍然要看得见、点得到。
 * 它只是投影：状态在 `services/pomodoroTimer.ts`，关掉整个工作台也一样在走。
 */
import { usePomodoro } from '../hooks/usePomodoro.js'
import { formatClock } from '../../shared/pomodoro.js'

export function PomodoroChip(): JSX.Element {
  const session = usePomodoro()
  const running = session.status === 'running'
  const phaseLabel = session.phase === 'break' ? '休息' : '专注'
  const title = session.status === 'idle'
    ? `开始一个 ${Math.round(session.workSeconds / 60)} 分钟的专注`
    : `${phaseLabel}中 · ${formatClock(session.remainingSeconds)}（点击${running ? '暂停' : '继续'}）`
  return (
    <button
      type="button"
      className={`wb-pomo-chip${running ? ' running' : ''}${session.phase === 'break' ? ' break' : ''}`}
      data-pomo-status={session.status}
      data-pomo-phase={session.phase}
      title={title}
      aria-label={title}
      onClick={session.toggle}
    >
      <span className="wb-pomo-chip-dot" aria-hidden="true" />
      <span className="wb-pomo-chip-clock">{formatClock(session.remainingSeconds)}</span>
      <span className="wb-pomo-chip-phase">{phaseLabel}</span>
    </button>
  )
}
