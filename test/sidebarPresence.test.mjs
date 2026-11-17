/**
 * 渲染权句柄（`sidebarPresence.ts`）的单测。
 *
 * 核心是 2026-11-17 修掉的那个真 bug：旧实现是一个**布尔**（`enter()`/`leave()`），
 * 而宿主允许两个横向面板、同一个 kind 可以在**不同 pane 各挂一个正文** ——
 *
 * ```text
 * A enter → mounted=true;  B enter → 幂等吞掉（没记录 B）
 * A leave → mounted=false   ← B 还挂着！中央于是又渲染一棵 App → 屏幕上两个 WorkbenchApp
 * ```
 *
 * 所以这里按实例记名，只有**全空**才交还。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createSurfacePresence, sidebarSurfacePresence } from '../lib/client/sidebarPresence.js'

test('单实例：挂上/摘掉，幂等且每次真实变化只通知一次', () => {
  const presence = createSurfacePresence()
  const id = presence.mintId()
  const seen = []
  const off = presence.subscribe(() => seen.push(presence.isMounted()))

  assert.equal(presence.isMounted(), false)
  presence.claim(id)
  presence.claim(id)
  assert.deepEqual(seen, [true], '重复 claim 不该再通知：否则每次挂载都触发一轮重渲染')
  assert.equal(presence.isMounted(), true)
  assert.equal(presence.count(), 1)

  presence.release(id)
  presence.release(id)
  assert.deepEqual(seen, [true, false], '重复 release 同理')
  assert.equal(presence.isMounted(), false)

  off()
  presence.claim(id)
  assert.deepEqual(seen, [true, false], '退订之后不该再收到通知')
})

test('双实例（两个 pane）：先卸的那个不能把渲染权提前交还', () => {
  const presence = createSurfacePresence()
  const a = presence.mintId()
  const b = presence.mintId()
  assert.notEqual(a, b, 'mintId 必须每次给一个新 id')

  presence.claim(a)
  presence.claim(b)
  assert.equal(presence.count(), 2)
  assert.equal(presence.isMounted(), true)

  presence.release(a)
  assert.equal(presence.isMounted(), true, 'B 还挂着：这时交还渲染权就会渲染出第二棵树')
  assert.equal(presence.count(), 1)

  presence.release(b)
  assert.equal(presence.isMounted(), false)
})

test('未知 id 的 release 不影响别人（含 reset 之后）', () => {
  const presence = createSurfacePresence()
  const a = presence.mintId()
  presence.claim(a)
  presence.release('surface-never-minted')
  assert.equal(presence.isMounted(), true)
  presence.reset()
  assert.equal(presence.isMounted(), false)
  presence.release(a)
  assert.equal(presence.isMounted(), false)
})

test('mintId 单调递增且不会被 reset 倒回去（reset 后旧 id 不会撞上新 id）', () => {
  const presence = createSurfacePresence()
  const first = presence.mintId()
  presence.claim(first)
  presence.reset()
  const second = presence.mintId()
  assert.notEqual(first, second, 'reset 不能把计数器倒回去：否则新实例会冒用旧实例的身份')
})

test('可见性：按实例记，且只影响 isVisible（不改变互斥用的 isMounted）', () => {
  const presence = createSurfacePresence()
  const a = presence.mintId()
  presence.claim(a)
  assert.equal(presence.isVisible(), false, 'claim 本身不猜可见性：宿主没说就是未知')

  presence.setVisible(a, true)
  assert.equal(presence.isVisible(), true)
  assert.equal(presence.isMounted(), true)

  presence.setVisible(a, false)
  assert.equal(presence.isVisible(), false)
  assert.equal(presence.isMounted(), true, '不可见但不是没挂载：互斥仍按挂载算')

  presence.setVisible(a, true)
  presence.release(a)
  assert.equal(presence.isVisible(), false, '实例卸载必须连带清掉它的可见标记')
})

test('两个实例的可见性互不覆盖', () => {
  const presence = createSurfacePresence()
  const a = presence.mintId()
  const b = presence.mintId()
  presence.claim(a)
  presence.claim(b)
  presence.setVisible(a, true)
  presence.setVisible(b, false)
  assert.equal(presence.isVisible(), true, 'A 可见就算可见')
  presence.setVisible(a, false)
  assert.equal(presence.isVisible(), false)
})

test('同值不通知（可见性侧）', () => {
  const presence = createSurfacePresence()
  const a = presence.mintId()
  presence.claim(a)
  let notifications = 0
  presence.subscribe(() => { notifications += 1 })
  presence.setVisible(a, true)
  presence.setVisible(a, true)
  presence.setVisible(a, false)
  presence.setVisible(a, false)
  assert.equal(notifications, 2, '同值写必须不通知，否则诊断链路会把主线程占满')
})

test('单个订阅者抛错不影响其它订阅者', () => {
  const presence = createSurfacePresence()
  let reached = 0
  presence.subscribe(() => { throw new Error('boom') })
  presence.subscribe(() => { reached += 1 })
  presence.claim(presence.mintId())
  assert.equal(reached, 1)
})

test('生产单例存在且初始未挂载（写入点只有侧栏正文）', () => {
  assert.equal(typeof sidebarSurfacePresence.claim, 'function')
  assert.equal(typeof sidebarSurfacePresence.release, 'function')
  assert.equal(sidebarSurfacePresence.isMounted(), false)
  assert.equal(sidebarSurfacePresence.isVisible(), false)
})
