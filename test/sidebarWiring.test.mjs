/**
 * 源码级不变量 · **右侧栏表面**（2026-11-17，本轮修完的三个运行时缺陷的防回归线）。
 *
 * 每一条都对应一次"读代码看不出来、只有实测才犯"的错：
 *
 * | 不变量 | 为什么 |
 * |---|---|
 * | `useTabInfo` 只在一个文件里被调用、且**零实参** | 宿主签名是 `() => info`；传 selector 会被静默忽略，再读 `actions.close` 就恒 undefined（关闭动作永远失效） |
 * | 渲染权只有一个判定、且**按实例**登记 | 布尔 enter/leave 在"先卸的那个"身上提前交还 → 屏幕上两个 WorkbenchApp |
 * | 槽位名只有一个来源 | `sidebar.right.pane.tab` 拼错 = 注定挂不上，且错误是"静默空白" |
 * | 卸载时必须撤销侧栏注册 | 注册挂在**别人的** fiber 上，不撤就泄漏 + 重载时 id 冲突抛错 |
 *
 * "不存在某段代码"只能用扫源码证明 —— 所以这些是扫描断言，不是注释里的约定。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative, sep } from 'node:path'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))

function sourceFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    if (entry.includes('.bak-')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) { out.push(...sourceFiles(full)); continue }
    if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(full)
  }
  return out
}

const sources = sourceFiles(SRC).map((path) => ({ path, text: readFileSync(path, 'utf8') }))
const rel = (path) => relative(SRC, path).split(sep).join('/')
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const at = (name) => sources.find((source) => rel(source.path) === name)
const codeOf = (name) => {
  const found = at(name)
  assert.ok(found, `前置：${name} 必须存在`)
  return stripComments(found.text)
}

/**
 * 宿主钩子的**唯一合法用法**：在读取层里被调用；在别处只能作为**裸值**传给读取层
 * （形如 `readTabInfo(props.useTabInfo)`）。
 *
 * 为什么口径是"禁掉可疑后缀"而不是"只允许裸值"：回归不一定长得像
 * `useTabInfo(sel => sel.tab)`。第一版这条断言只匹配 `useTabInfo(`，
 * 于是"先转型再调用"的写法（`(props.useTabInfo as any)?.((info) => info)`）
 * **大摇大摆通过**了 —— 变异探针实测，所以补上了 ` as ` / `?.` / `.` / `[` 四种后缀。
 * （日志文案里出现 "useTabInfo" 是正常的，不该因此变红，所以不采用白名单口径。）
 */
