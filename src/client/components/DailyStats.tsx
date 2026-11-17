/**
 * 每日专注统计：今天一行 + 最近 7 天柱状。
 *
 * 归集口径全在 `shared/pomodoro.ts`（本地自然日、缺失日期补 0），本组件只画。
 * 订阅记录变化即时刷新，另有 30s 轮询兜底跨窗口/跨天。
 */
import { useEffect, useState } from 'react'
import { getRecentDays, subscribe, type FocusDaySummary } from '../services/pomodoroService.js'
import { formatFocusDuration } from '../../shared/pomodoro.js'

/** 柱高上限（px）：低于它才画真实比例，避免把 1 分钟画成满格。 */
const BAR_MAX_PX = 26

const weekdayOf = (day: string): string => {
  const parts = day.split('-')
  if (parts.length !== 3) return ''
  const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
  return ['日', '一', '二', '三', '四', '五', '六'][date.getDay()] ?? ''
}

export const DailyStats = (): JSX.Element => {
  const [days, setDays] = useState<FocusDaySummary[]>(() => getRecentDays(7))

  useEffect(() => {
    const read = (): void => setDays(getRecentDays(7))
    read()
    const unsubscribe = subscribe(read)
    const timer = setInterval(read, 30_000)
    return () => {
      unsubscribe()
      clearInterval(timer)
    }
  }, [])

  const today = days.length === 0 ? undefined : days[days.length - 1]
  const peak = Math.max(1, ...days.map((day) => day.seconds))
  const weekTotal = days.reduce((sum, day) => sum + day.seconds, 0)

  return (
    <div className="wb-pomo-stats">
      <div className="wb-pomo-today">
        今日已专注 {formatFocusDuration(today?.seconds ?? 0)}
        {(today?.sessions ?? 0) > 0 ? ` · ${today?.sessions} 个番茄` : ''}
      </div>
      <div className="wb-pomo-trend" role="list" aria-label="最近 7 天专注时长">
        {days.map((day, index) => {
          const isToday = index === days.length - 1
          const height = day.seconds === 0 ? 2 : Math.max(3, Math.round((day.seconds / peak) * BAR_MAX_PX))
          return (
            <div
              key={day.day}
              className={`wb-pomo-bar-col${isToday ? ' today' : ''}${day.seconds === 0 ? ' empty' : ''}`}
              role="listitem"
              title={`${day.day}：${formatFocusDuration(day.seconds)}${day.sessions > 0 ? `（${day.sessions} 个番茄）` : ''}`}
            >
              <i className="wb-pomo-bar" style={{ height: `${height}px` }} />
              <span className="wb-pomo-bar-label">{isToday ? '今' : weekdayOf(day.day)}</span>
            </div>
          )
        })}
      </div>
      <div className="wb-pomo-week">近 7 天合计 {formatFocusDuration(weekTotal)}</div>
    </div>
  )
}
