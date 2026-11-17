/**
 * 宽度矩阵与严重度策略（纯数据 + 纯函数）。
 *
 * ## 为什么单独立文件
 *
 * 这份响应式回归的判据里，"哪些宽度必须过、哪些先只记录"是一个**政策**。
 * 政策写死在主流程里就只能靠人眼复核；抽出来之后可以被直接 import 断言
 *（并且 `--selftest` 会对同一份判据种缺陷，证明它真的会红）。
 *
 * ## 口径（来自用户 2026-11-17 的需求）
 *
 * 工作台即将做"**1000px 以上优先**"的重构，所以：
 * - `>= PRIORITY_MIN_WIDTH`（1000）的容器宽度是**阻断级**（blocking）——
 *   这几档不过就不许合；
 * - `< 1000` 的三档（760 / 480 / 360）照样**测量 + 截图 + 进 JSON**，但默认只算
 *   `watch`：不阻断退出码（重构后可以 `--strict` 提级）。
 *
 * ⚠️ watch **不是跳过**：它一定被测量、被写进报告、被打印出来。跳过的检查会让人
 * 以为"那些宽度没问题"，而 watch 说的是"跑了、现在不行、按政策暂不阻断"。
 */

/** 用户点名的 6 档容器宽度（默认矩阵）。 */
export const REQUIRED_WIDTHS = Object.freeze([1440, 1200, 1000, 760, 480, 360])

/**
 * 现有 CSS 里真实存在的断点 + 它们的 ±1 邻居。
 *
 * 为什么要有：`styles.ts` 里有 `max-width:1100`（顶栏）、`max-width:900`（弹窗/设置）、
 * `max-width:720`（点子单列）与 `@container (max-width:760px)`（侧栏两栏改上下）。
 * 断点两侧各 1px 的行为差异是这类重构最典型的翻车点，而 1440/1200/1000 三档
 * **一个都踩不到**这些断点（1000 落在 900 与 1100 之间）。
 */
export const BOUNDARY_WIDTHS = Object.freeze([
  1201, 1200, 1101, 1100, 1001, 1000, 901, 900, 761, 760, 721, 720, 481, 480, 361, 360,
])

/** 阻断级的最小容器宽度（用户口径：1000px 以上优先）。 */
export const PRIORITY_MIN_WIDTH = 1000

/** "宽视口窄容器"用的视口宽度：容器比视口窄得多，才能暴露 container query 与媒体查询口径不一致的问题。 */
export const WIDE_VIEWPORT = Object.freeze({ width: 1440, height: 900 })

export const SEVERITY = Object.freeze({ blocking: 'blocking', watch: 'watch' })

/**
 * 一个宽度下发现的缺陷，默认算阻断还是只警告。
 *
 * @param {number} width 容器宽度（px）
 * @param {{strict?: boolean}} [options] `strict` 把所有宽度都提级为阻断（重构收尾时用）
 * @returns {'blocking'|'watch'}
 */
export function severityForWidth(width, options = {}) {
  if (options.strict === true) return SEVERITY.blocking
  return width >= PRIORITY_MIN_WIDTH ? SEVERITY.blocking : SEVERITY.watch
}

/**
 * 解析 `--widths 1440,1200,1000`。
 *
 * 非法输入**当场拒绝**并回显合法形态（静默丢件是禁区：少测一档却报绿是最坏的形态）。
 *
 * @param {string} value
 * @returns {number[]}
 */
export function parseWidths(value) {
  const parts = String(value).split(',').map((part) => part.trim()).filter((part) => part !== '')
  if (parts.length === 0) throw new Error('--widths 为空：至少给一个宽度，例如 --widths 1440,1200,1000')
  return parts.map((part) => {
    const width = Number(part)
    if (!Number.isInteger(width) || width < 240 || width > 4000) {
      throw new Error('--widths 里的宽度非法：' + part + '（要求 240–4000 的整数，例如 1440）')
    }
    return width
  })
}

/**
 * 把"每档宽度的严重度"算出来，供汇总与报告用。
 * @param {number[]} widths
 * @param {{strict?: boolean}} [options]
 */
export function severityTable(widths, options = {}) {
  return widths.map((width) => ({ width, severity: severityForWidth(width, options) }))
}
