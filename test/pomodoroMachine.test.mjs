/**
 * 番茄钟状态机单测（`shared/pomodoroMachine.ts`）。
 *
 * 这台机器是"计时器不再随界面生死"的地基，所以判据要钉到**副作用**这一级：
 * 什么时候产生 `record`、什么时候不产生、`changed` 什么时候为假（store 据此决定通不通知）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { initialSession, reducePomodoro, restorePomodoro } from '../lib/shared/pomodoroMachine.js'

const T0 = Date.parse('2026-11-18T09:00:00+08:00')
const base = () => initialSession({ workSeconds: 1500, breakSeconds: 300, now: T0 })

test('start：进入运行态，endsAt = now + 段时长，并记下开始时刻', () => {
  const r = reducePomodoro(base(), { type: 'start', now: T0 })
  assert.equal(r.state.status, 'running')
  assert.equal(r.state.phase, 'work')
  assert.equal(r.state.endsAt, T0 + 1500_000)
  assert.equal(r.state.remainingSeconds, 1500)
  assert.equal(r.state.startedAt, new Date(T0).toISOString())
  assert.deepEqual(r.effects, [])
  assert.equal(r.changed, true)
})

test('tick：同一秒内重复调用不产生变化（否则会每秒渲染几十次）', () => {
  const started = reducePomodoro(base(), { type: 'start', now: T0 }).state
  const a = reducePomodoro(started, { type: 'tick', now: T0 + 1000 })
  assert.equal(a.state.remainingSeconds, 1499)
  assert.equal(a.changed, true)
  const b = reducePomodoro(a.state, { type: 'tick', now: T0 + 1200 })
  assert.equal(b.changed, false, '同一秒内的第二次 tick 必须原样返回')
  assert.equal(b.state, a.state, '必须返回同一个对象引用')
})

test('pause/resume：暂停冻结剩余秒数，继续后从冻结值接着走', () => {
  const started = reducePomodoro(base(), { type: 'start', now: T0 }).state
  const paused = reducePomodoro(started, { type: 'pause', now: T0 + 60_000 })
  assert.equal(paused.state.status, 'paused')
  assert.equal(paused.state.endsAt, null)
  assert.equal(paused.state.remainingSeconds, 1440)
  /** 暂停期间 tick 不推进。 */
  const stillPaused = reducePomodoro(paused.state, { type: 'tick', now: T0 + 600_000 })
  assert.equal(stillPaused.changed, false)
  assert.equal(stillPaused.state.remainingSeconds, 1440)
  const resumed = reducePomodoro(paused.state, { type: 'resume', now: T0 + 600_000 })
  assert.equal(resumed.state.status, 'running')
  assert.equal(resumed.state.endsAt, T0 + 600_000 + 1440_000)
  assert.equal(resumed.state.startedAt, paused.state.startedAt, '继续不换开始时刻（记账按这一段）')
})

test('专注到点：产生一次 record，切到休息并自动开跑，cycles+1', () => {
  const started = reducePomodoro(base(), { type: 'start', now: T0 }).state
  const r = reducePomodoro(started, { type: 'tick', now: T0 + 1500_000 })
  assert.equal(r.state.phase, 'break')
  assert.equal(r.state.status, 'running')
  assert.equal(r.state.cycles, 1)
  assert.equal(r.state.endsAt, T0 + 1500_000 + 300_000)
  const record = r.effects.find((e) => e.type === 'record')
  assert.ok(record, '必须产生 record 副作用')
  assert.equal(record.durationSeconds, 1500)
  assert.equal(record.startedAt, new Date(T0).toISOString())
  assert.equal(record.segmentId, started.segmentId)
})

test('休息到点：不产生 record，回到待开始的专注', () => {
  const started = reducePomodoro(base(), { type: 'start', now: T0 }).state
  const onBreak = reducePomodoro(started, { type: 'tick', now: T0 + 1500_000 }).state
  const r = reducePomodoro(onBreak, { type: 'tick', now: T0 + 1800_000 })
  assert.equal(r.state.phase, 'work')
  assert.equal(r.state.status, 'idle')
  assert.equal(r.state.remainingSeconds, 1500)
  assert.equal(r.effects.some((e) => e.type === 'record'), false)
})

test('reset / skip：丢掉当前段且**不记账**（番茄数 = 完成数）', () => {
  const started = reducePomodoro(base(), { type: 'start', now: T0 }).state
  const reset = reducePomodoro(started, { type: 'reset', now: T0 + 60_000 })
  assert.equal(reset.state.status, 'idle')
  assert.equal(reset.state.remainingSeconds, 1500)
  assert.equal(reset.state.startedAt, null)
  assert.equal(reset.effects.some((e) => e.type === 'record'), false)
  assert.notEqual(reset.state.segmentId, started.segmentId, '重置要换段 id，避免记到上一段的账')

  const skipped = reducePomodoro(started, { type: 'skip', now: T0 + 60_000 })
  assert.equal(skipped.state.phase, 'break')
  assert.equal(skipped.state.status, 'idle')
  assert.equal(skipped.effects.some((e) => e.type === 'record'), false)
})

test('configure：空闲时立刻换时长，运行中不动当前段（下一段生效）', () => {
  const idle = reducePomodoro(base(), { type: 'configure', workSeconds: 60, breakSeconds: 30 })
  assert.equal(idle.state.remainingSeconds, 60)
  assert.equal(idle.state.workSeconds, 60)
  const running = reducePomodoro({ ...base(), status: 'running', endsAt: T0 + 1500_000, remainingSeconds: 1500 },
    { type: 'configure', workSeconds: 60, breakSeconds: 30 })
  assert.equal(running.state.remainingSeconds, 1500, '运行中的段不受影响')
  assert.equal(running.state.workSeconds, 60, '但下一段按新时长')
})

test('restore：未到点则继续跑，剩余按 endsAt 重算（关多久都认）', () => {
  const started = reducePomodoro(base(), { type: 'start', now: T0 }).state
  const r = restorePomodoro(started, T0 + 600_000)
  assert.equal(r.state.status, 'running')
  assert.equal(r.state.remainingSeconds, 900)
  assert.deepEqual(r.effects, [])
})

test('restore：已过点则只结算这一段并停下（不自动连跑后面的段）', () => {
  const started = reducePomodoro(base(), { type: 'start', now: T0 }).state
  const r = restorePomodoro(started, T0 + 5 * 3600_000)
  assert.equal(r.state.status, 'idle')
  assert.equal(r.state.phase, 'work')
  assert.equal(r.state.cycles, 1, '只加一个，不会因为离开 5 小时就凭空多出 11 个番茄')
  const record = r.effects.find((e) => e.type === 'record')
  assert.ok(record)
  assert.equal(record.durationSeconds, 1500)
})
