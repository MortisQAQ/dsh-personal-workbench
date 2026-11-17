/**
 * **live 层**：在真实宿主上只读验证"实际挂载"。
 *
 * ## 这一层补的是什么
 *
 * 组件层（`harness-responsive.mjs`）没有 React 运行时，所以"点导航真的换视图"
 * "点一行真的打开详情"这类**行为**它测不了。live 层连的是**已经在跑的宿主**
 * （例如 http://127.0.0.1:63432），在真页面上点、量、截图 —— 这才是宿主 E2E 的那部分。
 *
 * ## 三条硬约束（都会真的拦住你）
 *
 * 1. **不改真实数据**：只点导航与列表行（都只改客户端状态）；同时在 CDP 的 Network 域上
 *    记录所有请求，把非 GET 的列出来。**不提交任何表单、不点任何写操作按钮。**
 * 2. **不重启宿主**：只读；不碰进程、不装盘、不改配置。
 * 3. **无 secret**：token 只从环境变量进内存（`DSH_WEB_TOKEN` / `DSH_VERIFY_TOKEN`），
 *    绝不进 argv、绝不落盘；报告里只记 origin。
 *
 * ## 还没有选择器时它拒绝开跑
 *
 * `selectors.mjs` 里 `value === null` 的项就是"用户还没给定稿选择器"。
 * 缺了就返回 `not-run`（主流程退出码 2），**不猜**：猜中的选择器照样能跑，
 * 但没人知道它点的是不是对的东西 —— 那种"看起来验过了"比没验更危险。
 */
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { LIVE_SELECTORS, describeContract, pendingSelectorIds, selectorFor } from './selectors.mjs'
import { pageSnapshot } from './lib/probe.mjs'

const REQUIRED_FOR_NAV = ['entryButton', 'navTabButton']
const REQUIRED_FOR_DETAIL = ['detailRow']
const LIVE_WIDTHS = [1440, 1200, 1000, 760]
const NAV_LABELS = ['今日', '日历', '任务', '知识库', '点子']

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function tokenFromEnv() {
  const candidates = [process.env.DSH_WEB_TOKEN, process.env.DSH_VERIFY_TOKEN]
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return null
}

function originFrom(options) {
  const raw = options.url ?? process.env.DSH_WEB_URL ?? 'http://127.0.0.1:63432'
  return new URL(raw).origin
}

/** 把请求方法清单收集起来（用来证明"本层只读"）。 */
function attachNetworkRecorder(browser) {
  const methods = []
  const urls = []
  browser.cdp.onEvent((msg) => {
    if (msg.method !== 'Network.requestWillBeSent') return
    const request = msg.params.request
    methods.push(String(request.method))
    try {
      const parsed = new URL(request.url)
      urls.push(parsed.pathname + parsed.search)
    } catch {
      urls.push('<unparsable>')
    }
  })
  void browser.cdp.send('Network.enable', {}).catch(() => undefined)
  return {
    get methods() { return [...methods] },
    get urls() { return [...urls] },
    nonReadOnly() {
      return methods
        .map((method, index) => ({ method, url: urls[index] }))
        .filter((entry) => ['GET', 'HEAD', 'OPTIONS'].includes(entry.method) === false)
    },
  }
}

async function callInPage(browser, fn, args) {
  const expression = '(' + fn.toString() + ')(' + (args === undefined ? '' : JSON.stringify(args)) + ')'
  return await browser.evaluate('return ' + expression + ';')
}

async function readText(browser, selector) {
  return await browser.evaluate(
    'const node = document.querySelector(' + JSON.stringify(selector) + ');'
    + 'return node === null ? null : { text: String(node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 200), length: String(node.textContent || "").length };',
  )
}

/**
 * 跑 live 层。
 *
 * @param {{browser?: object, evidenceDir: string, shotsDir: string, repoRoot: string, probe?: object, url?: string, headless?: boolean}} options
 */
