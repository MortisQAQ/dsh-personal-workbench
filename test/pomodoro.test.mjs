/**
 * 番茄钟纯逻辑单测（`shared/pomodoro.ts`）。
 *
 * 覆盖的都是**会真的写错**的点：
 * 1. 时长夹取（越界按边界，不静默丢弃、不 NaN）；
 * 2. "今天是哪一天"用本地自然日，不是 UTC、也不是随 locale 变化的 toDateString；
 * 3. 跨零点的一段算在**开始那天**（否则同样的专注在不同时区/时段会掉进不同日子）；
 * 4. 最近 N 天**补 0 且顺序稳定**（否则柱状图会错位）；
 * 5. 时长文案（0 / 不足 1 分钟 / 分钟 / 小时）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  POMODORO_BREAK_MINUTES_DEFAULT,
  POMODORO_MAX_MINUTES,
  POMODORO_MIN_MINUTES,
  POMODORO_WORK_MINUTES_DEFAULT,
  clampPomodoroMinutes,
  formatFocusDuration,
  localDayKey,
  recentDayKeys,
  summarizeFocusByDay,
} from '../lib/shared/pomodoro.js'

test('缺省值就是番茄工作法的出厂值', () => {
  assert.equal(POMODORO_WORK_MINUTES_DEFAULT, 25)
  assert.equal(POMODORO_BREAK_MINUTES_DEFAULT, 5)
})

test('夹取：整数、四舍五入、越界按边界、脏值回缺省', () => {
  assert.equal(clampPomodoroMinutes(30, 25), 30)
  assert.equal(clampPomodoroMinutes('45', 25), 45, '字符串数字要能认（输入框给的是字符串）')
  assert.equal(clampPomodoroMinutes(30.6, 25), 31, '四舍五入到整分钟')
  assert.equal(clampPomodoroMinutes(0, 25), POMODORO_MIN_MINUTES, '0 分钟不是合法的一段专注')
  assert.equal(clampPomodoroMinutes(-10, 25), POMODORO_MIN_MINUTES)
  assert.equal(clampPomodoroMinutes(999, 25), POMODORO_MAX_MINUTES, '越界按上界落库，而不是丢弃')
  assert.equal(clampPomodoroMinutes('', 25), 25, '空串回缺省')
  assert.equal(clampPomodoroMinutes('  ', 25), 25)
  assert.equal(clampPomodoroMinutes('abc', 25), 25)
  assert.equal(clampPomodoroMinutes(null, 25), 25)
  assert.equal(clampPomodoroMinutes(undefined, 25), 25)
  assert.equal(clampPomodoroMinutes(Number.NaN, 25), 25)
  assert.equal(clampPomodoroMinutes(Number.POSITIVE_INFINITY, 25), 25)
})

test('夹取：缺省值本身非法时也要落到合法区间', () => {
  assert.equal(clampPomodoroMinutes(undefined, 0), POMODORO_MIN_MINUTES)
  assert.equal(clampPomodoroMinutes(undefined, 9999), POMODORO_MAX_MINUTES)
})

test('localDayKey 用本地自然日（不是 UTC 日期）', () => {
  /** 本地 00:30 在东八区属于"当天"，用 UTC 会掉到前一天。 */
  const earlyMorning = new Date(2026, 10, 17, 0, 30, 0)
  assert.equal(localDayKey(earlyMorning), '2026-11-17')
  const lateNight = new Date(2026, 10, 17, 23, 59, 59)
  assert.equal(localDayKey(lateNight), '2026-11-17')
  assert.equal(localDayKey(new Date(2026, 0, 1, 12, 0, 0)), '2026-01-01', '月/日要补零')
  assert.equal(localDayKey(new Date(Number.NaN)), '', '无效日期返回空串，调用方据此过滤')
})

test('recentDayKeys：正序、含今天、跨月正确', () => {
  const now = new Date(2026, 10, 2, 9, 0, 0) // 2026-11-02
  assert.deepEqual(recentDayKeys(now, 4), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'])
  assert.deepEqual(recentDayKeys(now, 1), ['2026-11-02'])
  assert.equal(recentDayKeys(now, 0).length, 1, '至少一天（否则调用方要处理空数组）')
})

test('summarize：同日相加、缺失日期补 0、顺序与入参一致', () => {
  const keys = ['2026-11-15', '2026-11-16', '2026-11-17']
  const sessions = [
    { start: new Date(2026, 10, 17, 9, 0, 0).toISOString(), duration: 1500 },
    { start: new Date(2026, 10, 17, 14, 0, 0).toISOString(), duration: 600 },
    { start: new Date(2026, 10, 15, 20, 0, 0).toISOString(), duration: 1200 },
    { start: new Date(2026, 10, 10, 20, 0, 0).toISOString(), duration: 9999 }, // 窗口外，不计
  ]
  assert.deepEqual(summarizeFocusByDay(sessions, keys), [
    { day: '2026-11-15', seconds: 1200, sessions: 1 },
    { day: '2026-11-16', seconds: 0, sessions: 0 },
    { day: '2026-11-17', seconds: 2100, sessions: 2 },
  ])
})

test('summarize：跨零点的记录算在开始那天', () => {
  /** 23:50 开始、跑 25 分钟 —— 记录里存的是开始时刻，所以整体算前一天。 */
  const start = new Date(2026, 10, 16, 23, 50, 0)
  const sessions = [{ start: start.toISOString(), duration: 1500 }]
  assert.deepEqual(
    summarizeFocusByDay(sessions, ['2026-11-16', '2026-11-17']),
    [{ day: '2026-11-16', seconds: 1500, sessions: 1 }, { day: '2026-11-17', seconds: 0, sessions: 0 }],
  )
})

test('summarize：脏记录不参与统计，也不抛错', () => {
  const keys = ['2026-11-17']
  const sessions = [
    { start: 'not-a-date', duration: 1500 },
    { start: new Date(2026, 10, 17, 9, 0, 0).toISOString(), duration: 0 },
    { start: new Date(2026, 10, 17, 10, 0, 0).toISOString(), duration: Number.NaN },
    { start: new Date(2026, 10, 17, 11, 0, 0).toISOString(), duration: 300 },
  ]
  assert.deepEqual(summarizeFocusByDay(sessions, keys), [{ day: '2026-11-17', seconds: 300, sessions: 1 }])
})

test('formatFocusDuration：0 / 不足 1 分钟 / 分钟 / 小时', () => {
  assert.equal(formatFocusDuration(0), '0 分钟')
  assert.equal(formatFocusDuration(-5), '0 分钟')
  assert.equal(formatFocusDuration(30), '不足 1 分钟')
  assert.equal(formatFocusDuration(59), '不足 1 分钟')
  assert.equal(formatFocusDuration(60), '1 分钟')
  assert.equal(formatFocusDuration(1500), '25 分钟')
  assert.equal(formatFocusDuration(3600), '1 小时')
  assert.equal(formatFocusDuration(3600 + 25 * 60), '1 小时 25 分钟')
})
