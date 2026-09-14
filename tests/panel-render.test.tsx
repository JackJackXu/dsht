// 面板渲染测试
//
// 为什么要单独测：非 TTY（管道）下 Ink 只输出最后一帧，
// 端到端跑的时候根本看不见面板画面对不对。
// 这里用 renderToString 直接把面板渲染成字符串来检查。
import React from 'react'
import { renderToString } from 'ink'
import { PanelBox } from '../src/ui/PanelBox.tsx'
import { buildApprovalPanel, buildQuestionPanel } from '../src/ui/panels.ts'
import { initialFlow } from '../src/ui/question-flow.ts'
import type { QuestionItem } from '../src/interactions.ts'
import { PANEL_CURSOR_MARK } from '../src/ui/panels.ts'

let pass = 0, fail = 0
function ok(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log('  ✓', name) }
  else { fail++; console.log('  ✗', name, extra ?? '') }
}

const WIDTH = 60

console.log('=== 审批面板真的能渲染 ===')
{
  const rows = buildApprovalPanel(
    { toolName: 'write', callId: 'call_abc', reason: '需要写入工作区文件' },
    0, WIDTH,
  )
  const out = await renderToString(<PanelBox rows={rows} maxRows={9999} width={WIDTH} />, { columns: WIDTH })
  const lines = out.split('\n')

  ok('渲染出方框上边框', lines[0]!.startsWith('╭'))
  ok('渲染出方框下边框', lines[lines.length - 1]!.startsWith('╰'))
  ok('显示工具名', out.includes('工具  write'))
  ok('显示原因', out.includes('需要写入工作区文件'))
  ok('显示两个选项', out.includes('允许一次') && out.includes('拒绝'))
  ok('高亮项有光标标记', out.includes(`${PANEL_CURSOR_MARK} 允许一次`))
  // 高度契约：面板行数 + 2 条边框 = 渲染行数
  ok(`高度契约（${rows.length} 行内容 + 2 边框 = ${lines.length} 行）`, lines.length === rows.length + 2,
     `实际 ${lines.length}，期望 ${rows.length + 2}`)
}

console.log('=== 提问面板真的能渲染 ===')
{
  const q: QuestionItem = {
    id: 'q1', question: '你想怎么做？',
    options: [{ label: '方案 A', description: '比较快' }, { label: '方案 B' }],
  }
  const rows = buildQuestionPanel(q, initialFlow([q]), { index: 0, total: 1 }, WIDTH)
  const out = await renderToString(<PanelBox rows={rows} maxRows={9999} width={WIDTH} />, { columns: WIDTH })
  const lines = out.split('\n')
  ok('显示问题', out.includes('你想怎么做？'))
  ok('显示选项描述', out.includes('比较快'))
  ok('显示自己输入', out.includes('自己输入…'))
  ok(`高度契约（${rows.length} + 2 = ${lines.length}）`, lines.length === rows.length + 2)
}

console.log('=== 计划评审面板真的能渲染 ===')
{
  const q: QuestionItem = {
    id: 'p1',
    question: '批准这个计划吗？',
    detail: '# 计划\n1. 第一步\n2. 第二步',
    options: [{ label: '继续规划' }, { label: '批准并执行' }],
    intent: { kind: 'plan-review', approve: '批准并执行' },
  }
  const rows = buildQuestionPanel(q, initialFlow([q]), { index: 0, total: 1 }, WIDTH)
  const out = await renderToString(<PanelBox rows={rows} maxRows={9999} width={WIDTH} />, { columns: WIDTH })
  ok('标题是计划评审', out.includes('计划评审'))
  ok('批准项有标记', out.includes('← 批准'))
  ok('提示全文在上方', out.includes('计划全文见上方'))
  ok('默认高亮在批准项', out.includes(`${PANEL_CURSOR_MARK} 批准并执行`))
}

console.log('=== 窄终端不会撑破 ===')
{
  const q: QuestionItem[] = [{
    id: 'q1', question: '这是一个很长很长的问题'.repeat(4),
    options: [{ label: '选项甲'.repeat(10) }],
  }]
  const rows = buildQuestionPanel(q[0]!, initialFlow(q), { index: 0, total: 1 }, 24)
  const out = await renderToString(<PanelBox rows={rows} maxRows={9999} width={WIDTH} />, { columns: 24 })
  const tooWide = out.split('\n').filter(l => [...l].length > 24)
  ok('每行都不超过终端宽度', tooWide.length === 0,
     tooWide.length > 0 ? `最宽的一行：${JSON.stringify(tooWide[0])}` : '')
}


console.log('=== 自己输入：长文本要折行，光标要跟着走（不能截断）===')
{
  const q: QuestionItem = { id: 'q1', question: '随便说点什么' }
  const editing = { ...initialFlow([q]), editing: true, cursor: 0 }

  // 长 ASCII：应折成多行，且只有一行被标记为光标行
  const rows = buildQuestionPanel(q, { ...editing, custom: 'a'.repeat(200) }, { index: 0, total: 1 }, 60)
  const marked = rows.filter(r => r.customInput === true)
  ok('长文本折成了多行（不是被截断）', rows.filter(r => r.text.includes('a')).length > 1)
  ok('只有一行被标记为光标行', marked.length === 1, `实际 ${marked.length} 行`)
  ok('光标行没有省略号（说明不是 clip 截断）', !(marked[0]?.text ?? '').includes('…'))
  ok('光标列偏移在合理范围内',
     (marked[0]?.customCursorX ?? -1) >= 4 && (marked[0]?.customCursorX ?? 999) <= 60,
     `实际 ${marked[0]?.customCursorX}`)

  // 中文：偏移必须按 2 列算
  const rows2 = buildQuestionPanel(q, { ...editing, custom: '中文'.repeat(40) }, { index: 0, total: 1 }, 60)
  const m2 = rows2.filter(r => r.customInput === true)
  ok('中文也折行', rows2.filter(r => r.text.includes('中文')).length > 1)
  ok('中文光标行已标记', m2.length === 1)
  ok('中文偏移按双列算', ((m2[0]?.customCursorX ?? 0) - 4) % 2 === 0, `偏移 ${m2[0]?.customCursorX}`)

  // 纯 ASCII：偏移应等于 4 + 光标前字符数
  const rows3 = buildQuestionPanel(q, { ...editing, custom: 'a'.repeat(100) }, { index: 0, total: 1 }, 60)
  const m3 = rows3.filter(r => r.customInput === true)
  ok('光标在末尾时落在最后一行', (m3[0]?.text ?? '').endsWith('a'), JSON.stringify(m3[0]?.text?.slice(-8)))
}


console.log(`\n通过 ${pass} / ${pass + fail}`)
// 注意：这里不能 process.exit()。用了 renderToString 之后立刻强退会触发
// libuv 断言（Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)）。
// 设 exitCode 让进程自然结束即可。
process.exitCode = fail === 0 ? 0 : 1
