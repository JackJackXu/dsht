// 提问流程 + 面板内容的单测
//
// 重点：答案编码必须完全符合官方协议
//   { answers: [{ id, selected: string[], custom?: string }] }
// 错一个字模型就理解错了。
import {
  initialFlow, reduceFlow, choiceCount, customIndex, type QuestionFlowState,
} from '../src/ui/question-flow.ts'
import { buildApprovalPanel, buildQuestionPanel } from '../src/ui/panels.ts'
import type { QuestionItem } from '../src/interactions.ts'

let pass = 0, fail = 0
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; console.log('  ✓', name) }
  else { fail++; console.log('  ✗', name, '\n      得到', g, '\n      期望', w) }
}
/** 连续跑一串动作 */
function run(qs: readonly QuestionItem[], actions: Parameters<typeof reduceFlow>[1][]) {
  let state = initialFlow(qs)
  let done: unknown
  for (const a of actions) {
    const r = reduceFlow(state, a, qs)
    state = r.state
    if (r.done !== undefined) done = r.done
  }
  return { state, done }
}

const single: QuestionItem[] = [{
  id: 'q1',
  question: '选哪个？',
  options: [{ label: '方案 A' }, { label: '方案 B' }],
}]

const multi: QuestionItem[] = [{
  id: 'q1',
  question: '选哪些？',
  multiSelect: true,
  options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }],
}]

console.log('=== 单选 ===')
eq('选项数 = 2 个选项 + 自己输入', choiceCount(single[0]!), 3)
eq('自己输入是最后一项', customIndex(single[0]!), 2)
eq('初始光标在第一项', initialFlow(single).cursor, 0)
eq('默认直接回车 → 选第一项', run(single, [{ type: 'confirm' }]).done,
   [{ id: 'q1', selected: ['方案 A'] }])
eq('下移一格再回车 → 选第二项', run(single, [{ type: 'down' }, { type: 'confirm' }]).done,
   [{ id: 'q1', selected: ['方案 B'] }])

console.log('=== 导航 ===')
eq('上移到顶会绕到末项', run(single, [{ type: 'up' }]).state.cursor, 3 - 1)
eq('下移到底会绕回第一项', run(single, [{ type: 'down' }, { type: 'down' }, { type: 'down' }]).state.cursor, 0)

console.log('=== 多选 ===')
eq('空格勾选', run(multi, [{ type: 'toggle' }]).state.selected, ['A'])
eq('再按一次取消', run(multi, [{ type: 'toggle' }, { type: 'toggle' }]).state.selected, [])
eq('勾两个', run(multi, [{ type: 'toggle' }, { type: 'down' }, { type: 'toggle' }]).state.selected, ['A', 'B'])
eq('多选提交', run(multi, [{ type: 'toggle' }, { type: 'down' }, { type: 'toggle' }, { type: 'confirm' }]).done,
   [{ id: 'q1', selected: ['A', 'B'] }])
eq('多选一个都不勾也能提交', run(multi, [{ type: 'confirm' }]).done, [{ id: 'q1', selected: [] }])
eq('单选时空格不该改 selected', run(single, [{ type: 'toggle' }]).state.selected, [])

console.log('=== 自己输入 ===')
eq('选中「自己输入」进入编辑态（还不提交）',
   run(single, [{ type: 'down' }, { type: 'down' }, { type: 'confirm' }]).state.editing, true)
eq('编辑态打字 + 回车 → custom',
   run(single, [{ type: 'down' }, { type: 'down' }, { type: 'confirm' },
     { type: 'insert', text: '自' }, { type: 'insert', text: '己' }, { type: 'confirm' }]).done,
   [{ id: 'q1', selected: [], custom: '自己' }])
eq('编辑态退格',
   run(single, [{ type: 'down' }, { type: 'down' }, { type: 'confirm' },
     { type: 'insert', text: 'ab' }, { type: 'backspace' }]).state.custom, 'a')
eq('Esc 退出编辑态',
   run(single, [{ type: 'down' }, { type: 'down' }, { type: 'confirm' }, { type: 'cancelEdit' }]).state.editing, false)
eq('多选 + 自己输入 → selected 和 custom 一起带',
   run(multi, [{ type: 'toggle' }, { type: 'down' }, { type: 'down' }, { type: 'down' }, { type: 'confirm' },
     { type: 'insert', text: '补充' }, { type: 'confirm' }]).done,
   [{ id: 'q1', selected: ['A'], custom: '补充' }])
eq('编辑态没打字就回车 → 不带 custom 字段',
   run(single, [{ type: 'down' }, { type: 'down' }, { type: 'confirm' }, { type: 'confirm' }]).done,
   [{ id: 'q1', selected: [] }])

