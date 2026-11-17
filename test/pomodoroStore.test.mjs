/**
 * 番茄钟 store 的三条**性能纪律** + 一条**多窗口幂等**判据。
 *
 * 这些不是"看着像优化"的建议，而是会真出事的点：
 * 1. 快照引用不稳 → React 认为一直在变 → 每秒几十次渲染；
 * 2. tick 落盘 → 每秒两次同步写；
 * 3. 通知不看"显示秒数是否变化" → 一半是空转；
 * 4. 两个窗口同时结算 → 同一段专注被记两次（多一条番茄、日统计虚高）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const SESSION_KEY = 'dsh-workbench:pomodoro-session'
const LOG_KEY = 'dsh-workbench:pomodoro-logs'

class FakeStorage {
  map = new Map()
  writes = []
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null }
  setItem(key, value) { this.map.set(key, String(value)); this.writes.push(key) }
  removeItem(key) { this.map.delete(key) }
  clear() { this.map.clear(); this.writes = [] }
}

const fake = new FakeStorage()
globalThis.localStorage = fake
const realNow = Date.now
let fakeNow = Date.parse('2026-11-18T09:00:00+08:00')
Date.now = () => fakeNow

const store = await import('../lib/client/services/pomodoroTimer.js')
const logs = () => JSON.parse(fake.getItem(LOG_KEY) ?? '[]')

function resetAll(workSeconds = 60, breakSeconds = 60) {
  fake.clear()
  fakeNow = Date.parse('2026-11-18T09:00:00+08:00')
  store.__resetPomodoroStoreForTest(workSeconds, breakSeconds)
  store.getSnapshot()
}

test('快照引用稳定：状态没变时 getSnapshot() 必须返回同一个对象', () => {
  resetAll()
  const a = store.getSnapshot()
  const b = store.getSnapshot()
  assert.equal(a, b, '每次返回新对象会让 useSyncExternalStore 无限重渲染')
})

test('通知频率：运行中 ≤1 次/秒，暂停后 0 次', () => {
  resetAll(60, 60)
  let notifications = 0
  const off = store.subscribe(() => { notifications += 1 })
  store.dispatch({ type: 'start', now: fakeNow })
  const afterStart = notifications
  assert.equal(afterStart, 1)

  for (let i = 1; i <= 60; i += 1) store.dispatch({ type: 'tick', now: fakeNow + i * 1000 })
  const running = notifications
  assert.ok(running <= 62, `60 秒里通知不应超过 ~62 次，实际 ${running}`)
  assert.ok(running >= 58, `该有的秒级刷新不能省，实际 ${running}`)

  store.dispatch({ type: 'pause', now: fakeNow + 61_000 })
  const afterPause = notifications
  for (let i = 1; i <= 20; i += 1) store.dispatch({ type: 'tick', now: fakeNow + 61_000 + i * 1000 })
  assert.equal(notifications, afterPause, '暂停后 tick 不该产生任何通知')
  off()
})

test('落盘纪律：tick 不写 localStorage，只在状态转换时写', () => {
  resetAll(60, 60)
  fake.writes = []
  store.dispatch({ type: 'start', now: fakeNow })
  const writesAfterStart = fake.writes.filter((k) => k === SESSION_KEY).length
  assert.equal(writesAfterStart, 1, '开始要落盘（否则刷新就丢）')

  fake.writes = []
  for (let i = 1; i <= 30; i += 1) store.dispatch({ type: 'tick', now: fakeNow + i * 1000 })
  assert.equal(fake.writes.filter((k) => k === SESSION_KEY).length, 0, '走时靠 endsAt 重算，不需要每跳写盘')
})

test('结算：一段专注只记一条日志，并触发一次完成事件', () => {
  resetAll(60, 60)
  const completions = []
  const off = store.subscribeCompletion((event) => completions.push(event))
  store.dispatch({ type: 'start', now: fakeNow })
  store.dispatch({ type: 'tick', now: fakeNow + 60_000 })
  assert.equal(logs().length, 1)
  assert.equal(completions.length, 1)
  assert.equal(completions[0].durationSeconds, 60)
  off()
})

test('多窗口幂等：第二个窗口拿到同一段的快照，不会再记一次', () => {
  resetAll(60, 60)
  const T0 = fakeNow
  store.dispatch({ type: 'start', now: fakeNow })
  const running = store.getSnapshot()
  store.dispatch({ type: 'tick', now: fakeNow + 60_000 })
  assert.equal(logs().length, 1)
  const segmentId = running.segmentId

  /** 模拟另一个窗口：它持久化的是同一段（同 segmentId）、已过点的运行快照。 */
  fake.setItem(SESSION_KEY, JSON.stringify({
    ...running,
    status: 'running',
    endsAt: T0 + 60_000,
    remainingSeconds: 0,
  }))
  /** 第二个窗口是在"这段早已到点"之后才被拉起来的。 */
  fakeNow = T0 + 120_000
  store.__resetPomodoroStoreForTest(60, 60)
  const restored = store.getSnapshot()
  assert.equal(restored.status, 'idle')
  assert.equal(logs().length, 1, `同一段不应被记第二次（segmentId=${segmentId}）`)
})

test('恢复：宿主重开后按 endsAt 继续，剩余秒数正确', () => {
  resetAll(60, 60)
  store.dispatch({ type: 'start', now: fakeNow })
  const snapshot = store.getSnapshot()
  fake.setItem(SESSION_KEY, JSON.stringify(snapshot))
  store.__resetPomodoroStoreForTest(60, 60)
  fakeNow += 20_000
  const restored = store.getSnapshot()
  assert.equal(restored.status, 'running')
  assert.equal(restored.remainingSeconds, 40)
})

test('清理：停表 + 恢复原 Date.now（避免影响同进程内的其它测试）', () => {
  store.__resetPomodoroStoreForTest()
  Date.now = realNow
  assert.equal(typeof Date.now(), 'number')
})
