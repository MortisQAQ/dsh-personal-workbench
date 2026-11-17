/**
 * 今日番茄统计：订阅记录变化即时刷新，另有 30s 轮询兜底跨窗口/跨天。
 */
import { useEffect, useState } from 'react'
import { getDailyCount, getDailyTotal, subscribe } from '../services/pomodoroService.js'

export const DailyStats = () => {
  const [total, setTotal] = useState(() => getDailyTotal())
  const [count, setCount] = useState(() => getDailyCount())

  useEffect(() => {
    const read = () => {
      setTotal(getDailyTotal())
      setCount(getDailyCount())
    }
    read()
    const unsubscribe = subscribe(read)
    const timer = setInterval(read, 30_000)
    return () => {
      unsubscribe()
      clearInterval(timer)
    }
  }, [])

  return (
    <div className="wb-pomo-stats">
      今日已专注 {Math.floor(total / 60)} 分钟{count > 0 ? ` · ${count} 个番茄` : ''}
    </div>
  )
}
