/**
 * 番茄钟卡片：只剩渲染。状态机与记录在 `usePomodoro`。
 */
import { usePomodoro } from '../hooks/usePomodoro.js'

const formatClock = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

export const PomodoroTimer = () => {
  const { remaining, phase, running, completed, toggle, reset } = usePomodoro()
  return (
    <div className="wb-pomo-card">
      <div className="wb-pomo-head">
        <span className={phase === 'break' ? 'wb-pomo-phase break' : 'wb-pomo-phase'}>
          {phase === 'break' ? '休息时间' : '专注时间'}
        </span>
        <span className="wb-pomo-rounds">{completed > 0 ? `本次已完成 ${completed}` : '番茄钟'}</span>
      </div>
      <div className="wb-pomo-clock">{formatClock(remaining)}</div>
      <div className="wb-pomo-actions">
        <button type="button" className="wb-btn primary" onClick={toggle}>{running ? '暂停' : '开始'}</button>
        <button type="button" className="wb-btn" onClick={reset}>重置</button>
      </div>
    </div>
  )
}
