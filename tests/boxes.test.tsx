// 两个盒子（输入框 / 面板）的高度契约
//
// 这是整个「不花屏」链条上最容易断的一环：
//   App 按公式算「下半区占几行」→ 盒子实际画几行。
//   两者一旦不等，Ink 就挤压（cursor.ts 坑 2），而且**总行数看起来还是对的**。
//
// 所以这里直接验：公式算出来的数 == 真实渲染出来的行数。
// 用真实的 ComposerBox / PanelBox，不是复制一份手写的渲染逻辑。
import React from 'react'
import { renderToString } from 'ink'
import { ComposerBox, composerHeight } from '../src/ui/ComposerBox.tsx'
import { composerContentWidth } from '../src/ui/cursor.ts'
import { PanelBox, panelLayout } from '../src/ui/PanelBox.tsx'
import { layoutInput } from '../src/ui/input.ts'
import { buildQuestionPanel, buildApprovalPanel } from '../src/ui/panels.ts'
import { initialFlow } from '../src/ui/question-flow.ts'
import { displayWidth } from '../src/ui/width.ts'
import type { QuestionItem } from '../src/interactions.ts'

let pass = 0, fail = 0
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name) }
  else { fail++; console.log('  ✗', name, detail !== undefined ? `\n      ${detail}` : '') }
}
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; console.log('  ✓', name) }
  else { fail++; console.log('  ✗', name, `\n      得到 ${g}\n      期望 ${w}`) }
}

/** 测试里给一个很大的上限：这些用例测的是面板本身，不希望被窗口化 */
const BIG = 9999

const lines = (out: string): number =>
  (out.endsWith('\n') ? out.slice(0, -1) : out).split('\n').length

console.log('=== 输入框：公式 == 真实渲染行数 ===')
for (const [text, cursor, width, maxLines] of [
  ['', 0, 40, 6],
  ['短', 1, 40, 6],
  ['中文测试'.repeat(30), 120, 40, 6],
  ['a\nb\nc\nd\ne\nf\ng\nh\ni\nj', 20, 40, 6],   // 超过 6 行 → 触发「上面还有 N 行」
  ['一行', 2, 10, 3],
] as Array<[string, number, number, number]>) {
  // 正文宽度必须由 ComposerBox 给 —— 这里传的 width 是「终端列数」，
  // 不是正文宽度（差一个边框+内边距+标记）。早先这里传错，测试立刻抓到了。
  const view = layoutInput(text, cursor, composerContentWidth(width), maxLines)
  const want = composerHeight(view)
  const got = lines(renderToString(<ComposerBox view={view} running={false} />, { columns: width }))
  eq(`草稿 ${JSON.stringify(text.slice(0, 8))}…（hiddenAbove=${view.hiddenAbove}）`,
     got, want)
}

console.log('=== 输入框：提示行出现时公式也要对 ===')
{
  const many = Array.from({ length: 12 }, (_, i) => `第${i + 1}行`).join('\n')
  const view = layoutInput(many, many.length, composerContentWidth(40), 6)
  ok('确实触发了「上面还有 N 行」', view.hiddenAbove > 0, `hiddenAbove=${view.hiddenAbove}`)
  const out = renderToString(<ComposerBox view={view} running={false} />, { columns: 40 })
  ok('提示文字确实画出来了', out.includes('上方还有'), out)
  eq('公式 == 渲染行数', lines(out), composerHeight(view))
}

