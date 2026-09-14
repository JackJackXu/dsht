// 配色预览 —— 直接调用**真实**的 layout 函数渲染，所以永远跟实际界面一致
//
// 跑法：npm run palette:preview
// 浅色：DSHT_THEME=light npm run palette:preview
import { activePalette, DARK_PALETTE, LIGHT_PALETTE, type Palette } from '../src/ui/theme.ts'
import { layoutLines, type Row, type Tone } from '../src/ui/layout.ts'
import React from 'react'
import { renderToString } from 'ink'
import { PanelBox } from '../src/ui/PanelBox.tsx'
import { buildQuestionPanel, buildApprovalPanel } from '../src/ui/panels.ts'
import { initialFlow } from '../src/ui/question-flow.ts'
import type { QuestionItem } from '../src/interactions.ts'
import type { Line } from '../src/ui/transcript.ts'

const ESC = '\u001b['
const R = '\u001b[0m'
const CODES: Record<string, number> = {
  black: 30, red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36, white: 37,
  blackBright: 90, gray: 90, grey: 90,
}
const paint = (name: string | undefined, s: string, bold = false): string =>
  name === undefined ? s : `${ESC}${bold ? '1;' : ''}${CODES[name] ?? 39}m${s}${R}`

const P = activePalette()
const which = P === DARK_PALETTE ? '深色底（默认）' : P === LIGHT_PALETTE ? '浅色底' : '自定义'
const TONE_COLOR: Record<Tone, string | undefined> = {
  user: P.user, agent: P.agent, tool: P.tool, thinking: P.thinking, command: P.command,
  notice: P.dim, error: P.error, dim: P.dim,
}

console.log('')
console.log(paint(P.dim, `━━━ 配色：${which} ━━━`))
console.log('')
console.log(paint(P.dim, '  令牌          颜色      用在哪'))
const table: Array<[keyof Palette, string]> = [
  ['user', '你说的话（整条）'],
  ['agent', '智能体说的话（整条）'],
  ['tool', '「● 工具」标签'],
  ['thinking', '「∗ 思考」标签'],
  ['error', '错误'],
  ['dim', '正文细节 / 提示（退灰）'],
  ['border', '普通边框'],
  ['attention', '审批/提问面板 · 等你回应 · 选中项'],
]
for (const [token, desc] of table) {
  console.log(`  ${token.padEnd(13)} ${paint(P[token], '  ●  ')}   ${paint(P.dim, desc)}`)
}

/** 把真实的 Row 数组画出来 */
function render(rows: readonly Row[], width: number): void {
  for (const row of rows) {
    if (row.kind === 'gap') { console.log(''); continue }
    const prefix = row.prefix === undefined ? '' : paint(TONE_COLOR[row.prefixTone ?? 'dim'], row.prefix)
    const body = row.text === '' ? '' : paint(TONE_COLOR[row.bodyTone ?? 'dim'], row.text)
    process.stdout.write(prefix + body + '\n')
  }
}

const lines: Line[] = [
  { kind: 'user', text: '帮我看看这个报告，顺便把结论提出来' },
  { kind: 'assistant', text: '好的，我先读一下。' },
  { kind: 'tool', name: 'read', detail: '{"file_path":"C:\\reports\\2026-q3.md"}' },
  {
    kind: 'tool', name: 'bash',
    detail: '{"command":"rg -n \'^#{1,3} \' reports/2026-q3.md | head -20","timeout":30000}',
  },
  { kind: 'reasoning', text: '用户要结论。先看目录结构，再挑重点章节读，最后用三点总结。' },
  { kind: 'assistant', text: '报告主要讲了三点：\n\n1. 营收同比增长 12%\n2. 成本上升主要来自人力\n3. 下季度重点是海外市场' },
  { kind: 'meta', text: '/plan', tone: 'notice' },
  { kind: 'error', text: '读取失败：permission denied' },
]

console.log('')
console.log(paint(P.dim, '━━━ 折叠思考时 ━━━'))
console.log('')
render(layoutLines(lines, { width: 76, showReasoning: false }), 76)

console.log('')
console.log(paint(P.dim, '━━━ 展开思考时（Ctrl+O）━━━'))
console.log('')
render(layoutLines(lines, { width: 76, showReasoning: true }), 76)

console.log('')
console.log(paint(P.dim, '━━━ 输入框 + 状态行 ━━━'))
console.log('')
console.log(paint(P.border, '╭' + '─'.repeat(74) + '╮'))
console.log(`${paint(P.border, '│')} ${paint(P.user, '> ')}看完了，那第三点具体怎么做？`)
console.log(paint(P.border, '╰' + '─'.repeat(74) + '╯'))
console.log(`${paint(P.dim, '  Enter 发送 · Ctrl+Enter 换行 · PgUp/PgDn 翻页')}   ${paint(P.tool, '● 工作中')}`)

console.log('')
console.log(paint(P.dim, '━━━ 面板（审批 / 提问）—— 用 attention 黄跳出来 ━━━'))
console.log('')
{
  const q: QuestionItem = {
    id: 'q1',
    question: '这次要规划哪一件事？',
    options: [
      { label: '审批面板（推荐）', description: '阶段 2 的剩余阻塞项' },
      { label: 'Esc 游戏式菜单', description: '项目的招牌功能' },
    ],
  }
  const rows = buildQuestionPanel(q, initialFlow([q]), { index: 0, total: 1 }, 76)
  // 渲染**真实组件** —— 手工画过一次，漏了右边框
  process.stdout.write(await renderToString(React.createElement(PanelBox, { rows, maxRows: 9999, width: 76 }), { columns: 76 }) + '\n')
}
console.log('')
{
  const rows = buildApprovalPanel({ toolName: 'write', callId: 'call_abc', reason: '需要写入工作区文件' }, 0, 76)
  process.stdout.write(await renderToString(React.createElement(PanelBox, { rows, maxRows: 9999, width: 76 }), { columns: 76 }) + '\n')
}
console.log('')
console.log(paint(P.dim, '  说明：颜色只标识「这是什么」—— 工具/思考只有标签上色，内容退灰。'))
console.log(paint(P.dim, '        面板用 attention 黄色跳出来，表示"需要你动手"。'))
console.log('')
