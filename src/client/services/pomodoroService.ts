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
 * localStorage 足够，也不需要宿主侧新开接口（那会要求重启宿主）。
 *
 * 存储格式与旧版一致（`{ start: ISO 字符串, duration: 秒 }`），旧数据键名沿用，
 * 因此曾经的记录不会因为换了后端而"消失"。
 */

export interface PomodoroSession {
  /** 本段专注的开始时间（ISO 8601）。 */
  start: string
  /** 本段专注的时长，**秒**。 */
  duration: number
}

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

function readAll(): PomodoroSession[] {
  const storage = store()
  if (storage === null) return []
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (raw === null || raw === '') return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is PomodoroSession =>
      typeof item === 'object' && item !== null
      && typeof (item as PomodoroSession).start === 'string'
      && typeof (item as PomodoroSession).duration === 'number')
  } catch {
    return []
  }
}

function writeAll(sessions: PomodoroSession[]): void {
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

/** 记一段完成的专注。`duration` 是**秒**。 */
export function saveSession(duration: number): void {
  if (!Number.isFinite(duration) || duration <= 0) return
  const all = readAll()
  all.push({ start: new Date().toISOString(), duration })
  writeAll(all)
}

/** 今天的专注总时长，**秒**。 */
export function getDailyTotal(): number {
  const today = new Date().toDateString()
  return readAll()
    .filter((session) => new Date(session.start).toDateString() === today)
    .reduce((sum, session) => sum + session.duration, 0)
}

/** 今天完成的番茄个数。 */
export function getDailyCount(): number {
  const today = new Date().toDateString()
  return readAll().filter((session) => new Date(session.start).toDateString() === today).length
}

/** 清空记录（设置里没用上，留给排障/单测调用）。 */
export function clearAll(): void {
  writeAll([])
}