export async function runLiveProbe(options) {
  const checks = []
  const origin = originFrom(options)
  const token = tokenFromEnv()
  const meta = { layer: 'live', origin, tokenProvided: token !== null, e2e: true }

  if (token === null) {
    return {
      status: 'not-run',
      reason: '缺少宿主 token：请把 dsh web 打印出来的 token 放进环境变量 DSH_WEB_TOKEN（或 DSH_VERIFY_TOKEN），'
        + '**不要**写进命令行参数或任何文件。页面在没有 token 时会返回 401（"dsh web authentication required"）。',
      checks,
      meta,
      report: { status: 'not-run', origin },
    }
  }

  const pendingForNav = REQUIRED_FOR_NAV.filter((id) => selectorFor(id) === null)
  const pendingForDetail = REQUIRED_FOR_DETAIL.filter((id) => selectorFor(id) === null)
  const pending = pendingSelectorIds()
  if (pendingForNav.length > 0 || pendingForDetail.length > 0) {
    return {
      status: 'not-run',
      reason: '选择器尚未定稿，拒绝靠猜测去点真实界面：' + [...pendingForNav, ...pendingForDetail].join(', ')
        + '\n登记表（selectors.mjs）：\n' + describeContract(),
      checks,
      meta: Object.assign(meta, { pendingSelectors: pending }),
      report: { status: 'not-run', origin, pendingSelectors: pending },
    }
  }

  // 只读体检：workbench API 在 loopback 上免 token，可用来核对"挂的是哪个版本"。
  try {
    const health = await fetch(origin + '/api/workbench/health', { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5000) })
    const body = await health.json()
    meta.health = { status: health.status, version: body.version, buildId: body.buildId, schemaVersion: body.db?.schemaVersion, taskCount: body.db?.taskCount }
    checks.push({
      id: 'live:api-health', ok: health.status === 200 && body.ok === true, severity: 'blocking', scope: 'live',
      detail: 'GET /api/workbench/health → ' + health.status + ' version=' + body.version + ' buildId=' + body.buildId + ' tasks=' + body.db?.taskCount,
    })
    let localBuildId = 'unknown'
    try {
      const info = JSON.parse(await (await import('node:fs/promises')).readFile(join(options.repoRoot, 'lib', 'build-info.json'), 'utf8'))
      localBuildId = info.buildId ?? 'unknown'
    } catch { /* 没有本地构建产物就只记 unknown */ }
    checks.push({
      id: 'live:build-match', ok: localBuildId === 'unknown' || body.buildId === localBuildId, severity: 'watch', scope: 'live',
      detail: '宿主 buildId=' + body.buildId + '，本地 lib buildId=' + localBuildId
        + (body.buildId === localBuildId ? '（一致）' : '（**不一致**：live 验的是已装盘的那份构建，不是当前工作区）'),
    })
  } catch (error) {
    checks.push({ id: 'live:api-health', ok: false, severity: 'blocking', scope: 'live', detail: 'GET /api/workbench/health 失败：' + (error instanceof Error ? error.message : String(error)) })
  }

  const browser = options.browser
  if (browser === undefined) {
    return { status: 'not-run', reason: 'live 层需要由 harness-responsive.mjs 传入浏览器实例（或用本文件的 CLI 入口单独跑）', checks, meta, report: { status: 'not-run', origin } }
  }

  const recorder = attachNetworkRecorder(browser)
  const pageUrl = origin + '/?token=' + encodeURIComponent(token)
  await browser.goto(pageUrl)
  await sleep(1500)

  const html = await browser.evaluate('return { status: document.readyState, hasRoot: document.querySelector("#root") !== null, bodyLength: document.body.innerHTML.length, title: document.title };')
  checks.push({
    id: 'live:page-load', ok: html.bodyLength > 500, severity: 'blocking', scope: 'live',
    detail: '页面加载：readyState=' + html.status + ' root=' + String(html.hasRoot) + ' body=' + html.bodyLength + ' 字符（title=' + html.title + '）',
  })

  // 打开工作台：入口是"开关"，必须先读状态再决定点不点（点两次会关掉它）。
  const panelSelector = selectorFor('panelHost') ?? '.wb-panel-host'
  const readOpen = () => browser.evaluate('const host = document.querySelector(' + JSON.stringify(panelSelector) + '); return host === null ? null : host.getAttribute("data-open");')
  let openState = await readOpen()
  if (openState !== '1') {
    const entry = selectorFor('entryButton')
    const clicked = await browser.evaluate(
      'const selector = ' + JSON.stringify(entry) + ';'
      + 'const nodes = Array.from(document.querySelectorAll(selector));'
      + 'const hit = nodes.find((node) => node.offsetParent !== null);'
      + 'if (hit === undefined) return null;'
      + 'hit.scrollIntoView({ block: "center" });'
      + 'const rect = hit.getBoundingClientRect();'
      + 'return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };',
    )
    if (clicked === null) {
      checks.push({ id: 'live:mount', ok: false, severity: 'blocking', scope: 'live', detail: '找不到可见的入口按钮（选择器 ' + entry + '）' })
    } else {
      await browser.clickAt(clicked.x, clicked.y)
      await sleep(800)
      openState = await readOpen()
    }
  }
  checks.push({ id: 'live:mount', ok: openState === '1', severity: 'blocking', scope: 'live', detail: '面板 data-open=' + String(openState) + '（选择器 ' + panelSelector + '）' })

  const widthChecks = []
  const navSelector = selectorFor('navTabButton')
  const viewSelector = selectorFor('viewRoot') ?? '.wb-nav'
  for (const width of LIVE_WIDTHS) {
    await browser.cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
    await sleep(250)
    const snapshot = await callInPage(browser, pageSnapshot, { container: panelSelector, nav: viewSelector, detail: selectorFor('detailRoot') ?? '.wb-detail', header: '.wb-h', tabs: '.wb-seg' })
    const container = snapshot.container
    const overflows = snapshot.overflowingCount
    const fits = container === null ? false : (snapshot.viewportWidth <= container.right + 1 || true)
    widthChecks.push({ width, overflowing: overflows, navWidth: snapshot.nav === null ? null : snapshot.nav.width, detailWidth: snapshot.detail === null ? null : snapshot.detail.width })
    checks.push({
      id: 'live:overflow@' + width,
      ok: overflows === 0 && container !== null,
      severity: width >= 1000 ? 'blocking' : 'watch',
      scope: 'live',
      detail: '视口 ' + width + 'px：容器=' + (container === null ? 'null' : container.width) + ' 列表列=' + (snapshot.nav === null ? 'null' : snapshot.nav.width) + ' 详情列=' + (snapshot.detail === null ? 'null' : snapshot.detail.width) + ' 横向溢出元素=' + overflows + (snapshot.overflowing.length === 0 ? '' : '（' + snapshot.overflowing.slice(0, 3).map((item) => item.el).join(', ') + '）'),
    })
    await browser.screenshot(join(options.shotsDir, 'live-' + width + '.png'))
  }

  // 导航切换：点每个页签，用"视图列内容变化"证明真的切过去了。
  await browser.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await sleep(200)
  for (const label of NAV_LABELS) {
    const before = await readText(browser, viewSelector)
    const clicked = await browser.evaluate(
      'const nodes = Array.from(document.querySelectorAll(' + JSON.stringify(navSelector) + '));'
      + 'const hit = nodes.find((node) => String(node.textContent || "").includes(' + JSON.stringify(label) + ') && node.offsetParent !== null);'
      + 'if (hit === undefined) return null;'
      + 'hit.scrollIntoView({ block: "center" });'
      + 'const rect = hit.getBoundingClientRect();'
      + 'return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };',
    )
    if (clicked === null) {
      checks.push({ id: 'live:nav-' + label, ok: false, severity: 'blocking', scope: 'live', detail: '找不到导航按钮「' + label + '」（选择器 ' + navSelector + '）' })
      continue
    }
    await browser.clickAt(clicked.x, clicked.y)
    await sleep(600)
    const after = await readText(browser, viewSelector)
    const changed = before === null || after === null ? false : before.text !== after.text
    checks.push({
      id: 'live:nav-' + label,
      ok: changed,
      severity: 'blocking',
      scope: 'live',
      detail: '「' + label + '」切换后视图列内容' + (changed ? '已变化' : '**没变**（可能没切过去，或该视图内容与上一视图完全相同）')
        + '：' + (before === null ? 'null' : before.length) + ' → ' + (after === null ? 'null' : after.length) + ' 字符',
    })
    await browser.screenshot(join(options.shotsDir, 'live-nav-' + label + '.png'))
  }

  // 详情可达：点一行 → 详情列进入激活态且有内容。
  const rowSelector = selectorFor('detailRow')
  const detailSelector = selectorFor('detailRoot') ?? '.wb-detail'
  const row = await browser.evaluate(
    'const nodes = Array.from(document.querySelectorAll(' + JSON.stringify(rowSelector) + '));'
    + 'const hit = nodes.find((node) => node.offsetParent !== null && node.getBoundingClientRect().height > 4);'
    + 'if (hit === undefined) return null;'
    + 'hit.scrollIntoView({ block: "center" });'
    + 'const rect = hit.getBoundingClientRect();'
    + 'return { x: Math.round(rect.left + Math.min(rect.width / 2, 80)), y: Math.round(rect.top + rect.height / 2) };',
  )
  if (row === null) {
    checks.push({ id: 'live:detail-open', ok: false, severity: 'blocking', scope: 'live', detail: '列表里没有可点的行（选择器 ' + rowSelector + '）；真实数据为空时请先造一条测试任务再跑 live 层' })
  } else {
    await browser.clickAt(row.x, row.y)
    await sleep(800)
    const detail = await browser.evaluate(
      'const detail = document.querySelector(' + JSON.stringify(detailSelector) + ');'
      + 'const split = document.querySelector(".wb-split");'
      + 'return { present: detail !== null, length: detail === null ? 0 : String(detail.textContent || "").length,'
      + ' active: split === null ? null : split.getAttribute("data-detail-active") };',
    )
    checks.push({
      id: 'live:detail-open',
      ok: detail.present === true && detail.length > 20,
      severity: 'blocking',
      scope: 'live',
      detail: '点行后详情列：存在=' + String(detail.present) + ' 文本=' + detail.length + ' 字符 data-detail-active=' + String(detail.active),
    })
    await browser.screenshot(join(options.shotsDir, 'live-detail.png'))
  }

  // 只读自证：把非 GET 请求列出来。
  const writes = recorder.nonReadOnly()
  checks.push({
    id: 'live:read-only',
    ok: writes.length === 0,
    severity: 'watch',
    scope: 'live',
    detail: writes.length === 0
      ? '本层请求全是 GET/HEAD/OPTIONS（共 ' + recorder.methods.length + ' 条）'
      : '出现 ' + writes.length + ' 条非只读请求（可能来自工作台自身的埋点/回执，务必人工确认没有落库）：'
        + writes.slice(0, 6).map((entry) => entry.method + ' ' + entry.url).join('; '),
  })

  meta.widths = widthChecks
  meta.pendingSelectors = pending
  return {
    status: 'ok',
    reason: null,
    checks,
    meta,
    report: {
      status: 'ok',
      origin,
      widths: widthChecks,
      requestCount: recorder.methods.length,
      nonReadOnlyRequests: writes,
      selectorsInUse: Object.fromEntries(Object.keys(LIVE_SELECTORS).map((id) => [id, selectorFor(id)])),
    },
  }
}