console.log('=== 面板：公式 == 真实渲染行数 ===')
{
  const approval = { kind: 'approval' as const, id: 'a1', toolName: 'write', reason: '要写文件', settle: () => {} }
  for (const cursor of [0, 1]) {
    const rows = buildApprovalPanel(approval as never, cursor, 80)
    eq(`审批面板（光标 ${cursor}）`, lines(renderToString(<PanelBox rows={rows} maxRows={BIG} width={80} />, { columns: 80 })),
       panelLayout(rows, BIG, 80).height)
  }
}
{
  const q: QuestionItem = {
    id: 'q1', question: '选哪个？',
    options: Array.from({ length: 8 }, (_, i) => ({ label: `选项${i}`, description: `说明 ${i}` })),
  }
  for (const width of [80, 40]) {
    const rows = buildQuestionPanel(q, initialFlow([q]), { index: 0, total: 1 }, width)
    eq(`提问面板（宽 ${width}）`,
       lines(renderToString(<PanelBox rows={rows} maxRows={BIG} width={80} />, { columns: width })),
       panelLayout(rows, BIG, 80).height)
  }
}
{
  // 很长的自定义输入 → 触发面板自己的「上面还有 N 行」
  const q: QuestionItem = { id: 'q1', question: '选哪个？', options: [{ label: 'A' }] }
  const flow = { ...initialFlow([q]), cursor: 1, editing: true, custom: '很长的自定义回答'.repeat(20) }
  const rows = buildQuestionPanel(q, flow, { index: 0, total: 1 }, 46)
  ok('确实触发了面板的滚动提示', rows.some(r => r.text.includes('上方还有')))
  eq('公式 == 渲染行数',
     lines(renderToString(<PanelBox rows={rows} maxRows={BIG} width={80} />, { columns: 46 })),
     panelLayout(rows, BIG, 80).height)
}

console.log('=== 面板：声明的高度必须等于真实渲染行数（各个宽度都要成立）===')
{
  // 这是整个项目的头号不变量：Ink 的溢出是挤压不是裁剪，
  // 声明 19 行、实渲 20 行就会丢内容，而帧行数看起来还是对的。
  // 评审就是靠这个抓出「提示行没按内宽裁」和「审批原因行没扣前缀」两个 bug 的。
  const longQuestion: QuestionItem = {
    id: 'q1', question: '选一个',
    options: Array.from({ length: 20 }, (_, i) => ({ label: `选项${i}`, description: `这是第 ${i} 项的说明文字` })),
  }
  for (const width of [24, 30, 40, 52, 80]) {
    for (const maxRows of [5, 9, 20, 9999]) {
      const rows = buildQuestionPanel(longQuestion, initialFlow([longQuestion]), { index: 0, total: 1 }, width)
      const declared = panelLayout(rows, maxRows, width).height
      const real = lines(renderToString(
        <PanelBox rows={rows} maxRows={maxRows} width={width} />, { columns: width }))
      eq(`宽 ${width} / 上限 ${maxRows}：声明 ${declared} 行 == 实际 ${real} 行`, real, declared)
    }
  }

  // 审批面板的「原因」行：长原因也要对得上（评审报的第二个 bug）
  for (const width of [30, 40, 80]) {
    const approval = {
      kind: 'approval' as const, id: 'a1', toolName: 'write',
      reason: '需要写入工作区文件，因为这次的任务要求把结论保存到 reports 目录下。'.repeat(4),
      settle: () => {},
    }
    const rows = buildApprovalPanel(approval as never, 0, width)
    const declared = panelLayout(rows, 9999, width).height
    const real = lines(renderToString(
      <PanelBox rows={rows} maxRows={9999} width={width} />, { columns: width }))
    eq(`审批长原因 / 宽 ${width}：声明 ${declared} 行 == 实际 ${real} 行`, real, declared)
  }
}

console.log('=== 面板的滚动提示必须在自己输入那几行之前，不能跑到标题上面 ===')
{
  const q: QuestionItem = { id: 'q1', question: '选哪个？', options: [{ label: 'A' }] }
  const flow = { ...initialFlow([q]), cursor: 1, editing: true, custom: '很长的自定义回答'.repeat(20) }
  const rows = buildQuestionPanel(q, flow, { index: 0, total: 1 }, 46)
  const hintAt = rows.findIndex(r => r.text.includes('上方还有'))
  const titleAt = rows.findIndex(r => r.tone === 'title')
  const customAt = rows.findIndex(r => r.customInput === true)
  ok('提示在标题之后', hintAt > titleAt, `提示在第 ${hintAt} 行、标题在第 ${titleAt} 行`)
  ok('提示在自己输入之前', customAt === -1 || hintAt < customAt, `提示 ${hintAt}、自己输入 ${customAt}`)
}

console.log('')
console.log(`通过 ${pass} / ${pass + fail}`)
if (fail > 0) process.exitCode = 1
