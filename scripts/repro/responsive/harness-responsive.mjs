/**
 * 工作台响应式回归（**组件层**）：真组件 + 真生产 CSS + 真 Chromium 量布局。
 *
 * ============================ 一句话 ============================
 *
 * 为"1000px 以上优先"的两栏重构准备一条**会真的失败**的浏览器回归：
 * 在 1440 / 1200 / 1000 / 760 / 480 / 360 六档容器宽度下，量两栏布局、横向溢出、
 * 控件是否被压坏、详情列是否可达、Tab 焦点是否看得见，并留下截图与 JSON。
 *
 * ============================ 怎么跑 ============================
 *
 *   node scripts/repro/responsive/harness-responsive.mjs                 # 六档宽度
 *   node scripts/repro/responsive/harness-responsive.mjs --boundary      # 现有断点 ±1px 的 16 档
 *   node scripts/repro/responsive/harness-responsive.mjs --strict        # <1000px 的发现也阻断
 *   node scripts/repro/responsive/harness-responsive.mjs --selftest-only # 只跑"种缺陷"自检
 *   node scripts/repro/responsive/harness-responsive.mjs --stage live    # 追加只读的宿主实际挂载验证
 *
 * 退出码：0 无阻断级失败 / 1 有阻断级失败或脚本异常 / 2 前置缺失（没有浏览器、lib 缺失或在构建中、live 缺 token 或选择器）
 *
 * ⚠️ `--strict` 只是把 <1000px 的 watch 提成 blocking；**watch 从来不等于跳过**：
 * 它照样测量、照样截图、照样进 JSON 与终端汇总。
 *
 * ============================ 证据 ============================
 *
 * 默认写到 `test-results/responsive/<runId>/`（gitignored）：
 * `workbench.css`（本次真实样式表）、`pages/*.html`（每个场景的完整页面）、
 * `screenshots/*.png`（场景 × 宽度）、`report.json`（判据 + 观察量 + 环境）。
 * **不含任何 secret**：live 层的 token 只从环境变量进内存，绝不落盘。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { judge, summarize } from './lib/checks.mjs'
import { BOUNDARY_WIDTHS, REQUIRED_WIDTHS, WIDE_VIEWPORT, parseWidths, severityForWidth } from './lib/widths.mjs'
import { pageSnapshot, keyboardPrep, keyboardRead, blurActive } from './lib/probe.mjs'
import { runSourceGuards } from './lib/sourceGuards.mjs'

const SELF_PATH = fileURLToPath(import.meta.url)
/** 仓库根：scripts/repro/responsive/harness-responsive.mjs → ../../../ */
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

const REQUIRED_LIB_FILES = [
  'lib/client/styles.js',
  'lib/client/components/TaskList.js',
  'lib/client/components/DayPanel.js',
  'lib/client/components/KnowledgeList.js',
  'lib/client/components/IdeaCardGrid.js',
  'lib/client/listPresentation.js',
]

function parseArgs(argv) {
  const options = {
    stage: 'component',
    widths: null,
    boundary: false,
    strict: false,
    selftestOnly: false,
    evidenceDir: null,
    headless: true,
    browserPath: null,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--stage') options.stage = argv[++index]
    else if (arg === '--widths') options.widths = parseWidths(argv[++index])
    else if (arg === '--boundary') options.boundary = true
    else if (arg === '--strict') options.strict = true
    else if (arg === '--selftest-only') options.selftestOnly = true
    else if (arg === '--evidence-dir') options.evidenceDir = argv[++index]
    else if (arg === '--headed') options.headless = false
    else if (arg === '--browser') options.browserPath = argv[++index]
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error('未知参数：' + arg + '（可用：--stage --widths --boundary --strict --selftest-only --evidence-dir --headed --browser）')
  }
  if (['component', 'live', 'all'].includes(options.stage) === false) {
    throw new Error('--stage 只支持 component / live / all，收到：' + String(options.stage))
  }
  if (options.boundary && options.widths !== null) {
    throw new Error('--widths 与 --boundary 二选一：要么显式给宽度，要么用断点扫描')
  }
  return options
}

