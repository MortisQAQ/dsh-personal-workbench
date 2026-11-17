/**
 * 右侧栏注册事务（`sidebarRegistration.ts`）的单测。
 *
 * 钉住三条**上一版真出过**的缺陷：
 *
 * 1. **注入回调取消**：`slots.inject` 的 effect 挂在 renderer 的 fiber、tab 类型注册挂在
 *    sidebar-right 的 fiber —— 都不是我们的。不主动 dispose 就永不撤销（卸载后留空壳 tab，
 *    再加载时 `id` 还被占着 → 宿主 `register()` 抛 `already registered`）。
 * 2. **注册失败回滚**：类型注册成功、正文注册抛错时，旧实现直接 return →
 *    用户多出一个**点开是空白**的侧栏 tab。
 * 3. **迟到的失败**：槽位尚未声明时 `slots.inject` 不立即回调，之后的抛错发生在 effect 里，
 *    会被宿主 `queueMicrotask` 甩成未处理拒绝 —— 外层 try/catch **接不到**。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { registerSidebarSurface } from '../lib/client/sidebarRegistration.js'

const ID = '@dely0/dsh-personal-workbench'
const BODY_SLOT = 'sidebar.right.pane.tab'
const TITLE_SLOT = 'sidebar.right.pane.tab.title'

/** 幂等 disposer（宿主的 `slots.register` 也是幂等的，见 ui-renderer 的 `_register`）。 */
function once(fn) {
  let done = false
  return () => { if (done) return; done = true; fn() }
}

/**
 * 假宿主：行为按安装版 `slots.inject` / `slots.register` / `sidebarRightTabs.register` 的语义来。
 *
 * @param input.fail - 哪些槽位/阶段注册时抛错（键用槽位名，`tabs` 表示类型注册）。
 * @param input.defer - 是否模拟"槽位稍后才声明"（`slots.inject` 不立即回调）。
 * @param input.lateAfterCancel - 取消后**仍然**执行迟到的回调（用来测生产代码自己的二次防护；
 *   宿主真实实现是会阻止的，但"宿主也挡不住"的情况我们不该崩）。
 */
function fakeHost({ fail = {}, defer = false, lateAfterCancel = false } = {}) {
  const state = {
    tabsDisposed: 0, bodyDisposed: 0, titleDisposed: 0, injectCancelled: 0, tabsRegistered: 0,
    /** 当前**还活着的**注册数（注册 +1 / 撤销 -1）。"没有残留"只能这样证明。 */
    live: 0,
  }
  const pending = []
  const calls = []

  const runCallback = (name, callback, cancelled) => {
    if (cancelled.value && !lateAfterCancel) return undefined
    return callback()
  }

  const slots = {
    inject(name, callback) {
      const cancelled = { value: false }
      let result
      const run = () => { result = runCallback(name, callback, cancelled) }
      const cancel = once(() => {
        cancelled.value = true
        state.injectCancelled += 1
        if (typeof result === 'function') result()
      })
      if (defer) { pending.push(run); return cancel }
      run()
      return cancel
    },
    register(options) {
      calls.push(['register', options.name, options.key])
      if (fail[options.name] === true) throw new Error(`boom:${options.name}`)
      state.live += 1
      if (options.name === TITLE_SLOT) return once(() => { state.titleDisposed += 1; state.live -= 1 })
      return once(() => { state.bodyDisposed += 1; state.live -= 1 })
    },
  }
  const scope = {
    sidebarRightTabs: {
      register(definition) {
        calls.push(['tabs', definition.kind, definition.id])
        if (fail.tabs === true) throw new Error('sidebarRight: tab type id "... " is already registered')
        state.tabsRegistered += 1
        state.live += 1
        return once(() => { state.tabsDisposed += 1; state.live -= 1 })
      },
    },
    slots,
  }
  return { scope, state, calls, pending, flush: () => { for (const run of pending.splice(0)) run() } }
}

const TEXT = { title: () => '工作台', guideDescription: () => '说明' }

test('成功路径：类型 → 正文，槽位 key 必须等于类型 id', () => {
  const { scope, state, calls } = fakeHost()
  const registration = registerSidebarSurface(scope, { warn: () => {}, text: TEXT, body: 'BODY' })
  assert.equal(state.tabsRegistered, 1)
  assert.deepEqual(registration.stages(), ['tabs', 'body'])
  const registerCall = calls.find((call) => call[0] === 'register')
  assert.deepEqual(registerCall, ['register', BODY_SLOT, ID], 'key 不等于 id 的话宿主按 id 取不到这份注册')
  assert.equal(registration.rolledBack(), false)
})

test('取消：dispose() 把类型与正文都撤掉，且可重放（幂等）', () => {
  const { scope, state } = fakeHost()
  const registration = registerSidebarSurface(scope, { warn: () => {}, text: TEXT, body: 'BODY' })
  registration.dispose()
  assert.equal(state.tabsDisposed, 1)
  assert.equal(state.bodyDisposed, 1)
  assert.equal(state.injectCancelled, 1)
  assert.equal(state.live, 0, 'dispose 之后不许留下活着的注册')
  assert.deepEqual(registration.stages(), [])
  // 重放：不能再撤一次（幂等）；宿主的 disposer 本身也幂等，所以计数不该再涨
  registration.dispose()
  assert.equal(state.tabsDisposed, 1)
  assert.equal(state.bodyDisposed, 1)
})

