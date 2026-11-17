/**
 * live 层（宿主实际挂载）的**选择器契约**。
 *
 * ## 为什么单独立一份、并且允许为 null
 *
 * 组件层的外壳是照源码手抄的，而 live 层要点的东西在**真实宿主页面**里 ——
 * 类名/层级由工作台自己决定，且这次重构（两栏 + 1000px 以上优先）一定会动它们。
 * 所以这里把"要点哪些东西"显式列成一张契约表：
 *
 * - `value` 是**空**的（`null`）= 还没有定稿的选择器 → live 层**拒绝开跑**并列出缺哪些，
 *   绝不"猜一个选择器继续点"（猜中的概率不低，猜中的时候出错也没人知道）。
 * - 有 `fallback` 的项表示"暂用这个兜底"，兜底本身也是要复核的假设。
 *
 * 用户提供选择器后，把对应 `value` 填上即可；`note` 里写了每一项用来验什么。
 */

/**
 * @typedef {{id: string, value: string|null, fallback: string|null, note: string, requiredBy: string}} LiveSelector
 */

/** @type {Record<string, LiveSelector>} */
export const LIVE_SELECTORS = Object.freeze({
  entryButton: {
    id: 'entryButton',
    value: null,
    fallback: null,
    note: '侧栏里打开/切回工作台的入口（一个 button，文字含「工作台」）。用来把面板打开到可测状态。',
    requiredBy: 'live:mount',
  },
  panelHost: {
    id: 'panelHost',
    value: null,
    fallback: '.wb-panel-host',
    note: '满屏面板容器（带 data-open 属性的那个）。用来读面板是否打开、以及容器几何。',
    requiredBy: 'live:mount / live:overflow',
  },
  navTabButton: {
    id: 'navTabButton',
    value: null,
    fallback: null,
    note: '视图导航按钮（今日 / 日历 / 任务 / 知识库 / 点子）。需要能按可见文字定位到具体那一个。',
    requiredBy: 'live:nav-switch',
  },
  viewRoot: {
    id: 'viewRoot',
    value: null,
    fallback: '.wb-nav',
    note: '切换视图后内容会变的那一列（列表/主内容）。用来证明"真的换了视图"，而不是只高亮了按钮。',
    requiredBy: 'live:nav-switch',
  },
  detailRoot: {
    id: 'detailRoot',
    value: null,
    fallback: '.wb-detail',
    note: '详情列。用来验"详情可达"：点开一条之后它是否进入激活态、是否有内容、是否仍在容器内。',
    requiredBy: 'live:detail-open',
  },
  detailRow: {
    id: 'detailRow',
    value: null,
    fallback: null,
    note: '列表里点一下就打开详情的那一行（任务行 / 知识行）。**必须由用户确认**：点错东西会改数据。',
    requiredBy: 'live:detail-open',
  },
})

/** 返回还没有定稿（value === null）的选择器 id。 */
export function pendingSelectorIds() {
  return Object.values(LIVE_SELECTORS).filter((entry) => entry.value === null).map((entry) => entry.id)
}

/** 取一个选择器的可用值（定稿值优先，其次兜底）。没有可用值返回 null。 */
export function selectorFor(id) {
  const entry = LIVE_SELECTORS[id]
  if (entry === undefined) throw new Error('未登记的选择器：' + id)
  if (entry.value !== null && entry.value !== '') return entry.value
  if (entry.fallback !== null && entry.fallback !== '') return entry.fallback
  return null
}

/** 给终端/报告用的一句话清单（不含任何 secret）。 */
export function describeContract() {
  return Object.values(LIVE_SELECTORS).map((entry) => {
    const state = entry.value !== null ? '已定稿：' + entry.value : (entry.fallback !== null ? '待定稿（暂用兜底 ' + entry.fallback + '）' : '待定稿（无兜底）')
    return '  - ' + entry.id.padEnd(14) + state + '  · ' + entry.note
  }).join('\n')
}
