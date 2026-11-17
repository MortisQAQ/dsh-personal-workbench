/**
 * 番茄钟的**纯逻辑**（前后端共用）：时长边界、按自然日归集专注记录。
 *
 * ## 为什么单独成模块
 *
 * 三处都要同一套口径：服务端落库前夹取时长、客户端编辑框校验、统计把秒数折成
 * "某一天多少分钟"。任何一处各写一遍，就会出现"设置页显示 25、计时器跑 30"
 * 这类无法归因的分叉（本仓最大的 bug 类别）。
 *
 * 约束：**不 import React、不碰 DOM、不读 localStorage** —— 因此能被 `node --test` 直接测。
 */

/** 专注时长的缺省值（分钟）。与契约里的字段说明同值。 */
export const POMODORO_WORK_MINUTES_DEFAULT = 25
/** 休息时长的缺省值（分钟）。 */
export const POMODORO_BREAK_MINUTES_DEFAULT = 5
/** 时长下界（分钟）：1 分钟以下无法形成"一段专注"。 */
export const POMODORO_MIN_MINUTES = 1
/** 时长上界（分钟）：3 小时；超出它更像是忘记停止而不是计划中的一段。 */
export const POMODORO_MAX_MINUTES = 180

/**
 * 把任意输入夹成"合法的番茄钟分钟数"。
 *
 * 语义是**夹取而不是拒绝**：越界值按边界落库/落屏，绝不静默丢弃
 * （用户输入 999 得到 180 比"点了保存却什么都没变"可解释得多）。
 * 非数字/空串才回落到 `fallback`。
 *
 * @param value - 待归一化的输入（来自设置响应、表单或 localStorage）。
 * @param fallback - 输入完全不可用时采用的缺省值。
 * @returns 1–180 之间的整数分钟。
 */
export function clampPomodoroMinutes(value: unknown, fallback: number): number {
  const safeFallback = clampInt(fallback, POMODORO_MIN_MINUTES, POMODORO_MAX_MINUTES, POMODORO_WORK_MINUTES_DEFAULT)
  const parsed = typeof value === 'number' ? value : (typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN)
  if (!Number.isFinite(parsed)) return safeFallback
  return clampInt(Math.round(parsed), POMODORO_MIN_MINUTES, POMODORO_MAX_MINUTES, safeFallback)
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

/** 一段已完成的专注（与 `pomodoroService` 的存储形状一致）。 */
export interface FocusSession {
  /** 开始时间（ISO 8601）。 */
  readonly start: string
  /** 时长，**秒**。 */
  readonly duration: number
}

/** 某一天的专注汇总。 */
export interface FocusDaySummary {
  /** 本地自然日 `YYYY-MM-DD`。 */
  readonly day: string
  /** 当天专注总时长（秒）。 */
  readonly seconds: number
  /** 当天完成的段数。 */
  readonly sessions: number
}

/**
 * 本地自然日键（`YYYY-MM-DD`）。
 *
 * ⚠️ 不能用 `toDateString()` —— 它随 locale 变化（英文/中文浏览器给出不同串），
 * 而"今天是哪一天"必须对同一台机器的所有窗口一致；也不能用 `toISOString()`
 * 的 UTC 日期：东八区 00:30 的专注会被算到前一天。
 *
 * @param date - 任意时刻（按本机时区取年月日）。
 * @returns 形如 `2026-11-17` 的键；无效日期返回空串（调用方据此过滤）。
 */
export function localDayKey(date: Date): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * 从 `now` 往前数 `count` 天的日键，**按时间正序**（最早的在前面），最后一个是今天。
 *
 * 用"本地年月日构造新 Date"而不是 `now - i*86400000`：后者在夏令时切换那天会
 * 偏一小时，跨月时还可能算错日期。
 *
 * @param now - 参照时刻。
 * @param count - 需要几天（至少 1）。
 */
export function recentDayKeys(now: Date, count: number): string[] {
  const total = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1
  const base = Number.isNaN(now.getTime()) ? new Date() : now
  const keys: string[] = []
  for (let offset = total - 1; offset >= 0; offset -= 1) {
    keys.push(localDayKey(new Date(base.getFullYear(), base.getMonth(), base.getDate() - offset)))
  }
  return keys
}

/**
 * 把专注记录按给定日期归集。
 *
 * 只统计 `dayKeys` 里出现的日子（其余日子的记录不进结果，也不做丢弃提示：
 * 这是"取最近 N 天"的视图，不是数据清理）。顺序与 `dayKeys` 一致，**缺失的日期补 0**，
 * 这样柱状图不会因为某天没记录而错位。
 *
 * @param sessions - 全部记录（可能含更早日期的）。
 * @param dayKeys - 需要的日期键，通常来自 {@link recentDayKeys}。
 */
export function summarizeFocusByDay(sessions: readonly FocusSession[], dayKeys: readonly string[]): FocusDaySummary[] {
  const table = new Map<string, { seconds: number; sessions: number }>()
  for (const key of dayKeys) table.set(key, { seconds: 0, sessions: 0 })
  for (const session of sessions) {
    if (typeof session?.start !== 'string') continue
    const parsed = new Date(session.start)
    const key = localDayKey(parsed)
    if (key === '') continue
    const bucket = table.get(key)
    if (bucket === undefined) continue
    const seconds = Number.isFinite(session.duration) && session.duration > 0 ? session.duration : 0
    if (seconds === 0) continue
    bucket.seconds += seconds
    bucket.sessions += 1
  }
  return dayKeys.map((day) => ({ day, seconds: table.get(day)?.seconds ?? 0, sessions: table.get(day)?.sessions ?? 0 }))
}

/**
 * 人类可读的专注时长（用于"今日已专注 …"）。
 *
 * @param seconds - 秒数。
 * @returns 例如 `1 小时 20 分钟` / `35 分钟` / `不足 1 分钟`。
 */
export function formatFocusDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0 分钟'
  const minutes = Math.floor(seconds / 60)
  if (minutes === 0) return '不足 1 分钟'
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分钟`
}
