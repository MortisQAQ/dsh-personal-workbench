/**
 * 响应式判据（**纯函数**，不碰浏览器、不碰 fs）。
 *
 * ## 为什么判定要和"怎么量"分开
 *
 * 项目规范第 2 条：纯逻辑必须与 DOM/浏览器解耦，否则它测不动。
 * 这里只接收"已经量好的数字"（`snapshot`）并给出带 `id` 的判定结果；
 * 浏览器里跑的那个测量函数在 `probe.mjs`，两者互不依赖。
 *
 * ## 判据设计的三条原则
 *
 * 1. **不许空跑也算绿**：`structure:*` 与 `setup:*` 是"反假绿"检查 ——
 *    页面没渲染出来 / 宽度没设上去时，其它断言会因为"没有元素"而全部通过。
 * 2. **失败要能定位**：每条失败都带 `detail`（哪个元素、scrollWidth/clientWidth 各多少），
 *    而不是"布局坏了"。
 * 3. **严重度跟着用户口径走**：`>= 1000px` 阻断，`< 1000px` 默认只警告（见 widths.mjs）。
 */

export const TOLERANCE = Object.freeze({
  /** 亚像素/取整误差。 */
  px: 1,
  /** 两栏并排时右侧详情列的最小可用宽度（>=1000 的档位按这一条判）。 */
  detailMinPx: 320,
  /** 左侧列表列的下限（与 `.wb-nav { min-width:420px }` 同值）。 */
  navMinPx: 420,
  /**
   * 可见控件的**退化**下限（小于它 = 压成一条线，基本不可点）。
   *
   * ⚠️ 不用 16px：任务行的展开/收起按钮就是 15×20（`style={{ padding:'2px 6px' }}` 的设计选择）。
   * 把刻意的紧凑控件报成缺陷，判据很快就会被无视 —— 这里只抓"明显被挤坏"的形态。
   */
  controlMinPx: 12,
  /** 键盘可达性：必须能 Tab 到的比例（有些控件可能被刻意移出 tab 序）。 */
  focusAffordanceRatio: 0.8,
})

const CHECK_SCOPE = Object.freeze({ setup: 'setup', layout: 'layout', keyboard: 'keyboard' })

function insideRange(value, low, high) {
  return value >= low - TOLERANCE.px && value <= high + TOLERANCE.px
}

function describeRect(rect) {
  if (rect === null || rect === undefined) return 'null'
  return '[left=' + rect.left + ' right=' + rect.right + ' w=' + rect.width + ' h=' + rect.height + ']'
}

function offenderList(list) {
  if (!Array.isArray(list) || list.length === 0) return ''
  return list.slice(0, 4).map((entry) => entry.el + ' ' + entry.scrollWidth + '>' + entry.clientWidth).join('; ')
}

/**
 * 量出来的东西是"给人看的证据"，判断在这里。
 *
 * @param {{
 *   scenario: { id: string, shell: string, view: string, stackBelow?: number|null },
 *   width: number,
 *   snapshot: object,
 *   keyboard?: { prep: object, walk: object[] } | null,
 *   severity: 'blocking'|'watch',
 * }} input
 * @returns {Array<{id: string, ok: boolean, severity: string, scope: string, detail: string}>}
 */