test('取消时槽位还没声明：注入等待也被取消，之后不再注册任何东西', () => {
  const { scope, state, flush } = fakeHost({ defer: true })
  const registration = registerSidebarSurface(scope, { warn: () => {}, text: TEXT, body: 'BODY' })
  assert.equal(state.bodyDisposed, 0, '前置：回调还没跑')

  registration.dispose()
  assert.equal(state.injectCancelled, 1, 'pending 的 inject 必须被取消（否则宿主一声明槽位就会注册进去）')
  flush()
  assert.equal(state.live, 0, '取消之后不该再产生活着的注册')
})

test('取消后回调仍然迟到执行（宿主也挡不住的最坏情况）：不得留下任何活着的注册', () => {
  const { scope, state, flush } = fakeHost({ defer: true, lateAfterCancel: true })
  const registration = registerSidebarSurface(scope, { warn: () => {}, text: TEXT, body: 'BODY' })
  assert.equal(state.live, 1, '前置：类型已注册（活的）')
  registration.dispose()
  flush()
  assert.equal(state.live, 0, '取消之后（哪怕回调迟到）都不许留下活着的注册：那正是上一版的泄漏形态')
  assert.deepEqual(registration.stages(), [], '已取消的事务不该报告任何生效阶段')
})

test('正文注册失败 → 回滚类型（不留点开空白的 tab），日志说清哪一步 + 已回滚', () => {
  const { scope, state } = fakeHost({ fail: { [BODY_SLOT]: true } })
  const warnings = []
  const registration = registerSidebarSurface(scope, {
    warn: (message) => warnings.push(message), text: TEXT, body: 'BODY',
  })
  assert.equal(state.tabsRegistered, 1, '类型先注册成功了')
  assert.equal(state.tabsDisposed, 1, '正文失败必须把类型撤掉')
  assert.equal(registration.rolledBack(), true)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /slot|槽位/, '日志要说清失败在哪一步')
  assert.match(warnings[0], /撤回|回滚/, '日志要说清已回滚，便于归因')
  assert.deepEqual(registration.stages(), [])
})

test('标题注册失败 → 不回滚（可选增强），只告警', () => {
  const { scope, state } = fakeHost({ fail: { [TITLE_SLOT]: true } })
  const warnings = []
  const registration = registerSidebarSurface(scope, {
    warn: (message) => warnings.push(message), text: TEXT, body: 'BODY', titleComponent: 'TITLE',
  })
  assert.equal(registration.rolledBack(), false)
  assert.deepEqual(registration.stages(), ['tabs', 'body'], '标题失败不该动已生效的部分')
  assert.equal(state.tabsDisposed, 0)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /标题/, '要说清是可选项')
})

test('类型注册抛错 → 一个槽位都不抢，并且给出含 id/kind 的可读日志', () => {
  const { scope, state, calls } = fakeHost({ fail: { tabs: true } })
  const warnings = []
  const registration = registerSidebarSurface(scope, {
    warn: (message) => warnings.push(message), text: TEXT, body: 'BODY',
  })
  assert.equal(calls.filter((call) => call[0] === 'register').length, 0, '类型没成功就不该注册正文（否则是空壳）')
  assert.equal(state.injectCancelled, 0)
  assert.equal(registration.rolledBack(), false, '"根本没开始"与"回滚过"要能区分')
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], new RegExp(ID))
  assert.match(warnings[0], /workbench/)
})

test('可选增强分级：缺 sidebarRightTabs / 缺 slots → 只告警、不抛、说清中央面板不受影响', () => {
  const scopes = [undefined, {}, { sidebarRightTabs: {} }, { sidebarRightTabs: { register() {} } }]
  for (const scope of scopes) {
    const warnings = []
    const registration = registerSidebarSurface(scope, {
      warn: (message) => warnings.push(message), text: TEXT, body: 'BODY',
    })
    assert.equal(warnings.length, 1, JSON.stringify(scope))
    assert.match(warnings[0], /中央面板照常可用/, '必须说清"只少一个表面"')
    assert.doesNotThrow(() => registration.dispose())
    assert.deepEqual(registration.stages(), [])
  }
})

test('成功时有一条 info 日志（可观测：知道表面到底注册上了没有）', () => {
  const { scope } = fakeHost()
  const infos = []
  registerSidebarSurface(scope, { warn: () => {}, info: (m) => infos.push(m), text: TEXT, body: 'BODY' })
  assert.equal(infos.length, 1)
  assert.match(infos[0], /kind=workbench/)
})

test('文案走取值函数：调用点在注册之后改语言不会抛、也不会读旧值', () => {
  const { scope } = fakeHost()
  let language = 'zh'
  const registration = registerSidebarSurface(scope, {
    warn: () => {},
    text: { title: () => (language === 'zh' ? '工作台' : 'Workbench') },
    body: 'BODY',
  })
  assert.deepEqual(registration.stages(), ['tabs', 'body'])
  language = 'en'
  assert.doesNotThrow(() => registration.stages())
})
