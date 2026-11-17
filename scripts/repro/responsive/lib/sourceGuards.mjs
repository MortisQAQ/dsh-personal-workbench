/**
 * 源码级护栏：**手写外壳不许悄悄过时**。
 *
 * ## 为什么必须有这一层（真实风险）
 *
 * 组件层的外壳是照 `src/client/app/*.tsx` 手抄的（那些 `.tsx` 不产出可 import 的 `lib/` 模块）。
 * 手抄的东西一定会漂移：某天有人把 `.wb-split` 换成 `.wb-split2`，harness 仍然会兴高采烈地
 * 量一个**产品里已经不存在**的 DOM，然后报全绿 —— 那是比没有 harness 更坏的形态
 *（项目规范里"测试脚手架也会骗人"说的就是这个）。
 *
 * 所以：读源码，核对外壳假设的每个类名/属性/结构是否仍然存在；不存在就**当场失败**，
 * 让人回来同步 `lib/page.mjs` 与这里。
 *
 * ## 这些检查的边界（别当成布局证据）
 *
 * 它们只证明"源码里还有这些名字"，**不**证明布局正确 —— 布局由渲染后的测量负责。
 * 反过来，这里红了但渲染层全绿，说明外壳已经和产品脱节，渲染层的绿是废的。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function readOrNull(repoRoot, relative) {
  try {
    return readFileSync(join(repoRoot, relative), 'utf8')
  } catch {
    return null
  }
}

/**
 * @param {{classes: string[], attributes: string[], sources: string[]}} contract 来自 `page.mjs` 的 SHELL_CONTRACT
 * @param {string} repoRoot
 * @returns {Array<{id: string, ok: boolean, severity: string, scope: string, detail: string}>}
 */
export function runSourceGuards(contract, repoRoot) {
  const checks = []
  const files = contract.sources.map((relative) => ({ relative, text: readOrNull(repoRoot, relative) }))
  const missingFiles = files.filter((file) => file.text === null).map((file) => file.relative)
  checks.push({
    id: 'source:files-present',
    ok: missingFiles.length === 0,
    severity: 'blocking',
    scope: 'setup',
    detail: missingFiles.length === 0 ? '外壳权威源都在：' + contract.sources.join(' / ') : '缺少源码文件：' + missingFiles.join(' / '),
  })

  const haystack = files.filter((file) => file.text !== null).map((file) => file.text).join('\n')
  const missingClasses = contract.classes.filter((name) => haystack.includes(name) === false)
  checks.push({
    id: 'source:shell-classes',
    ok: missingClasses.length === 0,
    severity: 'blocking',
    scope: 'setup',
    detail: missingClasses.length === 0
      ? '外壳假设的 ' + contract.classes.length + ' 个类名都还在源码里'
      : '外壳假设的类名在源码里找不到了（外壳已漂移，先同步 lib/page.mjs 的 SHELL_CONTRACT）：' + missingClasses.join(', '),
  })

  const missingAttributes = contract.attributes.filter((name) => haystack.includes(name) === false)
  checks.push({
    id: 'source:shell-attributes',
    ok: missingAttributes.length === 0,
    severity: 'blocking',
    scope: 'setup',
    detail: missingAttributes.length === 0
      ? '外壳假设的 ' + contract.attributes.length + ' 个属性都还在源码里'
      : '外壳假设的属性在源码里找不到了：' + missingAttributes.join(', '),
  })

  /**
   * 两栏布局的**结构前提**：`.wb-split` 必须是 flex 容器，否则 `.wb-nav` / `.wb-detail`
   * 会变成两个块级元素上下堆叠（`.wb-detail { flex:1 }` 在没有 flex 父级时毫无作用）。
   *
   * 2026-11-17 实测：工作区里 `src/client/app/WorkbenchSplit.tsx` 是**未提交的新文件**，
   * 而 `styles.ts` 里**没有任何 `.wb-split` 规则** —— 于是"两栏"实际上是一栏。
   * 这条检查就是那件事的可失败形态（修好后自然变绿，不许把它删掉）。
   */
  const stylesText = files.find((file) => file.relative === 'src/client/styles.ts')
  const styleSource = stylesText === undefined || stylesText.text === null ? '' : stylesText.text
  const splitRules = /(^|[^.\w-])\.wb-split\b/m.test(styleSource)
  checks.push({
    id: 'source:split-layout-rule',
    ok: splitRules,
    severity: 'blocking',
    scope: 'setup',
    detail: splitRules
      ? 'styles.ts 里有 .wb-split 的规则'
      : 'styles.ts 里找不到任何 .wb-split 规则：外壳是 .wb-body > .wb-split > .wb-nav + section.wb-detail，'
        + '而 .wb-split 没被声明为 flex 容器 → .wb-nav / .wb-detail 会上下堆叠，"两栏"不成立（flex:1 / flex:0 0 min(56%,880px) 全部失效）',
  })

  /**
   * "宽视口窄容器"这个场景之所以有意义，是因为产品用 **container query** 判断布局
   *（`.wb-sidebar-surface { container-type: inline-size }` + `@container (max-width:760px)`）。
   * 一旦改回媒体查询，组件层的窄容器场景就不再对应产品的真实判据，必须回来重写。
   */
  const hasContainerType = styleSource.includes('container-type')
  const hasContainerQuery = styleSource.includes('@container')
  checks.push({
    id: 'source:container-query',
    ok: hasContainerType && hasContainerQuery,
    severity: 'blocking',
    scope: 'setup',
    detail: hasContainerType && hasContainerQuery
      ? '存在 container-type 与 @container（窄容器场景走容器查询，与产品判据一致）'
      : '找不到 container-type / @container（' + String(hasContainerType) + ' / ' + String(hasContainerQuery) + '）：'
        + '布局若改成媒体查询，"宽视口窄容器"场景的判据需要重写，不能直接沿用',
  })

  return checks
}
