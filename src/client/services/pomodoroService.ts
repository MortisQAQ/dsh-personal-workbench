/**
 * 番茄钟记录：**浏览器侧**持久化（localStorage）。
 *
 * ## 为什么不能写文件
 *
 * 2026-11-16 事故：本服务的上一版用 `node:fs` + `node:path` 把记录写到
 * `~/.dsh/workbench/pomodoro-logs.json`。这段代码在 `src/client/**` 下，
 * 会被 tsdown 打进 **浏览器** bundle（`platform: 'browser'`），于是
 * `lib/client.js` 里出现 `require('node:fs')`。而 DSH 的 `__ModuleLoader__`
 * 只认 module table 里的种子词/图行，解析不到就抛
 * `client-modules: cannot resolve "node:fs"` —— **整个工作台面板**加载失败，
 * 不只是番茄钟不显示。
 *
 * 结论：`src/client/**` 里不许出现 `node:*`。记录量很小（一天几十条），
 * localStorage 足够。
 *
 * ## 每日归集的口径
 *
 * 归集（哪些记录算哪一天、缺失日期补 0、时长折算文案）**全部**在
 * `shared/pomodoro.ts`，本文件只负责读写与订阅。两边各写一份的结果就是
 * "统计页按 UTC 分组、记录页按本地分组"这类查不清的偏差。
 *
 * 存储格式与旧版一致（`{ start: ISO 字符串, duration: 秒 }`），旧数据键名沿用，
 * 因此曾经的记录不会因为换了后端而"消失"。
 */
import {
  localDayKey, recentDayKeys, summarizeFocusByDay,
  type FocusDaySummary, type FocusSession,
} from '../../shared/pomodoro.js'

export type { FocusDaySummary, FocusSession }

const STORAGE_KEY = 'dsh-workbench:pomodoro-logs'
/** 只留最近 N 段，防止 localStorage 无限增长（一天几十段，够用一年多）。 */
const MAX_SESSIONS = 5000

const listeners = new Set<() => void>()

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    // 隐私模式/被禁用的存储：抛错比"静默不存"更糟，这里退化成不持久化。
    return null
  }
}

function readAll(): FocusSession[] {
  const storage = store()
  if (storage === null) return []
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (raw === null || raw === '') return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is FocusSession =>
      typeof item === 'object' && item !== null
      && typeof (item as FocusSession).start === 'string'
      && typeof (item as FocusSession).duration === 'number')
  } catch {
    return []
  }
}

function writeAll(sessions: FocusSession[]): void {
  const storage = store()
  if (storage === null) return
  try {
    const trimmed = sessions.length > MAX_SESSIONS ? sessions.slice(sessions.length - MAX_SESSIONS) : sessions
    storage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
  } catch {
    return
  }
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      // 一个订阅者抛错不该影响其他订阅者与计时本身。
    }
  }
}

/** 订阅记录变化（本窗口内即时刷新；跨窗口靠轮询兜底）。 */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * 记一段完成的专注。
 *
 * @param duration - 这段专注的**实际时长**（秒），不是"当前设置里的时长"。
 *   用户中途改时长时，正在跑的那一段按它**开始那一刻**的时长记账
 *   （否则 25 分钟跑完却按新设的 50 记，日统计直接翻倍）。
 * @param startedAt - 这一段的开始时刻；缺省取现在。跨零点的一段算在**开始那天**
 *   （"晚上 23:50 专注到 00:15"记在前一天，与人的直觉一致，也保证同一次专注不会被拆成两天）。
 */
export function saveSession(duration: number, startedAt: Date = new Date()): void {
  if (!Number.isFinite(duration) || duration <= 0) return
  const start = Number.isNaN(startedAt.getTime()) ? new Date() : startedAt
  const all = readAll()
  all.push({ start: start.toISOString(), duration: Math.round(duration) })
  writeAll(all)
}

/**
 * 最近 `count` 天（含今天）的专注汇总，**按时间正序**、缺失日期补 0。
 *
 * @param count - 天数，缺省 7。
 * @param now - 参照时刻（单测注入用）。
 */
export function getRecentDays(count: number = 7, now: Date = new Date()): FocusDaySummary[] {
  return summarizeFocusByDay(readAll(), recentDayKeys(now, count))
}

/** 今天的专注总时长，**秒**。 */
export function getDailyTotal(now: Date = new Date()): number {
  const today = localDayKey(now)
  return readAll()
    .filter((session) => localDayKey(new Date(session.start)) === today)
    .reduce((sum, session) => sum + session.duration, 0)
}

/** 今天完成的番茄个数。 */
export function getDailyCount(now: Date = new Date()): number {
  const today = localDayKey(now)
  return readAll().filter((session) => localDayKey(new Date(session.start)) === today).length
}

/** 清空记录（排障/单测用）。 */
export function clearAll(): void {
  writeAll([])
}