console.log('=== 多题 ===')
const two: QuestionItem[] = [
  { id: 'q1', question: '第一题', options: [{ label: 'A' }] },
  { id: 'q2', question: '第二题', options: [{ label: 'B' }] },
]
eq('答完第一题进第二题', run(two, [{ type: 'confirm' }]).state.index, 1)
eq('第一题未答完时不该 done', run(two, [{ type: 'confirm' }]).done, undefined)
eq('两题都答完', run(two, [{ type: 'confirm' }, { type: 'confirm' }]).done,
   [{ id: 'q1', selected: ['A'] }, { id: 'q2', selected: ['B'] }])
eq('第二题的光标重置', run(two, [{ type: 'confirm' }]).state.cursor, 0)

console.log('=== 计划评审：默认停在「批准」上 ===')
const plan: QuestionItem[] = [{
  id: 'p1',
  question: '批准这个计划吗？',
  detail: '# 计划\n1. 先做 A\n2. 再做 B',
  options: [{ label: '继续规划' }, { label: '批准并执行' }, { label: '先讨论' }],
  intent: { kind: 'plan-review', approve: '批准并执行' },
}]
eq('初始光标指向批准项', initialFlow(plan).cursor, 1)
eq('直接回车就是批准', run(plan, [{ type: 'confirm' }]).done,
   [{ id: 'p1', selected: ['批准并执行'] }])

console.log('=== 没有选项的纯开放题 ===')
const open: QuestionItem[] = [{ id: 'o1', question: '你怎么想？' }]
eq('只有「自己输入」一项', choiceCount(open[0]!), 1)
eq('直接回车进入编辑', run(open, [{ type: 'confirm' }]).state.editing, true)
eq('输入后提交', run(open, [{ type: 'confirm' }, { type: 'insert', text: '好的' }, { type: 'confirm' }]).done,
   [{ id: 'o1', selected: [], custom: '好的' }])

console.log('=== 审批面板内容 ===')
{
  const rows = buildApprovalPanel(
    { toolName: 'write', callId: 'call_123', reason: '需要写入工作区' },
    0, 60,
  )
  const text = rows.map(r => r.text).join('\n')
  eq('显示工具名', text.includes('工具  write'), true)
  eq('显示调用 id', text.includes('call_123'), true)
  eq('显示原因', text.includes('需要写入工作区'), true)
  eq('两个选项', rows.filter(r => r.tone === 'option' || r.tone === 'optionActive').length, 2)
  eq('第一项是允许一次', rows.find(r => r.tone === 'optionActive')?.text.includes('允许一次'), true)
  eq('光标下标 1 时高亮拒绝', buildApprovalPanel({ toolName: 'x' }, 1, 60)
    .find(r => r.tone === 'optionActive')?.text.includes('拒绝'), true)
}

console.log('=== 提问面板内容 ===')
{
  const flow = initialFlow(plan)
  const rows = buildQuestionPanel(plan[0]!, flow, { index: 0, total: 1 }, 60)
  const text = rows.map(r => r.text).join('\n')
  eq('标题是计划评审', text.includes('计划评审'), true)
  eq('显示问题', text.includes('批准这个计划吗？'), true)
  eq('提示全文在上方', text.includes('计划全文见上方'), true)
  eq('批准项有标记', text.includes('← 批准'), true)
  eq('有自己输入项', text.includes('自己输入…'), true)
}
{
  const flow = { ...initialFlow(multi), selected: ['A'] }
  const rows = buildQuestionPanel(multi[0]!, flow, { index: 0, total: 1 }, 60)
  const text = rows.map(r => r.text).join('\n')
  eq('多选显示勾选框', text.includes('[x] A') && text.includes('[ ] B'), true)
  eq('多选提示里写的是「空格」（不是英文 Space）', text.includes('空格 勾选'), true)
}


console.log('=== 直接打字 = 开始自己输入（不用先按 Enter）===')
eq('打字后进入编辑态', run(single, [{ type: 'type', text: '好' }]).state.editing, true)
eq('打进去的第一个字在', run(single, [{ type: 'type', text: '好' }]).state.custom, '好')
eq('继续打字是追加', run(single, [{ type: 'type', text: '好' }, { type: 'type', text: '的' }]).state.custom, '好的')
eq('打字后回车直接提交',
   run(single, [{ type: 'type', text: '好' }, { type: 'confirm' }]).done,
   [{ id: 'q1', selected: [], custom: '好' }])
eq('打字时光标停在哪都不影响',
   run(single, [{ type: 'down' }, { type: 'down' }, { type: 'type', text: 'x' }, { type: 'confirm' }]).done,
   [{ id: 'q1', selected: [], custom: 'x' }])
eq('多选：先勾选再打字，两者都带上',
   run(multi, [{ type: 'toggle' }, { type: 'type', text: '补充' }, { type: 'confirm' }]).done,
   [{ id: 'q1', selected: ['A'], custom: '补充' }])
eq('多选：空格是勾选（不会变成打字）',
   run(multi, [{ type: 'toggle' }]).state.custom, '')
eq('单选：空格就是普通字符',
   run(single, [{ type: 'type', text: ' ' }]).state.custom, ' ')


console.log(`\n通过 ${pass} / ${pass + fail}`)
process.exit(fail === 0 ? 0 : 1)