function usage() {
  console.log('用法：node scripts/repro/responsive/harness-responsive.mjs [选项]')
  console.log('  --stage component|live|all   默认 component（组件层）；live 追加宿主只读验证')
  console.log('  --widths 1440,1200,1000     显式宽度矩阵（默认 1440,1200,1000,760,480,360）')
  console.log('  --boundary                  改用现有断点 ±1px 的 16 档')
  console.log('  --strict                    <1000px 的发现也阻断（默认只警告）')
  console.log('  --selftest-only             只跑自检（种缺陷，验证判据不空转）')
  console.log('  --evidence-dir <目录>        证据目录（默认 test-results/responsive/<runId>）')
  console.log('  --headed                    有头浏览器（看它到底怎么摆）')
  console.log('  --browser <exe>             显式指定浏览器（默认自动发现 Edge/Chrome）')
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function timestampRunId() {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '-' + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds())
}

function readJsonOrNull(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
}

function gitInfo() {
  try {
    const head = readFileSync(join(REPO_ROOT, '.git', 'HEAD'), 'utf8').trim()
    if (head.startsWith('ref: ')) {
      const ref = head.slice(5).trim()
      return { ref, commit: readFileSync(join(REPO_ROOT, '.git', ref), 'utf8').trim().slice(0, 12) }
    }
    return { ref: 'detached', commit: head.slice(0, 12) }
  } catch {
    return { ref: 'unknown', commit: 'unknown' }
  }
}

function buildInfo() {
  const info = readJsonOrNull(join(REPO_ROOT, 'lib', 'build-info.json'))
  if (info === null) return { buildId: 'unknown', version: 'unknown', generatedAt: 'unknown' }
  return { buildId: info.buildId ?? 'unknown', version: info.version ?? 'unknown', generatedAt: info.generatedAt ?? 'unknown' }
}

/** 把页面内函数安全地送进浏览器：自包含函数 + 参数，全走 toString。 */
async function callInPage(browser, fn, args) {
  const expression = '(' + fn.toString() + ')(' + (args === undefined ? '' : JSON.stringify(args)) + ')'
  return await browser.evaluate('return ' + expression + ';')
}

/**
 * 等样式表与布局稳下来（不靠固定 sleep 猜）。
 *
 * ⚠️ 页面里求值的包装是非 async 的箭头函数（见 scripts/verify/cdp.mjs），
 * 所以这里**不能写 await**，只能返回 Promise 让 CDP 的 `awaitPromise` 去解。
 */
async function settleLayout(browser) {
  await browser.evaluate([
    'const raf = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));',
    'const fonts = (document.fonts !== undefined && document.fonts.status !== "loaded") ? document.fonts.ready.catch(() => undefined) : Promise.resolve();',
    'return Promise.resolve(fonts).then(raf).then(raf).then(() => true);',
  ].join('\n'))
}

async function applyWidth(browser, shell, width) {
  if (shell === 'panel') {
    await browser.cdp.send('Emulation.setDeviceMetricsOverride', { width, height: WIDE_VIEWPORT.height, deviceScaleFactor: 1, mobile: false })
    return
  }
  await browser.cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDE_VIEWPORT.width, height: WIDE_VIEWPORT.height, deviceScaleFactor: 1, mobile: false })
  await browser.evaluate(
    'const surface = document.querySelector("[data-probe=container]");'
    + 'if (surface === null) return false;'
    + 'surface.style.width = "' + width + 'px";'
    + 'surface.style.height = "' + WIDE_VIEWPORT.height + 'px";'
    + 'return true;',
  )
}

/** Tab 走查：真实键盘事件（不是 JS focus），逐个读焦点元素。 */
async function walkKeyboard(browser, probe, steps) {
  await browser.cdp.send('Page.bringToFront').catch(() => undefined)
  await browser.cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => undefined)
  await callInPage(browser, blurActive)
  const prep = await callInPage(browser, keyboardPrep, probe)
  const walk = []
  for (let step = 0; step < steps; step += 1) {
    for (const type of ['rawKeyDown', 'keyUp']) {
      await browser.cdp.send('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 })
    }
    await sleep(40)
    walk.push(await callInPage(browser, keyboardRead))
  }
  return { prep, walk }
}

