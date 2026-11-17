/**
 * 右侧栏 tab 表面（feature #1）的**契约**与**归属判定**单测。
 *
 * 钉住四件事（都对应一次真实缺陷）：
 *
 * 1. 注册给宿主的**类型声明**是"页面型"形状（不写 patterns/priority/canOpen —— 写了就等于
 *    宣称自己认领 `dsh-resource://` 地址，会和文件预览抢活）；
 * 2. **引导页入口框的形状**是宿主 `EntryBox` 真正读取的那一种：`title()` 与 `description()`
 *    都是**函数**（2026-11-17 取证：旧实现传字符串且没有 `title` → 引导页渲染即 TypeError）；
 * 3. 页面地址与 `openTab(kind)` 的簿记一致（`sidebar://<kind>`）；
 * 4. **渲染权只有一处判定**（`decideSurfaceOwner`），且侧栏优先。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  CENTER_DELEGATED_HINT,
  SIDEBAR_TAB_BODY_SLOT,
  SIDEBAR_TAB_TITLE_SLOT,
  WORKBENCH_TAB_ID,
  WORKBENCH_TAB_KIND,
  decideSurfaceOwner,
  describeSurface,
  workbenchTabAddress,
  workbenchTabDefinition,
} from '../lib/client/sidebarSurface.js'

/** 构造一个"会跟随语言"的 tester：每次调用都返回当前语言下的文案。 */
function texts(language) {
  return {
    title: () => (language.value === 'zh' ? '工作台' : 'Workbench'),
    guideDescription: () => (language.value === 'zh' ? '在右侧栏查看今日计划、任务与日历' : 'Tasks and calendar in the right sidebar'),
  }
}

test('类型声明是「页面型」：只报 kind，不认领资源地址', () => {
  const definition = workbenchTabDefinition(texts({ value: 'zh' }))
  assert.equal(definition.id, WORKBENCH_TAB_ID)
  assert.equal(definition.kind, WORKBENCH_TAB_KIND)
  assert.equal(definition.kind, 'workbench')
  assert.equal(definition.id, '@dely0/dsh-personal-workbench', 'id 用包名：它在 tab 系统里全系统唯一')
  assert.equal(definition.patterns, undefined, '页面型不该有 patterns（有就会去认领 dsh-resource:// 地址）')
  assert.equal(definition.priority, undefined, '不声明档位 = 默认 extension 档，正好是产品外类型该在的那档')
  assert.equal(definition.canOpen, undefined, '页面型没有地址可认领')
  assert.equal(definition.keepMounted, undefined, '不能声明 keepMounted：会让"挂着"不再等于"看得见"，互斥判据失真')
})

test('tab 芯片文字跟随语言：title() 每次都读最新文案', () => {
  const language = { value: 'zh' }
  const definition = workbenchTabDefinition(texts(language))
  assert.equal(definition.title(workbenchTabAddress()), '工作台')
  language.value = 'en'
  assert.equal(definition.title(workbenchTabAddress()), 'Workbench')
})

test('引导页入口框：title/description 必须是函数（宿主直接 entry.title() 调用）', () => {
  const language = { value: 'zh' }
  const definition = workbenchTabDefinition(texts(language))
  assert.ok(definition.guide.length >= 1, '没有 guide 入口 = 用户在右侧栏里找不到它')
  const ids = definition.guide.map((entry) => entry.id)
  assert.equal(new Set(ids).size, ids.length, 'guide entry id 重复会让宿主 register() 直接抛错')
  for (const entry of definition.guide) {
    assert.equal(typeof entry.id, 'string')
    assert.ok(entry.id.length > 0, 'id 不能是空串（宿主按它做 key 与 DOM 标记）')
    assert.equal(typeof entry.title, 'function', '宿主渲染时直接 entry.title()：传字符串会 TypeError')
    assert.equal(typeof entry.title(), 'string')
    assert.ok(entry.title().length > 0, '引导卡没有标题 = 用户看到一张空卡片')
    assert.equal(typeof entry.description, 'function', '宿主渲染时直接 entry.description?.()：传字符串会 TypeError')
    assert.equal(typeof entry.description(), 'string')
    assert.equal(typeof entry.order, 'number', 'order 必须是数字：undefined 会让宿主排序得到 NaN')
    assert.ok(Number.isFinite(entry.order))
  }
})

test('引导卡文案在渲染时取值：切语言后同一份声明也跟上', () => {
  const language = { value: 'zh' }
  const entry = workbenchTabDefinition(texts(language)).guide[0]
  assert.equal(entry.title(), '工作台')
  assert.equal(entry.description(), '在右侧栏查看今日计划、任务与日历')
  language.value = 'en'
  assert.equal(entry.title(), 'Workbench')
  assert.equal(entry.description(), 'Tasks and calendar in the right sidebar')
})

test('引导卡可以不声明 description（宿主只在 ≤4 个入口时才画它）', () => {
  const entry = workbenchTabDefinition({ title: () => '工作台' }).guide[0]
  assert.equal(entry.title(), '工作台')
  assert.equal(entry.description, undefined, '没有说明就不该给一个返回空串的函数：宿主会画出空行')
  assert.equal(entry.order, 0)
})

test('引导卡 id 可自定义，且缺省用 kind（保证同 provider 内唯一）', () => {
  assert.equal(workbenchTabDefinition({ title: () => 'x' }).guide[0].id, WORKBENCH_TAB_KIND)
  assert.equal(workbenchTabDefinition({ title: () => 'x', guideId: 'today' }).guide[0].id, 'today')
})

test('页面地址与宿主的簿记一致：sidebar://<kind>', () => {
  assert.equal(workbenchTabAddress(), `sidebar://${WORKBENCH_TAB_KIND}`)
  assert.equal(workbenchTabAddress(), 'sidebar://workbench')
})

test('槽位名是宿主 contract 的拼写（拼错=注定挂不上）', () => {
  assert.equal(SIDEBAR_TAB_BODY_SLOT, 'sidebar.right.pane.tab')
  assert.equal(SIDEBAR_TAB_TITLE_SLOT, 'sidebar.right.pane.tab.title')
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

test('归属说明可读，且与判定同源（不另算一遍）', () => {
  const cases = [
    [{ sidebarMounted: true, sidebarVisible: true, centerVisible: true }, 'sidebar'],
    [{ sidebarMounted: true, sidebarVisible: false, centerVisible: true }, 'sidebar'],
    [{ sidebarMounted: false, sidebarVisible: false, centerVisible: true }, 'center'],
    [{ sidebarMounted: false, sidebarVisible: false, centerVisible: false }, 'none'],
  ]
  for (const [input, expected] of cases) {
    const described = describeSurface(input)
    assert.equal(described.owner, expected, JSON.stringify(input))
    assert.equal(described.owner, decideSurfaceOwner(input), '说明必须复用同一判定')
    assert.equal(typeof described.because, 'string')
    assert.ok(described.because.length > 0, '空白说明等于没有诊断')
  }
  // "挂着但不可见"必须说清是哪种情形：归侧栏，且不冒充"在显示"
  const hidden = describeSurface({ sidebarMounted: true, sidebarVisible: false, centerVisible: true })
  assert.match(hidden.because, /visible=false/)
})

test('中央面板的提示文案不是空串（空白会让人以为面板坏了）', () => {
  assert.equal(typeof CENTER_DELEGATED_HINT, 'string')
  assert.ok(CENTER_DELEGATED_HINT.length > 0)
})
