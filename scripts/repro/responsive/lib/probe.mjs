/**
 * 浏览器**页面内**执行的测量函数。
 *
 * ## 为什么写成真函数再 `toString()` 送进去
 *
 * 一是可读/可审（表达式字符串里写错一个括号只有跑起来才知道）；
 * 二是它们天然"自包含"—— 不许闭包引用模块作用域，否则送进页面后会 ReferenceError。
 * 传输方式见 `harness-responsive.mjs`：`'(' + fn.toString() + ')(' + JSON.stringify(args) + ')'`。
 *
 * ⚠️ 每个函数都必须是 **纯自包含**的：只用参数与 `document` / `window` / `getComputedStyle`。
 */

/**
 * 一次量全：容器/两栏几何、横向溢出清单、控件尺寸与文字截断、结构计数、详情命中测试。
 *
 * @param {{container: string, nav: string, detail: string, header: string, tabs: string}} probe 选择器组
 */
export function pageSnapshot(probe) {
  const label = (el) => {
    const cls = typeof el.className === 'string' ? el.className : ''
    const head = cls === '' ? '' : '.' + cls.split(/\s+/).slice(0, 2).join('.')
    return String(el.tagName || '').toLowerCase() + head
  }
  const rectOf = (el) => {
    const r = el.getBoundingClientRect()
    return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) }
  }
  const visible = (el) => {
    const s = getComputedStyle(el)
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 || r.height > 0
  }

  const out = {
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    rootScrollWidth: document.documentElement.scrollWidth,
    rootClientWidth: document.documentElement.clientWidth,
    bodyScrollHeight: document.body.scrollHeight,
  }

  const container = document.querySelector(probe.container)
  out.container = container === null ? null : rectOf(container)
  const nav = document.querySelector(probe.nav)
  out.nav = nav === null ? null : rectOf(nav)
  const detail = document.querySelector(probe.detail)
  out.detail = detail === null ? null : rectOf(detail)
  const header = document.querySelector(probe.header)
  out.header = header === null ? null : rectOf(header)

  /**
   * 横向溢出扫描：**只扫 overflow 非 visible 的元素**。
   *
   * 为什么：overflow:visible 的元素"内容更宽"并不会被裁掉，它会把祖先撑宽 ——
   * 那种情况会先被其它元素的 clientWidth 表现出来；把 visible 也算进来只会产生噪音。
   * 而 hidden/auto/scroll 的元素一旦 scrollWidth > clientWidth，就说明**有东西看不见或要横滚**，
   * 那正是"横向溢出"这件事的定义。
   */
  const overflowing = []
  const ellipsized = []
  let scanned = 0
  for (const el of document.querySelectorAll('*')) {
    const style = getComputedStyle(el)
    if (style.overflowX === 'visible') continue
    if (!visible(el)) continue
    scanned += 1
    if (el.clientWidth <= 0 || el.scrollWidth <= el.clientWidth + 1) continue
    /**
     * `text-overflow: ellipsis` = **设计上就该截断**（例如 `.wb-row-title-text` 的长标题）。
     * 把它算成"横向溢出"会让这条判据被噪音淹没，真正的问题反而看不见 ——
     * 所以这类元素单独收集（`ellipsized`），只作为观察量，不判失败。
     */
    if (style.textOverflow === 'ellipsis') {
      ellipsized.push({ el: label(el), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth })
      continue
    }
    overflowing.push({ el: label(el), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, overflowX: style.overflowX })
  }
  out.overflowing = overflowing
  out.overflowingCount = overflowing.length
  out.ellipsized = ellipsized
  out.ellipsizedCount = ellipsized.length
  out.scannedOverflowNodes = scanned

  /**
   * 控件清单：可见、有尺寸的 button / a[href] / input / select / [role=tab]。
   * 顺便记"文字被裁"（overflowX hidden 且 scrollWidth > clientWidth）——
   * 这是"看得见但读不出"的典型形态，比"宽度为零"更隐蔽。
   */
  const controls = []
  for (const el of document.querySelectorAll('button, a[href], input, select, textarea, [role="tab"]')) {
    if (!visible(el)) continue
    const s = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    controls.push({
      el: label(el),
      text: String(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24),
      width: Math.round(r.width),
      height: Math.round(r.height),
      left: Math.round(r.left),
      right: Math.round(r.right),
      textClipped: s.overflowX === 'hidden' && el.scrollWidth > el.clientWidth + 1,
    })
  }
  out.controls = controls

  /**
   * 样式到底加载上了没有。
   *
   * 这一步是**反假绿**的关键：页面若没拿到 workbench.css，所有布局断言都是对着裸 HTML 跑的
   * （2026-11-17 实测：`<link href="workbench.css">` 与页面不在同一目录 → 全部测量作废，
   * 表现却是"全宽两栏、零溢出"，看起来像一片完美的布局）。`.wb-body` 必须是 flex。
   */
  const bodyNode = document.querySelector('.wb-body')
  const tabNode = document.querySelector(probe.tabs)
  out.styleApplied = {
    sheetCount: document.styleSheets.length,
    bodyDisplay: bodyNode === null ? null : getComputedStyle(bodyNode).display,
    segDisplay: tabNode === null ? null : getComputedStyle(tabNode).display,
    navOverflowX: nav === null ? null : getComputedStyle(nav).overflowX,
  }

  /** 谁把文档撑宽了（一眼定位"横向溢出"的元凶；只取前 8 个）。 */
  const pushingWide = []
  for (const el of document.querySelectorAll('body *')) {
    const style = getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') continue
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0) continue
    if (rect.right > window.innerWidth + 1) {
      pushingWide.push({ el: label(el), right: Math.round(rect.right), width: Math.round(rect.width) })
      if (pushingWide.length >= 8) break
    }
  }
  out.pushingWide = pushingWide

  out.counts = {
    tabs: document.querySelectorAll(probe.tabs).length,
    rows: document.querySelectorAll('.wb-row').length,
    kbRows: document.querySelectorAll('[data-kb-row]').length,
    cards: document.querySelectorAll('[data-idea-card]').length,
    dayTabs: document.querySelectorAll('[data-day-tabs] .wb-seg').length,
  }

  if (detail !== null) {
    const r = detail.getBoundingClientRect()
    /** 详情列是否落在**折叠线以上**（它是 fixed 面板里的普通流内容，滚动后才进视口）。 */
    out.detailVisibleInViewport = r.top < window.innerHeight - 4 && r.bottom > 0
    /**
     * 命中测试点必须落在视口内，否则 `elementFromPoint` 恒返回 null，
     * 会把"详情列被挤出容器右边"重复报成"详情不可达"（同一个根因两条失败）。
     * 横向越界由 `layout:columns-in-container` 负责，这里只判"看得见却不被浮层盖住"。
     */
    const probeX = r.left + r.width / 2
    const probeY = r.top + Math.min(r.height / 2, 40)
    out.detailPointInViewport = probeX >= 0 && probeX <= window.innerWidth - 1 && probeY >= 0 && probeY <= window.innerHeight - 1
    if (r.width > 2 && r.height > 2 && out.detailVisibleInViewport && out.detailPointInViewport) {
      const hit = document.elementFromPoint(probeX, probeY)
      out.detailHit = hit !== null && (detail === hit || detail.contains(hit))
    } else {
      out.detailHit = null
    }
  } else {
    out.detailHit = false
    out.detailVisibleInViewport = false
  }

  return out
}