async function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    /** 参数错误是**用法问题**（退出码 2 = 没跑），不是产品失败（1）。 */
    console.error('❌ ' + (error instanceof Error ? error.message : String(error)))
    usage()
    return 2
  }
  if (options.help === true) { usage(); return 0 }

  const runId = timestampRunId()
  /**
   * 证据目录必须**绝对路径**：`--user-data-dir` 是直接传给浏览器的，
   * 相对路径会让 msedge 起不来（表现是"DevTools 端点 15s 内无响应"，报错完全指错方向）。
   * 2026-11-17 实测踩到：`--evidence-dir test-results/responsive/run3` 连着失败两次。
   */
  const evidenceDir = options.evidenceDir === null ? join(REPO_ROOT, 'test-results', 'responsive', runId) : resolve(options.evidenceDir)

  console.log('=== 工作台响应式回归（组件层，真组件 + 真 CSS + 真浏览器）===');

  /**
   * ── 前置检查 ────────────────────────────────────────────────────────────────
   *
   * 必须**在** import `lib/page.mjs` 之前做：那个模块会直接 import `lib/client/styles.js`，
   * 缺文件时抛的是 ERR_MODULE_NOT_FOUND（报错指向模块解析，完全指错方向）。
   * 2026-11-17 实测：另一个会话正在跑 `pnpm build`（先 rmSync lib 再写），
   * 这一瞬间跑本脚本就是那个原始报错 —— 用户需要看到的是"lib 正在构建/缺失"。
   */
  const missingLib = REQUIRED_LIB_FILES.filter((relative) => existsSync(join(REPO_ROOT, relative)) === false)
  if (missingLib.length > 0) {
    console.error('缺少编译产物：' + missingLib.join(', '));
    console.error('本层只测 lib/ 里的**真实产物**。请先 pnpm build 并等它结束（构建会先删 lib/ 再写，中途跑会缺文件）。');
    return 2
  }
  const buildAtStart = buildInfo()
  const env = {
    runId,
    startedAt: new Date().toISOString(),
    harness: SELF_PATH,
    git: gitInfo(),
    build: buildAtStart,
    stage: options.stage,
    strict: options.strict,
    node: process.version,
    platform: process.platform,
  }

  const page = await import(pathToFileURL(join(REPO_ROOT, 'scripts', 'repro', 'responsive', 'lib', 'page.mjs')).href)
  if (page.WORKBENCH_CSS.length < 5000) {
    console.error('lib/client/styles.js 导出的 WORKBENCH_CSS 过短（' + page.WORKBENCH_CSS.length + ' 字符）——先跑 pnpm build');
    return 2
  }
  env.cssBytes = page.WORKBENCH_CSS.length

  mkdirSync(evidenceDir, { recursive: true })
  const shotsDir = join(evidenceDir, 'screenshots')
  mkdirSync(shotsDir, { recursive: true })

  console.log('证据目录：' + evidenceDir);
  console.log('构建：' + env.build.version + ' / ' + env.build.buildId + '    提交：' + env.git.commit + '    CSS：' + env.cssBytes + ' 字符');

  const checks = []
  /**
   * `--selftest-only` 只回答一个问题："判据本身还会不会红"。
   * 源码护栏量的是**产品当前状态**（例如 .wb-split 还没有布局规则），
   * 把它算进自检会让"自检"因为产品没修好而红 —— 那是两件事，混在一起就没人看得懂。
   */
  if (options.selftestOnly === false) {
    for (const check of runSourceGuards(page.SHELL_CONTRACT, REPO_ROOT)) checks.push(check)
  } else {
    console.log('（--selftest-only：只验判据，不含源码护栏与场景矩阵）')
  }

  const widths = options.widths ?? (options.boundary ? [...BOUNDARY_WIDTHS] : [...REQUIRED_WIDTHS])
  const severityOf = (width) => severityForWidth(width, { strict: options.strict })

  // ── 写页面（可离线复现）────────────────────────────────────────────────────
  const pagesDir = join(evidenceDir, 'pages')
  mkdirSync(pagesDir, { recursive: true })
  writeFileSync(join(evidenceDir, 'workbench.css'), page.WORKBENCH_CSS, 'utf8')
  const pages = []
  if (options.selftestOnly === false) {
    for (const shell of ['panel', 'surface']) {
      for (const view of page.VIEWS) {
        const file = join(pagesDir, shell + '-' + view + '.html')
        writeFileSync(file, page.buildScenarioPage({ shell, view }), 'utf8')
        pages.push({ shell, view, file })
      }
    }
  }

  // ── 浏览器 ────────────────────────────────────────────────────────────────
  const browserModule = await import(pathToFileURL(join(REPO_ROOT, 'scripts/verify/browser.mjs')).href)
  const cdpModule = await import(pathToFileURL(join(REPO_ROOT, 'scripts/verify/cdp.mjs')).href)
  const found = options.browserPath === null
    ? browserModule.discoverBrowser()
    : { ok: true, path: options.browserPath, source: '--browser', probed: [options.browserPath] }
  if (found.ok !== true) {
    console.error('找不到可用浏览器：' + found.reason);
    return 2
  }
  env.browser = { path: found.path, source: found.source }
  console.log('浏览器：' + found.path + '（' + found.source + '）');

  const browser = await cdpModule.launchDebugBrowser({
    browserPath: found.path,
    headless: options.headless,
    tmpRoot: join(evidenceDir, 'browser-temp'),
    extraArgs: ['--hide-scrollbars'],
  })

  const probeSelectors = {
    container: '[data-probe="container"]',
    nav: '.wb-nav',
    detail: '.wb-detail',
    header: '.wb-h',
    tabs: '.wb-seg',
  }
  const observations = []
  /** live 层结果（在外面声明：收尾写报告要用）。 */
  let live = null

  try {
    // ── 组件层：场景 × 宽度 ────────────────────────────────────────────────
    for (const one of pages) {
      await browser.goto(pathToFileURL(one.file).href)
      await settleLayout(browser)
      for (const width of widths) {
        await applyWidth(browser, one.shell, width)
        await settleLayout(browser)
        const snapshot = await callInPage(browser, pageSnapshot, probeSelectors)
        const scenario = { id: one.shell + '/' + one.view, shell: one.shell, view: one.view, stackBelow: one.shell === 'surface' ? 760 : null }
        const items = judge({ scenario, width, snapshot, keyboard: null, severity: severityOf(width) })
        for (const item of items) checks.push(Object.assign({ scenario: scenario.id, width }, item))
        await browser.screenshot(join(shotsDir, one.shell + '-' + one.view + '-' + width + '.png'))
        observations.push({
          scenario: scenario.id,
          width,
          severity: severityOf(width),
          viewportWidth: snapshot.viewportWidth,
          containerWidth: snapshot.container === null ? null : snapshot.container.width,
          navWidth: snapshot.nav === null ? null : snapshot.nav.width,
          detailWidth: snapshot.detail === null ? null : snapshot.detail.width,
          columns: snapshot.nav === null || snapshot.detail === null ? 'unknown' : (snapshot.detail.left >= snapshot.nav.right - 1 ? 'side-by-side' : 'stacked'),
          overflowing: snapshot.overflowingCount,
          ellipsized: snapshot.ellipsizedCount,
          detailVisible: snapshot.detailVisibleInViewport,
          counts: snapshot.counts,
        })
        const failedIds = items.filter((item) => item.ok !== true).map((item) => item.id)
        console.log(
          (failedIds.length === 0 ? 'ok  ' : 'FAIL')
          + '  ' + (scenario.id + ' @' + width + 'px').padEnd(28)
          + ' 容器=' + String(snapshot.container === null ? 'null' : snapshot.container.width).padEnd(6)
          + ' 列表=' + String(snapshot.nav === null ? 'null' : snapshot.nav.width).padEnd(6)
          + ' 详情=' + String(snapshot.detail === null ? 'null' : snapshot.detail.width).padEnd(6)
          + ' 溢出=' + String(snapshot.overflowingCount).padEnd(3)
          + (failedIds.length === 0 ? '' : ' ← ' + failedIds.join(', ')),
        )
      }
    }

    // ── 键盘走查（每档壳各测三个代表宽度）────────────────────────────────────
    for (const one of pages) {
      if (one.view !== 'tasks') continue
      await browser.goto(pathToFileURL(one.file).href)
      await settleLayout(browser)
      for (const width of [1440, 1000, 760].filter((candidate) => widths.includes(candidate))) {
        await applyWidth(browser, one.shell, width)
        await settleLayout(browser)
        const keyboard = await walkKeyboard(browser, probeSelectors, 14)
        const snapshot = await callInPage(browser, pageSnapshot, probeSelectors)
        const scenario = { id: one.shell + '/' + one.view, shell: one.shell, view: one.view, stackBelow: one.shell === 'surface' ? 760 : null }
        const items = judge({ scenario, width, snapshot, keyboard, severity: severityOf(width) })
        for (const item of items.filter((entry) => String(entry.id).startsWith('keyboard:'))) {
          checks.push(Object.assign({ scenario: scenario.id, width }, item))
        }
        const keyboardFailed = items.filter((entry) => String(entry.id).startsWith('keyboard:') && entry.ok !== true)
        console.log(
          (keyboardFailed.length === 0 ? 'ok  ' : 'FAIL')
          + '  ' + ('键盘 ' + scenario.id + ' @' + width + 'px').padEnd(28)
          + ' Tab 到 ' + keyboard.walk.filter((entry) => entry.focused !== null).length + '/' + keyboard.prep.count
          + (keyboardFailed.length === 0 ? '' : ' ← ' + keyboardFailed.map((entry) => entry.id).join(', ')),
        )
        await browser.screenshot(join(shotsDir, 'keyboard-' + one.shell + '-' + one.view + '-' + width + '.png'))
      }
    }

    // ── 自检：种缺陷必须被抓住（判据不许空转）──────────────────────────────
    const selftest = []
    for (const selftestId of page.SELFTEST_IDS) {
      const built = page.buildSelftestPage(selftestId)
      const file = join(pagesDir, 'selftest-' + selftestId + '.html')
      writeFileSync(file, built.html, 'utf8')
      await browser.goto(pathToFileURL(file).href)
      await settleLayout(browser)
      await applyWidth(browser, 'panel', 1200)
      await settleLayout(browser)
      const snapshot = await callInPage(browser, pageSnapshot, probeSelectors)
      const scenario = { id: 'selftest/' + selftestId, shell: 'panel', view: 'tasks', stackBelow: null }
      const items = judge({ scenario, width: 1200, snapshot, keyboard: null, severity: 'blocking' })
      const failedIds = items.filter((item) => item.ok !== true).map((item) => item.id)
      const caught = built.expectFailed.every((needed) => failedIds.includes(needed))
      selftest.push({ id: selftestId, note: built.note, expectFailed: built.expectFailed, failedIds, caught })
      checks.push({
        id: 'selftest:' + selftestId,
        ok: caught,
        severity: 'blocking',
        scope: 'setup',
        scenario: scenario.id,
        width: 1200,
        detail: caught
          ? '种下的缺陷被抓住：' + built.expectFailed.join(', ')
          : '种下的缺陷**没被抓住**（判据失效）：期望 ' + built.expectFailed.join(', ') + '，实际失败项 ' + (failedIds.length === 0 ? '（无）' : failedIds.join(', ')),
      })
      console.log((caught ? 'ok  ' : 'FAIL') + '  自检 ' + selftestId + '  [' + built.expectFailed.join(',') + ']');
    }
    env.selftest = selftest

    // ── live 层（可选）：宿主实际挂载，只读 ────────────────────────────────
    if (options.stage === 'live' || options.stage === 'all') {
      const liveModule = await import(pathToFileURL(join(REPO_ROOT, 'scripts', 'repro', 'responsive', 'live-mount-probe.mjs')).href)
      live = await liveModule.runLiveProbe({ browser, evidenceDir, shotsDir, repoRoot: REPO_ROOT, probe: probeSelectors })
      for (const item of live.checks) checks.push(item)
      env.live = live.meta
      if (live.status === 'not-run') console.error('live 层未运行：' + live.reason)
    }
  } catch (error) {
    console.error('❌ 脚本异常：' + (error instanceof Error ? error.message : String(error)))
    checks.push({ id: 'harness:exception', ok: false, severity: 'blocking', scope: 'setup', detail: error instanceof Error ? (error.stack ?? error.message) : String(error) })
  } finally {
    try { await browser.close() } catch { /* 关不掉也要继续写证据 */ }
  }

  /**
   * ── 构建稳定性 ──────────────────────────────────────────────────────────────
   *
   * 本脚本一边跑一边读 `lib/`。如果这期间另一个会话跑了 `pnpm build`（本项目日常如此），
   * 样式/组件会在测量途中被换掉，而输出看上去仍然"正常" —— 那是最难查的一类假证据。
   * 所以收尾比对 buildId：变了就判本次运行**作废**（阻断级）。
   */
  const buildAtEnd = buildInfo()
  checks.push({
    id: 'harness:build-stable',
    ok: buildAtEnd.buildId === buildAtStart.buildId,
    severity: 'blocking',
    scope: 'setup',
    detail: buildAtEnd.buildId === buildAtStart.buildId
      ? 'lib 构建在本轮运行期间未变（' + buildAtEnd.buildId + '）'
      : '**本轮运行期间 lib 被重建了**：开始 ' + buildAtStart.buildId + ' → 结束 ' + buildAtEnd.buildId
        + '（另一个会话可能同时跑了 pnpm build）—— 本次测量混了两个构建，结论作废，请重跑',
  })

  // ── 汇总 ────────────────────────────────────────────────────────────────────
  const summary = summarize(checks)
  const report = {
    suite: 'responsive-component',
    runId,
    env,
    model: {
      layer: 'component',
      e2e: false,
      note: '真实组件 + 真实生产 CSS + 真浏览器；数据是夹具；没有 React 运行时、没有宿主外壳。导航/详情/键盘的真实交互在 live 层。',
      covered: [
        '两栏几何（列表列 / 详情列 / 是否并排）',
        '横向溢出（任意 overflow!=visible 的元素；省略号截断单独统计）',
        '控件退化尺寸与文字被裁',
        '详情列命中测试（折叠线以上、视口内）',
        'Tab 焦点可见性与容器内可达（真实键盘事件）',
        '现有断点 ±1px（--boundary）',
        '宽视口窄容器（container query）',
      ],
      notCovered: ['宿主 E2E（真实后端 / 真实 React 状态）', 'CalendarView 月/周网格', 'TodayPane 今日装配', '详情栏实现（本层是结构替身）', '各弹窗'],
      widths,
      severityPolicy: options.strict === true ? 'strict：所有宽度阻断' : '1000px 及以上阻断；<1000px 只警告（--strict 提级）',
      viewModules: page.VIEW_MODULES,
    },
    observations,
    checks,
    summary,
  }
  if (live !== null) report.live = live.report
  writeFileSync(join(evidenceDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8')

  console.log('');
  console.log('=== 汇总：' + summary.passed + '/' + summary.total + ' 通过，失败 ' + summary.failed + '（阻断 ' + summary.blocking + ' / 警告 ' + summary.watch + '）===');
  const failing = checks.filter((check) => check.ok !== true)
  if (failing.length > 0) {
    console.log('失败项：');
    for (const check of failing) {
      const where = check.scenario === undefined ? '' : ' [' + check.scenario + (check.width === undefined ? '' : ' @' + check.width) + ']'
      console.log('  ' + (check.severity === 'blocking' ? '❌' : '⚠️ ') + ' ' + check.id + where + ' — ' + check.detail)
    }
  }
  if (summary.watch > 0) {
    console.log('');
    console.log('⚠️ 上面 ' + summary.watch + ' 条是 <1000px 的已知差距（按"1000px 以上优先"的口径暂不阻断）。');
    console.log('   重构收尾请用 --strict 把它们提成阻断级。');
  }
  console.log('证据：' + join(evidenceDir, 'report.json'));
  if (live !== null && live.status === 'not-run') {
    console.log('live 层未运行：' + live.reason);
    return 2
  }
  return summary.blocking > 0 ? 1 : 0
}

main()
  .then((code) => {
    /** ⚠️ 显式 process.exit：CDP/浏览器子进程会让 Node 的自然结束挂住，"跑完了"与"卡在事件循环"分不出来。 */
    process.exit(code)
  })
  .catch((error) => {
    console.error('❌ 未捕获异常：' + (error instanceof Error ? (error.stack ?? error.message) : String(error)))
    process.exit(1)
  })