/** 直接 `node live-mount-probe.mjs` 时的入口：自己起一个独立调试浏览器（不碰用户窗口）。 */
async function cli() {
  const repoRoot = new URL('../../../', import.meta.url).pathname.replace(/^\//, '')
  const evidenceDir = process.argv.includes('--evidence-dir')
    ? process.argv[process.argv.indexOf('--evidence-dir') + 1]
    : join(repoRoot, 'test-results', 'responsive', 'live-' + Date.now())
  const browserModule = await import(pathToFileURL(join(repoRoot, 'scripts/verify/browser.mjs')).href)
  const cdpModule = await import(pathToFileURL(join(repoRoot, 'scripts/verify/cdp.mjs')).href)
  const found = browserModule.discoverBrowser()
  if (found.ok !== true) { console.error('找不到可用浏览器：' + found.reason); process.exit(2) }
  const browser = await cdpModule.launchDebugBrowser({ browserPath: found.path, headless: true, tmpRoot: join(evidenceDir, 'browser-temp') })
  let result
  try {
    result = await runLiveProbe({ browser, evidenceDir, shotsDir: evidenceDir, repoRoot })
  } finally {
    try { await browser.close() } catch { /* ignore */ }
  }
  for (const check of result.checks) console.log((check.ok ? 'ok  ' : 'FAIL') + '  ' + check.id + ' — ' + check.detail)
  if (result.status === 'not-run') {
    console.error('\nlive 层未运行：' + result.reason)
    process.exit(2)
  }
  const failed = result.checks.filter((check) => check.ok !== true && check.severity === 'blocking')
  console.log('\nlive 层：' + (result.checks.length - result.checks.filter((check) => check.ok !== true).length) + '/' + result.checks.length + ' 通过')
  process.exit(failed.length > 0 ? 1 : 0)
}

const isDirect = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirect) {
  cli().catch((error) => {
    console.error('❌ live 层异常：' + (error instanceof Error ? (error.stack ?? error.message) : String(error)))
    process.exit(1)
  })
}
