/**
 * 番茄钟卡片（工作台「专注工具」里的完整控件）。
 *
 * 状态机在 `services/pomodoroTimer.ts`（模块级单例），这里只渲染与发出意图；
 * 时长是**偏好**（WorkbenchSettings），改完同步进 store，下一段生效。
 */
import { useEffect, useState } from 'react'
import { usePomodoro } from '../hooks/usePomodoro.js'
import { configureTimers } from '../services/pomodoroTimer.js'
import { POMODORO_MAX_MINUTES, POMODORO_MIN_MINUTES, clampPomodoroMinutes, formatClock } from '../../shared/pomodoro.js'

/**
 * 一个分钟输入框。
 *
 * 提交时机是**失焦或回车**，不是每次按键：逐字保存会在把 25 改成 5 的过程中
 * 先把 25 擦成 2 再落库（一次输入触发两次写入）。
 * 失焦后回填的是**夹取过的真值**，所以填 999 会当场变成 180，而不是"看起来存了"。
 */
function DurationField(props: {
  label: string
  value: number
  disabled: boolean
  onCommit: (minutes: number) => void
}): JSX.Element {
  const { label, value, disabled, onCommit } = props
  const [draft, setDraft] = useState(String(value))

  useEffect(() => {
    setDraft(String(value))
  }, [value])

  const commit = (): void => {
    const next = clampPomodoroMinutes(draft, value)
    setDraft(String(next))
    if (next !== value) onCommit(next)
  }

  return (
    <label className="wb-pomo-dur">
      <span className="wb-pomo-dur-label">{label}</span>
      <input
        type="number"
        className="wb-pomo-dur-input"
        inputMode="numeric"
        min={POMODORO_MIN_MINUTES}
        max={POMODORO_MAX_MINUTES}
        step={1}
        value={draft}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') setDraft(String(value))
        }}
      />
      <span className="wb-pomo-unit">分钟</span>
    </label>
  )
}

export interface PomodoroTimerProps {
  /** 专注时长（分钟）。 */
  workMinutes: number
  /** 休息时长（分钟）。 */
  breakMinutes: number
  /** 保存偏好；缺省时输入框禁用（拿不到设置域就不该给出"看起来能改"的控件）。 */
  onSaveDurations?: (patch: { work?: number; breakMinutes?: number }) => void
}

export const PomodoroTimer = (props: PomodoroTimerProps): JSX.Element => {
  const { workMinutes, breakMinutes, onSaveDurations } = props
  const session = usePomodoro()
  const editable = onSaveDurations !== undefined
  const running = session.status === 'running'

  /** 设置 → store 的单向同步（store 是计时的唯一权威源，时长只是它的配置）。 */
  useEffect(() => {
    configureTimers(workMinutes, breakMinutes)
  }, [workMinutes, breakMinutes])

  const buttonLabel = running ? '暂停' : session.status === 'paused' ? '继续' : '开始'

  return (
    <div className="wb-pomo-card">
      <div className="wb-pomo-head">
        <span className={session.phase === 'break' ? 'wb-pomo-phase break' : 'wb-pomo-phase'}>
          {session.phase === 'break' ? '休息时间' : '专注时间'}
        </span>
        <span className="wb-pomo-rounds">{session.cycles > 0 ? `本次已完成 ${session.cycles}` : '番茄钟'}</span>
      </div>
      <div className="wb-pomo-clock">{formatClock(session.remainingSeconds)}</div>
      <div className="wb-pomo-actions">
        <button type="button" className="wb-btn primary" onClick={session.toggle}>{buttonLabel}</button>
        <button type="button" className="wb-btn" onClick={session.reset}>重置</button>
        <button type="button" className="wb-btn" onClick={session.skip}>跳过</button>
      </div>
      <div className="wb-pomo-durations">
        <DurationField
          label="专注"
          value={workMinutes}
          disabled={!editable}
          onCommit={(minutes) => onSaveDurations?.({ work: minutes })}
        />
        <DurationField
          label="休息"
          value={breakMinutes}
          disabled={!editable}
          onCommit={(minutes) => onSaveDurations?.({ breakMinutes: minutes })}
        />
      </div>
      {running && <div className="wb-pomo-hint">计时中改时长，从下一段生效</div>}
    </div>
  )
}