export function judge(input) {
  const { scenario, width, snapshot, severity } = input
  const checks = []
  const push = (id, ok, detail, scope = CHECK_SCOPE.layout, forced = undefined) => {
    checks.push({ id, ok: ok === true, severity: forced ?? severity, scope, detail: String(detail) })
  }
  const container = snapshot.container
  if (container === null || container === undefined) {
    push('setup:container', false, '容器节点不存在（[data-probe="container"] 没渲染出来）', CHECK_SCOPE.setup, 'blocking')
    return checks
  }

  // ── 反假绿：宽度真的设上去了吗 ────────────────────────────────────────────
  const measured = scenario.shell === 'panel' ? snapshot.viewportWidth : container.width
  push(
    'setup:width',
    Math.abs(measured - width) <= TOLERANCE.px,
    '请求宽度 ' + width + '，实测量到 ' + measured + '（' + (scenario.shell === 'panel' ? 'viewport' : '容器') + '）',
    CHECK_SCOPE.setup,
    'blocking',
  )

  // ── 反假绿：页面不是空的 ────────────────────────────────────────────────
  const counts = snapshot.counts ?? {}
  const structureProblems = []
  if ((counts.tabs ?? 0) < 4) structureProblems.push('导航页签 ' + (counts.tabs ?? 0) + ' < 4')
  const viewCount = scenario.view === 'tasks' || scenario.view === 'day'
    ? (counts.rows ?? 0)
    : scenario.view === 'knowledge' ? (counts.kbRows ?? 0) : (counts.cards ?? 0)
  if (viewCount <= 0) structureProblems.push(scenario.view + ' 视图里没有任何内容行')
  push('structure:nonempty', structureProblems.length === 0, structureProblems.join('; ') || 'tabs=' + counts.tabs + ' rows=' + viewCount, CHECK_SCOPE.setup, severity)

  // ── 反假绿：真样式到底加载上了没有 ─────────────────────────────────────────
  const styleApplied = snapshot.styleApplied ?? {}
  const cssOk = styleApplied.bodyDisplay === 'flex' && styleApplied.navOverflowX === 'auto'
  push(
    'setup:css-applied',
    cssOk,
    cssOk
      ? 'workbench.css 已生效（.wb-body display=flex、.wb-nav overflow-x=auto）'
      : '样式可能没加载：.wb-body display=' + String(styleApplied.bodyDisplay) + '、.wb-nav overflow-x=' + String(styleApplied.navOverflowX)
        + '、样式表 ' + String(styleApplied.sheetCount) + ' 个 —— 此时的布局测量全部作废（页面与 workbench.css 的相对路径检查一下）',
    CHECK_SCOPE.setup,
    'blocking',
  )

  // ── 横向溢出：文档根 ────────────────────────────────────────────────────
  const rootOverflow = (snapshot.rootScrollWidth ?? 0) - (snapshot.rootClientWidth ?? 0)
  const pushing = Array.isArray(snapshot.pushingWide) ? snapshot.pushingWide : []
  push(
    'overflow:root',
    rootOverflow <= TOLERANCE.px,
    'documentElement.scrollWidth - clientWidth = ' + rootOverflow
      + (pushing.length === 0 ? '' : '；超出视口右边的元素：' + pushing.slice(0, 4).map((entry) => entry.el + ' right=' + entry.right).join('; ')),
  )

  // ── 横向溢出：任何 overflow!=visible 的元素都不许横滚 ─────────────────────
  const overflowing = snapshot.overflowing ?? []
  const ellipsisNote = (snapshot.ellipsizedCount ?? 0) > 0 ? '（另有 ' + snapshot.ellipsizedCount + ' 个元素按设计省略号截断，不算溢出）' : ''
  push(
    'overflow:axis',
    overflowing.length === 0,
    (overflowing.length === 0 ? '无横向溢出元素' : overflowing.length + ' 个元素横向溢出：' + offenderList(overflowing)) + ellipsisNote,
  )

  // ── 两栏都要在容器内（详情列被挤出去 = 点不到也看不见）─────────────────────
  const nav = snapshot.nav
  const detail = snapshot.detail
  const navFit = nav !== null && insideRange(nav.left, container.left, container.right) && nav.right <= container.right + TOLERANCE.px
  const detailFit = detail !== null && detail.left >= container.left - TOLERANCE.px && detail.right <= container.right + TOLERANCE.px
  push(
    'layout:columns-in-container',
    navFit && detailFit,
    'container=' + describeRect(container) + ' nav=' + describeRect(nav) + ' detail=' + describeRect(detail),
  )

  // ── 详情列可用宽度 ──────────────────────────────────────────────────────
  push(
    'layout:detail-usable',
    detail !== null && detail.width >= TOLERANCE.detailMinPx,
    '详情列宽 ' + (detail === null ? 'null' : detail.width) + 'px（下限 ' + TOLERANCE.detailMinPx + 'px）',
  )

  // ── 列表列宽度：既不能压到 min-width 以下，也不该不知收敛地长 ───────────────
  if (width >= 1000) {
    const expectedMax = Math.min(width * 0.56, 880) + TOLERANCE.px
    push(
      'layout:nav-ratio',
      nav !== null && nav.width >= TOLERANCE.navMinPx && nav.width <= expectedMax,
      '列表列宽 ' + (nav === null ? 'null' : nav.width) + 'px（期望 ' + TOLERANCE.navMinPx + '–' + Math.round(expectedMax) + 'px）',
    )
  }

  // ── 并排 / 上下堆叠 ─────────────────────────────────────────────────────
  if (width >= 1001) {
    push(
      'layout:side-by-side',
      nav !== null && detail !== null && detail.left >= nav.right - TOLERANCE.px,
      'nav=' + describeRect(nav) + ' detail=' + describeRect(detail) + '（>=1001 期望左右并排）',
    )
  } else if (scenario.stackBelow !== null && scenario.stackBelow !== undefined && width <= scenario.stackBelow) {
    push(
      'layout:stacked',
      nav !== null && detail !== null && detail.top >= nav.bottom - TOLERANCE.px,
      'nav.bottom=' + (nav === null ? 'null' : nav.bottom) + ' detail.top=' + (detail === null ? 'null' : detail.top) + '（<=' + scenario.stackBelow + ' 期望上下堆叠）',
    )
  }

  // ── 控件不许被压成一条线 / 文字不许被裁掉 ────────────────────────────────
  const controls = Array.isArray(snapshot.controls) ? snapshot.controls : []
  const tooSmall = controls.filter((c) => c.width < TOLERANCE.controlMinPx || c.height < TOLERANCE.controlMinPx)
  push(
    'controls:min-size',
    tooSmall.length === 0,
    tooSmall.length === 0 ? '共 ' + controls.length + ' 个可见控件' : tooSmall.slice(0, 4).map((c) => c.el + ' ' + c.width + 'x' + c.height + '「' + c.text + '」').join('; '),
  )
  const clipped = controls.filter((c) => c.textClipped === true)
  push(
    'controls:text-not-clipped',
    clipped.length === 0,
    clipped.length === 0 ? '无控件文字被裁' : clipped.slice(0, 4).map((c) => c.el + '「' + c.text + '」').join('; '),
  )

  /**
   * ── 详情列真的能被点到（不被浮层盖住）───────────────────────────────────
   *
   * 只看**折叠线以上**的详情列：堆叠布局下详情列本来就在下面，用命中测试去判它"不可达"
   * 会把"堆叠"这个已知形态重复计一次失败，反而掩盖真正的问题（谁该为堆叠负责是
   * `layout:side-by-side` / `layout:stacked` 的事）。
   */
  if (snapshot.detailVisibleInViewport === true && snapshot.detailPointInViewport === true) {
    push('detail:hit-testable', snapshot.detailHit === true, 'elementFromPoint(详情列中心) 命中详情列：' + String(snapshot.detailHit))
  } else if (snapshot.detailVisibleInViewport !== true) {
    push('detail:hit-testable', true, '不适用：详情列在折叠线以下（堆叠布局的必然结果），由 layout 系列判堆叠是否合理')
  } else {
    push('detail:hit-testable', true, '不适用：详情列中心点在视口外（横向越界由 layout:columns-in-container 负责）')
  }

  // ── 键盘 ────────────────────────────────────────────────────────────────
  if (input.keyboard !== null && input.keyboard !== undefined) {
    for (const check of judgeKeyboard(input.keyboard, container, severity)) checks.push(check)
  }

  return checks
}