test('useTabInfo 在读取层之外不许被调用/转型/取属性', () => {
  const reader = 'client/sidebarTabInfo.ts'
  const suspicious = /^\s*(\(|\?\.|as\s|\.|\[)/
  const offenders = []
  for (const { path, text } of sources) {
    if (rel(path) === reader) continue
    const code = stripComments(text)
    for (const match of code.matchAll(/\buseTabInfo\b/g)) {
      const from = (match.index ?? 0) + 'useTabInfo'.length
      const after = code.slice(from, from + 24)
      if (suspicious.test(after)) offenders.push(`${rel(path)}: …useTabInfo${after.split('\n')[0]}`)
    }
  }
  assert.deepEqual(offenders, [],
    '宿主签名是 () => info 且**无 selector**：任何"传参/转型后再调用"都会被静默忽略，随后读 actions.close 恒 undefined')
})

test('读取层唯一：readTabInfo 只在 sidebarTabInfo.ts 定义、只在 index.tsx 消费', () => {
  const definitions = sources
    .filter(({ text }) => /export function readTabInfo\s*\(/.test(stripComments(text)))
    .map(({ path }) => rel(path))
  assert.deepEqual(definitions, ['client/sidebarTabInfo.ts'], '读取层必须只有一份实现')

  const consumers = sources
    .filter(({ path, text }) => rel(path) !== 'client/sidebarTabInfo.ts' && /\breadTabInfo\s*\(/.test(stripComments(text)))
    .map(({ path }) => rel(path))
  assert.deepEqual(consumers, ['client/index.tsx'], `消费点只该是装配层，实测 ${consumers.join(', ')}`)
})

test('渲染权按实例登记：全仓不再出现布尔的 enter()/leave()', () => {
  for (const { path, text } of sources) {
    const code = stripComments(text)
    for (const needle of ['.enter()', '.leave()']) {
      assert.equal(code.includes(needle), false,
        `${rel(path)} 仍出现 ${needle} —— 布尔渲染权会在"先卸载的那个实例"身上提前交还，导致两棵树同时在跑`)
    }
  }
})

test('渲染权判定只有一处实现（别处再算一遍 = 下一个 bug）', () => {
  const definitions = sources
    .filter(({ text }) => /export function decideSurfaceOwner\s*\(/.test(stripComments(text)))
    .map(({ path }) => rel(path))
  assert.deepEqual(definitions, ['client/sidebarSurface.ts'])
  // 不许在别处内联同一判定（典型写法是 sidebarMounted ? 'sidebar' : ...）
  for (const { path, text } of sources) {
    const code = stripComments(text)
    if (rel(path) === 'client/sidebarSurface.ts') continue
    assert.doesNotMatch(code, /sidebarMounted\s*\?\s*['"]sidebar['"]/,
      `${rel(path)} 又把"谁是承载面"内联算了一遍：必须调 decideSurfaceOwner()`)
  }
})

test('槽位名只有一个来源（sidebarSurface.ts），其余文件必须引用它', () => {
  const owner = 'client/sidebarSurface.ts'
  for (const { path, text } of sources) {
    const code = stripComments(text)
    if (rel(path) === owner) continue
    assert.equal(code.includes("'sidebar.right.pane.tab'"), false,
      `${rel(path)} 直接写了槽位字符串：拼错就是"静默空白"，必须引用 SIDEBAR_TAB_BODY_SLOT`)
    assert.equal(code.includes("'sidebar.right.pane.tab.title'"), false,
      `${rel(path)} 直接写了标题槽位字符串：必须引用 SIDEBAR_TAB_TITLE_SLOT`)
  }
})

test('侧栏表面走作用域注入（可选增强），不进 inject 前置清单', () => {
  const code = codeOf('client/index.tsx')
  assert.match(code, /inject\.call\(ctx,\s*\['sidebarRight',\s*'sidebarRightTabs'\]/,
    '两个右侧栏服务必须走 ctx.inject 作用域注入：写进 inject 会让没有右侧栏的宿主连中央面板一起丢掉')
})

test('卸载路径必须撤销侧栏注册（否则泄漏 + 重载时 id 冲突）', () => {
  const code = codeOf('client/index.tsx')
  assert.match(code, /function disposeSidebarSurface\s*\(/, '必须有显式的撤销入口')
  assert.match(code, /const cleanup = \(\): void => \{[\s\S]{0,1200}?disposeSidebarSurface\(\)/,
    'apply() 返回的 cleanup（= 宿主卸载插件时唯一会调的东西）必须撤销侧栏注册')
  // 撤销要同时管住"注入等待"（fiber）与"已注册项"（事务）
  const dispose = /function disposeSidebarSurface\s*\(\)[\s\S]*?\n}/.exec(code)?.[0] ?? ''
  assert.match(dispose, /sidebarSurfaceRegistration/, '要撤销注册事务')
  assert.match(dispose, /sidebarSurfaceFiber/, '要撤销 ctx.inject 的 pending fiber')
})

test('正文仍然挂在官方的 sidebar.right.pane.tab 上（不许改挂别的槽位）', () => {
  const code = codeOf('client/sidebarRegistration.ts')
  assert.match(code, /SIDEBAR_TAB_BODY_SLOT/, '正文槽位必须引用常量')
  assert.match(code, /key:\s*WORKBENCH_TAB_ID/, '正文/标题槽位的 key 必须等于类型 id（宿主按它取生效中的那份）')
})
