/**
 * 响应式回归的夹具数据（**mock**，不是从宿主读来的）。
 *
 * 为什么集中一处：组件层的判据是"布局在固定内容压力下是否成立"，
 * 所以每条断言都与这份数据绑定；数据散落在装配代码里，改一个标题就可能让
 * "恰好没溢出"变成假绿。夹具刻意包含三轮压力：超长标题、无空格长串、
 * 足够多的行（撑出滚动条）。
 */

const NOW = Date.parse('2026-11-17T10:00:00+08:00')
const DAY = 86400000
const at = (msAgo) => new Date(NOW - msAgo).toISOString()

export const FIXTURE_NOW = NOW

export const DICTS = Object.freeze([
  { kind: 'task_type', code: 'code_impl', name: '代码实现', config: { color: '#4F86F7' } },
  { kind: 'task_type', code: 'solution_design', name: '方案设计', config: { color: '#8B7BE8' } },
  { kind: 'task_priority', code: 'p0', name: '紧急', config: { color: '#E7634C' } },
  { kind: 'task_priority', code: 'p1', name: '高', config: { color: '#E0A030' } },
  { kind: 'task_priority', code: 'p2', name: '普通', config: { color: '#4F86F7' } },
  { kind: 'task_status', code: 'doing', name: '进行中', config: { color: '#2E9B7B' } },
  { kind: 'task_status', code: 'todo', name: '待办', config: { color: '#8a9aa8' } },
])

/** 造一条任务（字段齐全，与服务端下发形状一致）。 */
export function makeTask(index, patch) {
  const base = {
    id: 'task-' + index,
    parentId: null,
    title: '把工作台两栏布局在 1000px 以上优先收敛（第 ' + index + ' 条：标题刻意写长，用来观察截断与换行）',
    description: '夹具任务，不是真实数据。',
    typeCode: index % 2 === 0 ? 'code_impl' : 'solution_design',
    statusCode: index % 3 === 0 ? 'todo' : 'doing',
    priorityCode: ['p0', 'p1', 'p2'][index % 3],
    aiPolicyCode: 'consult',
    dueAt: at(-DAY),
    effectiveDueAt: at(-DAY),
    allDay: false,
    estimatedMinutes: 30 + (index % 4) * 15,
    source: 'user',
    workspacePath: null,
    effectiveWorkspacePath: null,
    progressPercent: index % 5 === 0 ? 0 : (index * 17) % 90,
    archived: false,
    extra: {},
    recurrenceCode: null,
    recurrenceRule: {},
    recurrenceMasterId: null,
    recurrenceLastGenerated: null,
    createdAt: at(3 * DAY),
    updatedAt: at(3600000),
    completedAt: null,
    cancelledAt: null,
  }
  return Object.assign(base, patch === undefined ? {} : patch)
}

export const TASK_ROOTS = Object.freeze([
  {
    task: makeTask(0),
    children: [
      { task: makeTask(10, { parentId: 'task-0', title: '子任务：无空格长串 ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 看它会不会把行撑破' }), children: [] },
      { task: makeTask(11, { parentId: 'task-0', title: '子任务：短标题' }), children: [] },
    ],
  },
  { task: makeTask(1), children: [] },
  { task: makeTask(2), children: [] },
  { task: makeTask(3), children: [] },
  { task: makeTask(4), children: [] },
  { task: makeTask(5), children: [] },
  { task: makeTask(6), children: [] },
  { task: makeTask(7), children: [] },
])

export const TASKS = Object.freeze(TASK_ROOTS.map((node) => node.task))

export const PLAN = Object.freeze({
  id: 'plan-fixture',
  planDate: '2026-11-17',
  summary: '夹具计划：先清逾期，再用上午整块时间做方案。',
  items: [
    { taskId: 'task-0', order: 1, title: '先做这件事', note: '理由：它卡着别人', minutes: 45, effortDone: false },
    { taskId: 'task-1', order: 2, title: '再做那件事', note: '理由：上午整块时间', minutes: 60, effortDone: true },
    { taskId: 'task-2', order: 3, title: '顺手清掉的小事', note: '', minutes: 15, effortDone: false },
  ],
  sourceCode: 'manual',
  sessionId: null,
  createdAt: at(DAY),
  updatedAt: at(3600000),
  readable: true,
  diagnostics: [],
})

export const KNOWLEDGE_KINDS = Object.freeze([
  { kind: 'knowledge_kind', code: 'note', name: '笔记', config: { color: '#4F86F7' } },
  { kind: 'knowledge_kind', code: 'lesson', name: '经验教训', config: { color: '#E7634C' } },
  { kind: 'knowledge_kind', code: 'decision', name: '决策记录', config: { color: '#8B7BE8' } },
])

export const IDEA_KINDS = Object.freeze([
  { kind: 'idea_kind', code: 'project', name: '项目点子', config: { color: '#4F86F7' } },
  { kind: 'idea_kind', code: 'spark', name: '突发奇想', config: { color: '#E7634C' } },
])

/** 知识条目：12 条（分页 10 条 → 会渲染分页条），标题/标签都够长。 */
export function knowledgeEntries(toContentItem) {
  return Array.from({ length: 12 }, (_, index) => toContentItem({
    id: 'kb-' + index,
    title: '知识条目 ' + index + '：把响应式验证做成可独立跑的浏览器回归（标题刻意写长，观察行内截断）',
    contentMd: '现象：窄容器里两栏挤在一起。\n原因：判定写在组件里就没法测。\n解法：判定抽成纯函数。',
    tags: index % 3 === 0 ? ['踩坑', 'DSH', '响应式'] : ['性能'],
    kindCode: KNOWLEDGE_KINDS[index % KNOWLEDGE_KINDS.length].code,
    createdAt: at(index * DAY),
    updatedAt: at(index < 4 ? index * 3600000 : index * DAY),
  }))
}

/** 点子：6 条（够铺两列/单列各一屏）。 */
export function ideaCards(toContentItem) {
  return Array.from({ length: 6 }, (_, index) => Object.assign(
    toContentItem({
      id: 'idea-' + index,
      title: '点子 ' + index + '：为 1000px 以上优先重构准备可独立跑的响应式回归',
      contentMd: '内容：用真组件 + 真样式在浏览器里量布局。',
      tags: ['回归', 'UI'],
      kindCode: IDEA_KINDS[index % IDEA_KINDS.length].code,
      createdAt: at(30 * DAY),
      updatedAt: at((index + 1) * DAY),
    }),
    { clusterIds: index === 0 ? ['cluster-1'] : [] },
  ))
}

export const IDEA_CLUSTERS = Object.freeze([
  { id: 'cluster-1', title: '响应式回归' },
  { id: 'cluster-2', title: '工作台优化' },
])
