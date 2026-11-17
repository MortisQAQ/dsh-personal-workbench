/**
 * `useTabInfo()` 读取层的单测。
 *
 * 为什么值得单独锁：这里错的是**签名**，而签名错**没有任何类型检查会拦**
 * （宿主类型在我们这边是 structural 镜像，不是 import）。实证 2026-11-17：
 * 宿主 `tabInfoFactory` 返回的是 `function useTabInfo() { return { sidebar, panel, tab } }`
 * —— **没有 selector 参数**。旧实现按 `useTabInfo(sel => sel.tab)` 调用时入参被静默忽略，
 * 拿回根对象，再按 `tabInfo.actions.close` 读 → 恒 undefined → 关闭动作永远失效。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  readTabInfo,
  tabCloseActionOf,
  tabVisibleOf,
} from '../lib/client/sidebarTabInfo.js'

/** 伪造宿主真实返回值（形状照抄 host `tabInfoFactory`）。 */
function hostInfo(overrides = {}) {
  const close = overrides.close ?? (() => {})
  return {
    sidebar: { expanded: true, fullscreen: false },
    panel: { id: 'pane-1', isFloating: false },
    tab: {
      id: 'tab-1',
      kind: 'workbench',
      title: '工作台',
      contentId: 'sidebar://workbench',
      visible: overrides.visible ?? true,
      navigation: { address: 'sidebar://workbench', params: undefined, revision: 1 },
      signal: new AbortController().signal,
      actions: { bindCommands: () => () => {}, openResource: () => {}, openTab: () => {}, close },
      refreshShortcut: undefined,
    },
  }
}

test('调宿主 hook 时**不传任何实参**（传了也会被忽略，然后读错层级）', () => {
  const seen = []
  const useTabInfo = (...args) => {
    seen.push(args)
    return hostInfo()
  }
  const read = readTabInfo(useTabInfo)
  assert.deepEqual(seen, [[]], `必须零参调用，实测 ${JSON.stringify(seen)}`)
  assert.equal(read.ok, true)
})

test('读得到 tab 记录与它的关闭动作（根对象 → tab.actions.close）', () => {
  let closed = 0
  const read = readTabInfo(() => hostInfo({ close: () => { closed += 1 } }))
  assert.equal(read.ok, true)
  assert.equal(read.info.tab.id, 'tab-1')
  assert.equal(read.info.tab.title, '工作台')
  const close = tabCloseActionOf(read)
  assert.equal(typeof close, 'function')
  close()
  assert.equal(closed, 1, '关闭动作必须真的能调到')
})

test('兼容"直接给 tab 记录"的形状（旧 selector 写法/宿主换回 selector 式）', () => {
  const read = readTabInfo(() => hostInfo().tab)
  assert.equal(read.ok, true)
  assert.equal(read.info.tab.id, 'tab-1')
  assert.equal(typeof tabCloseActionOf(read), 'function')
})

test('宿主没注入 hook → ok:false/reason=missing-hook（不抛、不假装成功）', () => {
  for (const value of [undefined, null, 'nope', 42]) {
    const read = readTabInfo(value)
    assert.equal(read.ok, false, JSON.stringify(value))
    assert.equal(read.reason, 'missing-hook')
    assert.equal(tabCloseActionOf(read), undefined)
    assert.equal(tabVisibleOf(read), undefined)
  }
})

test('宿主 hook 自己抛 → ok:false/reason=threw，并带上原文', () => {
  const read = readTabInfo(() => { throw new Error('sidebarRight: tab "tab-1" is not committed in session "s1"') })
  assert.equal(read.ok, false)
  assert.equal(read.reason, 'threw')
  assert.match(read.message, /not committed/)
  assert.equal(tabCloseActionOf(read), undefined)
})

test('返回值不是对象 → 归一成空形状（下游安全，不炸）', () => {
  for (const value of [undefined, null, 'x', 7]) {
    const read = readTabInfo(() => value)
    assert.equal(read.ok, true, String(value))
    assert.equal(read.info.tab, undefined)
    assert.equal(tabCloseActionOf(read), undefined)
  }
})

test('visible：未知与 false 是两件事（不许把"没给"当成"不可见"）', () => {
  assert.equal(tabVisibleOf(readTabInfo(() => hostInfo({ visible: true }))), true)
  assert.equal(tabVisibleOf(readTabInfo(() => hostInfo({ visible: false }))), false)
  // 宿主没给 visible 字段 → undefined（"未知"），不是 false
  const withoutVisible = hostInfo()
  delete withoutVisible.tab.visible
  assert.equal(tabVisibleOf(readTabInfo(() => withoutVisible)), undefined)
})

test('关闭动作不是函数时不给（不返回一个会把 close 调崩的壳）', () => {
  const info = hostInfo()
  info.tab.actions.close = 'not-a-function'
  const read = readTabInfo(() => info)
  assert.equal(read.ok, true)
  assert.equal(tabCloseActionOf(read), undefined)
})

test('归一化只保留已知字段：调用方拿不到宿主原始引用', () => {
  const info = hostInfo()
  const read = readTabInfo(() => info)
  assert.notEqual(read.info.tab, info.tab, '必须归一成新对象')
  assert.equal(read.info.tab.navigation, undefined, 'navigation 没消费者，不该被透传出来')
  assert.equal(read.info.tab.signal, undefined)
  assert.equal(read.info.sidebar, undefined, '我们没用 sidebar/panel，就不镜像它们')
})