/**
 * 键盘可达性判定。
 *
 * @param {{prep: {count: number, items: object[]}, walk: object[]}} keyboard
 * @param {{left: number, right: number}} container
 * @param {string} severity
 */
export function judgeKeyboard(keyboard, container, severity) {
  const checks = []
  const walk = Array.isArray(keyboard.walk) ? keyboard.walk.filter((entry) => entry.focused !== null) : []
  const prep = keyboard.prep ?? { count: 0, items: [] }
  const expected = Math.min(prep.count, 12)
  checks.push({
    id: 'keyboard:reach',
    ok: walk.length >= expected && expected > 0,
    severity,
    scope: CHECK_SCOPE.keyboard,
    detail: 'Tab 到 ' + walk.length + ' 个可聚焦元素（期望 >= ' + expected + '，页面共 ' + prep.count + ' 个）',
  })
  const invisible = walk.filter((entry) => entry.focused.width <= 0 || entry.focused.height <= 0)
  checks.push({
    id: 'keyboard:focus-visible',
    ok: invisible.length === 0,
    severity,
    scope: CHECK_SCOPE.keyboard,
    detail: invisible.length === 0 ? '每个获得焦点的元素都有可见尺寸' : invisible.slice(0, 4).map((entry) => entry.focused.tag + '「' + entry.focused.text + '」').join('; '),
  })
  const outside = walk.filter((entry) => entry.focused.right > container.right + TOLERANCE.px || entry.focused.left < container.left - TOLERANCE.px)
  checks.push({
    id: 'keyboard:focus-inside',
    ok: outside.length === 0,
    severity,
    scope: CHECK_SCOPE.keyboard,
    detail: outside.length === 0 ? '焦点元素都在容器内' : outside.slice(0, 4).map((entry) => entry.focused.tag + '「' + entry.focused.text + '」 left=' + entry.focused.left).join('; '),
  })
  const byIndex = new Map(prep.items.map((item) => [String(item.index), item]))
  const changed = walk.filter((entry) => {
    const before = byIndex.get(String(entry.focused.index))
    return before !== undefined && before.signature !== entry.focused.signature
  })
  const ratio = walk.length === 0 ? 0 : changed.length / walk.length
  checks.push({
    id: 'keyboard:focus-affordance',
    ok: ratio >= TOLERANCE.focusAffordanceRatio,
    severity,
    scope: CHECK_SCOPE.keyboard,
    detail: '聚焦后外观有变化的元素 ' + changed.length + '/' + walk.length + '（下限 ' + TOLERANCE.focusAffordanceRatio + '）',
  })
  return checks
}

/**
 * 汇总：blocking 失败数决定退出码，watch 失败只打印。
 * @param {Array<{id: string, ok: boolean, severity: string}>} checks
 */
export function summarize(checks) {
  const failed = checks.filter((check) => check.ok !== true)
  const blocking = failed.filter((check) => check.severity === 'blocking')
  const watch = failed.filter((check) => check.severity === 'watch')
  return {
    total: checks.length,
    passed: checks.length - failed.length,
    failed: failed.length,
    blocking: blocking.length,
    watch: watch.length,
    blockingIds: blocking.map((check) => check.id),
    watchIds: watch.map((check) => check.id),
  }
}