/**
 * Tab 走查前的准备：把可见可聚焦元素按 DOM 顺序编号，并记录**未聚焦时**的外观签名。
 *
 * 为什么要预先记签名：键盘可用性的核心是"聚焦后看得出来"。聚焦后再读样式就永远读到"变过"，
 * 于是这条断言会恒真（假绿）。
 *
 * @param {{container: string}} probe
 */
export function keyboardPrep(probe) {
  const signature = (el) => {
    const s = getComputedStyle(el)
    return [s.outlineStyle, s.outlineWidth, s.boxShadow, s.backgroundColor, s.borderColor].join('|')
  }
  const container = document.querySelector(probe.container)
  const cr = container === null ? null : container.getBoundingClientRect()
  const items = []
  let index = 0
  for (const el of document.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')) {
    const s = getComputedStyle(el)
    if (s.display === 'none' || s.visibility === 'hidden') continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    el.setAttribute('data-wb-focus-probe', String(index))
    items.push({
      index,
      tag: String(el.tagName || '').toLowerCase(),
      text: String(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 20),
      width: Math.round(r.width),
      height: Math.round(r.height),
      left: Math.round(r.left),
      right: Math.round(r.right),
      signature: signature(el),
    })
    index += 1
  }
  return {
    count: items.length,
    items,
    containerLeft: cr === null ? 0 : Math.round(cr.left),
    containerRight: cr === null ? 0 : Math.round(cr.right),
  }
}

/** 读当前焦点元素（含"聚焦后"的外观签名）。焦点不在页内元素上时返回 null。 */
export function keyboardRead() {
  const el = document.activeElement
  if (el === null || el === document.body || el === document.documentElement) return { focused: null }
  const r = el.getBoundingClientRect()
  const s = getComputedStyle(el)
  return {
    focused: {
      index: el.getAttribute('data-wb-focus-probe'),
      tag: String(el.tagName || '').toLowerCase(),
      text: String(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 20),
      width: Math.round(r.width),
      height: Math.round(r.height),
      left: Math.round(r.left),
      right: Math.round(r.right),
      signature: [s.outlineStyle, s.outlineWidth, s.boxShadow, s.backgroundColor, s.borderColor].join('|'),
    },
  }
}

/** 把焦点移出页面元素（让第一次 Tab 从文档开头开始）。 */
export function blurActive() {
  if (document.activeElement !== null && typeof document.activeElement.blur === 'function') document.activeElement.blur()
  return true
}
