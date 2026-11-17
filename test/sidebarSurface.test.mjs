/**
 * 右侧栏 tab 表面（feature #1）的**纯逻辑**单测。
 *
 * 钉住四件事：
 *
 * 1. 注册给宿主的**类型声明**是"页面型"形状（不写 patterns/priority/canOpen —— 写了就等于
 *    宣称自己认领 `dsh-resource://` 地址，会和文件预览抢活）；
 * 2. 页面地址与 `openTab(kind)` 的簿记一致（`sidebar://<kind>`）；
 * 3. **渲染权只有一处判定**（`decideSurfaceOwner`），且侧栏优先；
 * 4. 源码不变式：面板内容仍然注册在 `shell.overlay`，**不许**再注册进 `sidebar.panellist`
 *    （2026-11-17 有过一次错误改动：把整棵 App 注册到"条目行的列表槽位"里）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CENTER_DELEGATED_HINT,
  WORKBENCH_TAB_ID,
  WORKBENCH_TAB_KIND,
  createSurfacePresence,
  decideSurfaceOwner,
  sidebarSurfacePresence,
  workbenchTabAddress,
  workbenchTabDefinition,
} from '../lib/client/sidebarSurface.js'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')
const CLIENT_ENTRY = join(SRC, 'client', 'index.tsx')

/** 去掉注释再扫源码：注释里出现关键字不算接线问题。 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

test('类型声明是「页面型」：只报 kind，不认领资源地址', () => {
  const definition = workbenchTabDefinition('工作台', '说明')
  assert.equal(definition.id, WORKBENCH_TAB_ID)
  assert.equal(definition.kind, WORKBENCH_TAB_KIND)
  assert.equal(definition.kind, 'workbench')
  assert.equal(definition.id, '@dely0/dsh-personal-workbench', 'id 用包名：它在 tab 系统里全系统唯一')
  assert.equal(definition.patterns, undefined, '页面型不该有 patterns（有就会去认领 dsh-resource:// 地址）')
  assert.equal(definition.priority, undefined, '不声明档位 = 默认 extension 档，正好是产品外类型该在的那档')
  assert.equal(definition.canOpen, undefined, '页面型没有地址可认领')
})

test('tab 芯片文字跟随语言：title() 每次都读最新文案', () => {
  const chinese = workbenchTabDefinition('工作台', '说明')
  assert.equal(chinese.title(workbenchTabAddress()), '工作台')
  const english = workbenchTabDefinition('Workbench', 'Open tasks')
  assert.equal(english.title(workbenchTabAddress()), 'Workbench')
})

test('引导页入口框：至少一个，且 id 唯一、指向本 kind', () => {
  const definition = workbenchTabDefinition('工作台', '在右侧栏查看今日计划、任务与日历')
  assert.ok(definition.guide.length >= 1, '没有 guide 入口 = 用户在右侧栏里找不到它')
  const ids = definition.guide.map((entry) => entry.id)
  assert.equal(new Set(ids).size, ids.length, 'guide entry id 重复会让宿主注册直接抛错')
  for (const entry of definition.guide) {
    assert.equal(typeof entry.description, 'string')
    assert.ok(entry.description.length > 0)
    assert.equal(typeof entry.order, 'number')
  }
})

test('页面地址与宿主的簿记一致：sidebar://<kind>', () => {
  assert.equal(workbenchTabAddress(), `sidebar://${WORKBENCH_TAB_KIND}`)
  assert.equal(workbenchTabAddress(), 'sidebar://workbench')
})

test('渲染权判定表：侧栏优先，其次沿用中央面板判据', () => {
  const table = [
    [{ sidebarMounted: true, centerVisible: true }, 'sidebar'],
    [{ sidebarMounted: true, centerVisible: false }, 'sidebar'],
    [{ sidebarMounted: false, centerVisible: true }, 'center'],
    [{ sidebarMounted: false, centerVisible: false }, 'none'],
  ]
  for (const [input, expected] of table) {
    assert.equal(decideSurfaceOwner(input), expected, JSON.stringify(input))
  }
})

test('渲染权句柄：幂等 + 每次真实变化只通知一次', () => {
  const presence = createSurfacePresence()
  const seen = []
  const off = presence.subscribe(() => seen.push(presence.isMounted()))

  assert.equal(presence.isMounted(), false)
  presence.enter()
  presence.enter()
  assert.deepEqual(seen, [true], '重复 enter 不该再通知：否则每次挂载都触发一轮重渲染')
  assert.equal(presence.isMounted(), true)

  presence.leave()
  presence.leave()
  assert.deepEqual(seen, [true, false], '重复 leave 同理')
  assert.equal(presence.isMounted(), false)

  off()
  presence.enter()
  assert.deepEqual(seen, [true, false], '退订之后不该再收到通知')
})

test('渲染权句柄：单个订阅者抛错不影响其它订阅者', () => {
  const presence = createSurfacePresence()
  let reached = 0
  presence.subscribe(() => { throw new Error('boom') })
  presence.subscribe(() => { reached += 1 })
  presence.enter()
  assert.equal(reached, 1)
})

test('生产单例存在且初始未挂载（挂载写入点只有侧栏正文）', () => {
  assert.equal(typeof sidebarSurfacePresence.enter, 'function')
  assert.equal(sidebarSurfacePresence.isMounted(), false)
})

test('中央面板的提示文案不是空串（空白会让人以为面板坏了）', () => {
  assert.equal(typeof CENTER_DELEGATED_HINT, 'string')
  assert.ok(CENTER_DELEGATED_HINT.length > 0)
})

test('源码不变式：面板内容仍注册在 shell.overlay，不得注册进 sidebar.panellist', () => {
  const code = stripComments(readFileSync(CLIENT_ENTRY, 'utf8'))
  assert.match(code, /slots\.inject\(OFFICIAL_OVERLAY_SLOT/, '面板内容必须挂在 shell.overlay（始终存在的框架级浮层）')
  assert.doesNotMatch(code, /slots\.register\(\s*\{\s*name:\s*OFFICIAL_PANEL_LIST_SLOT,[^}]*\bWorkbenchPanelContent\b/,
    'sidebar.panellist 是**条目行的列表槽位**：把整棵 App 注册进去会把工作台塞进一行按钮里')
})

test('源码不变式：侧栏表面走作用域注入（可选增强），不进 inject 前置清单', () => {
  const code = stripComments(readFileSync(CLIENT_ENTRY, 'utf8'))
  assert.match(code, /inject\.call\(ctx,\s*\['sidebarRight',\s*'sidebarRightTabs'\]/,
    '两个右侧栏服务必须走 ctx.inject 作用域注入：写进 inject 会让没有右侧栏的宿主连中央面板一起丢掉')
  assert.match(code, /key:\s*WORKBENCH_TAB_ID/, '正文/标题槽位的 key 必须等于类型 id')
  assert.match(code, /sidebar\.right\.pane\.tab'/, '正文要注册到 sidebar.right.pane.tab')
})
