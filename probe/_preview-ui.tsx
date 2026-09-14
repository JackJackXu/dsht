// 界面预览：把各种形态一次渲染出来
//
// 用法：
//   npm run preview:ui                    全部（带颜色）
//   npm run preview:ui -- --no-color      去掉颜色，看「无色还读得出来吗」
//   npm run preview:ui -- --compare       同一段对话：先带颜色、再去掉颜色，直接对比
//
// 全部调用**真实**的组件和函数（PanelBox / buildQuestionPanel /
// buildCommandPalette / App / layoutLines），不是手画的示意图 ——
// 所以它显示什么，实际运行就是什么。
import React from 'react'
import { Box, renderToString } from 'ink'
import { PanelBox } from '../src/ui/PanelBox.tsx'
import { buildArgPanel, buildCommandPalette, buildQuestionPanel } from '../src/ui/panels.ts'
import { argumentsOf, filterCommands, type SlashCommand } from '../src/ui/commands.ts'
import { initialFlow } from '../src/ui/question-flow.ts'
import { layoutLines, type Row } from '../src/ui/layout.ts'
import { App, RowView } from '../src/ui/App.tsx'
import type { Line } from '../src/ui/transcript.ts'
import type { PendingInteraction, QuestionItem } from '../src/interactions.ts'

const NL = String.fromCharCode(10)
const args = process.argv.slice(2)
const NO_COLOR = args.includes('--no-color')
const COMPARE = args.includes('--compare')

/** 去掉 ANSI 颜色码（`--no-color` 用） */
// eslint-disable-next-line no-control-regex
const stripAnsi = (t: string) => t.replace(new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g'), '')

/** 所有输出先攒起来，最后统一决定要不要带颜色 */
const buf: string[] = []
const say = (line = ''): void => { buf.push(line) }
const section = (title: string): void => { say(''); say('━━━ ' + title + ' ━━━') }

// 投影的值用**真实会话 dump 出来的那组数字** —— 这样预览里的状态行
// 跟实际跑起来看到的一模一样，不是编的
const PROJECTIONS: Record<string, unknown> = {
  sessionStats: { turns: 173, steps: 2260, llmMs: 12897045, toolMs: 16998239, ttftMs: 4193952, ttftSteps: 2256, decodeMs: 8688296, decodeTokens: 1805945 },
  tokenUsage: { uncachedInputTokens: 3855503, outputTokens: 1805945, cacheReadTokens: 825595136, cacheWriteTokens: 0 },
  costUsage: { cost: 6.343968513888899 },
  contextPressure: { pressureTokens: 651064, projectedTokens: 651215, contextWindow: 1000000 },
  permissions: {
    options: [
      { value: 'read-only', name: 'read-only' },
      { value: 'workspace-write', name: 'workspace-write' },
      { value: 'danger-full-access', name: 'danger-full-access' },
    ],
    currentValue: 'read-only',
  },
}


// ── 一、提问面板的几种状态 ────────────────────────────────────
const QUESTION: QuestionItem = {
  id: 'q1',
  question: '这次要规划哪一件事？',
  options: [
    { label: 'Keep planning', description: 'Stay in plan mode; feedback goes back to the model.' },
    { label: 'Approve', description: '开始执行' },
  ],
}

function showPanel(label: string, flow: any): void {
  const rows = buildQuestionPanel(QUESTION, flow, { index: 0, total: 1 }, 62)
  say('')
  say('· ' + label)
  for (const l of renderToString(<PanelBox rows={rows} maxRows={9999} width={62} />, { columns: 62 }).split(NL)) say('  ' + l)
}

section('提问面板')
showPanel('光标在选项上', { ...initialFlow([QUESTION]), cursor: 0 })
showPanel('光标停在「自己输入」上（没有多余缩进）', { ...initialFlow([QUESTION]), cursor: 2 })
showPanel('正在输入（一个字都没打 → 占位提示）', { ...initialFlow([QUESTION]), cursor: 2, editing: true, custom: '' })
showPanel('正在输入（正文直接写在同一行）', { ...initialFlow([QUESTION]), cursor: 2, editing: true, custom: '我想先看看第三季度的数据' })

// ── 二、命令面板 ──────────────────────────────────────────────
const COMMANDS: SlashCommand[] = [
  { name: 'compact', description: 'Compact older conversation history' },
  { name: 'export', description: 'Download this Session log as a ZIP archive' },
  { name: 'feedback', description: 'record feedback about this session', input: { hint: '<text>' } },
  { name: 'goal', description: 'set or view the goal for a long-running task', input: { hint: '[<objective>|clear|edit <objective>|pause|resume]' } },
  { name: 'permission', description: 'Switch the permission preset (sandbox mode + approval policy)', input: { hint: '<preset>' } },
  { name: 'plan', description: 'Enter or leave plan mode', input: { hint: '[off|message]', attachments: true } },
]

function showPalette(label: string, prefix: string, cursor: number): void {
  const matched = filterCommands(COMMANDS, prefix)
  const rows = buildCommandPalette(matched, cursor, 62)
  say('')
  say(`· ${label}（输入框里是 /${prefix}，筛出 ${matched.length} 条）`)
  for (const l of renderToString(<PanelBox rows={rows} maxRows={9999} width={62} />, { columns: 62 }).split(NL)) say('  ' + l)
}

section('命令面板（输入框空着时按 /，或打命令名时按 Tab）')
showPalette('刚敲下 /', '', 0)
showPalette('再打一个 p', 'p', 0)
showPalette('打错了', 'zzz', 0)

// ── 二之二、参数子面板（用户要求：不要命令，只要选项）──────────
function showArgPanel(label: string, command: SlashCommand, permissions: any[]): void {
  const args = argumentsOf(command, permissions)
  const rows = buildArgPanel(command, args, 0, 62)
  say('')
  say(`· ${label}（${args.length} 个选项，用户一个字都不用打）`)
  for (const l of renderToString(<PanelBox rows={rows} maxRows={9999} width={62} />, { columns: 62 }).split(NL)) say('  ' + l)
}

section('参数子面板：选完就能跑，不用记参数怎么写')
showArgPanel('选中 /permission', COMMANDS.find(c => c.name === 'permission')!,
  (PROJECTIONS.permissions as any).options)
showArgPanel('选中 /goal', COMMANDS.find(c => c.name === 'goal')!, [])
showArgPanel('选中 /feedback（自由文本，没法变成选项）', COMMANDS.find(c => c.name === 'feedback')!, [])

// ── 三、整屏：计划全文 / 命令面板叠在输入框上 ─────────────────
const planText = Array.from({ length: 40 }, (_, i) =>
  `第 ${i + 1} 步：把这一块做完，需要改动若干文件，并且补上对应的测试。`).join(NL)
const planQuestion = {
  id: 'plan-1',
  question: '这个计划可以吗？',
  detail: planText,
  options: [
    { label: 'Keep planning', description: 'Stay in plan mode; feedback goes back to the model.' },
    { label: 'Refuse' },
    { label: 'Approve' },
  ],
  intent: { kind: 'plan-review' as const, approve: 'Approve' },
}
const planPending: PendingInteraction = { kind: 'question', id: 'p1', questions: [planQuestion], settle: () => {} }

const session: any = {
  sessionId: 'preview',
  getSnapshot: () => ({ openState: 'open', running: false }),
  subscribe: () => () => {},
  prompt: async () => ({ ok: true }),
  command: async () => ({ ok: true }),
  projections: {
    faceOf: (key: string) => ({ getSnapshot: () => PROJECTIONS[key], subscribe: () => () => {} }),
  },
}
const binding: any = { session, eventSource: { getSnapshot: () => ({ entries: [] }), subscribe: () => () => {} } }
const withPlan: any = { getSnapshot: () => [planPending], subscribe: () => () => {} }
const idle: any = { getSnapshot: () => [], subscribe: () => () => {} }

function showFrame(label: string, props: Record<string, unknown>, interactions: any = idle): void {
  const out = renderToString(
    React.createElement(App, {
      session, binding, interactions, onExit: () => {}, interactive: false,
      fallbackSize: { columns: 80, rows: 24 }, commands: COMMANDS,
      ...props,
    } as never),
    { columns: 80 },
  )
  say('')
  say('· ' + label)
  out.split(NL).forEach((l, i) => say('  ' + String(i).padStart(2) + ' ' + l))
}

section('整屏：计划全文（计划自动跳到开头，提示行常驻）')
showFrame('计划全文 + 审批面板（事件面板顶替输入框）', {}, withPlan)

section('整屏：命令面板叠在输入框**上面**，输入框始终留在底部')
// 这两个 prop 只给预览/测试用（真跑时按 / 或 Tab 才会出现）
showFrame('输入框里是 /', { initialDraft: '/', initialPaletteCursor: 0 })
showFrame('输入框里是 /p', { initialDraft: '/p', initialPaletteCursor: 0 })

// ── 四、块的可读性：这才是「去掉颜色还读得出来吗」的答案 ──────
/**
 * 一段像真实使用的对话，走真实的 `layoutLines`。
 *
 * 这是回应「去掉颜色之后块的边界还看得出来吗」那个问题 ——
 * 不靠想象，直接看同一份输出带色/不带色两种样子。
 */
const CONVERSATION: Line[] = [
  { kind: 'user', text: '帮我看看这个报告，顺便把结论提出来' },
  { kind: 'assistant', text: '好的，我先读一下。' },
  { kind: 'tool', name: 'read', detail: '{"file_path":"reports/2026-q3.md"}' },
  { kind: 'reasoning', text: '用户要结论。先看目录结构，再挑重点章节读，最后用三点总结。' },
  { kind: 'assistant', text: '报告主要讲三点：' + NL + NL + '1. 营收同比增长 12%' + NL + '2. 成本上升主要来自人力' + NL + '3. 下季度重点是海外市场' },
  { kind: 'meta', text: '/plan', tone: 'command' },
  { kind: 'meta', text: 'Plan mode on. Use /plan off to leave.', tone: 'notice' },
  { kind: 'user', text: '先别动手，我想再想想' },
  { kind: 'reasoning', text: '用户要停下来。那就先不动。' },
  { kind: 'assistant', text: '好，我先不动，等你想好。' },
  { kind: 'error', text: '读取失败：permission denied' },
]

/** 折叠思考（默认形态），返回一行行纯文本 */
function conversationLines(): string[] {
  const rows: Row[] = layoutLines(CONVERSATION, { width: 72, showReasoning: false })
  return rows.map(row => (row.kind === 'gap' ? '' : (row.prefix ?? '') + row.text))
}

section('块的可读性（真实 layoutLines 输出）')
{
  const lines = conversationLines()
  // 「带颜色」这一份：用**真实的 RowView**（对话框里用的就是它）渲染一遍
  const colored = renderToString(
    React.createElement(
      Box,
      { flexDirection: 'column' },
      ...layoutLines(CONVERSATION, { width: 72, showReasoning: false })
        .map((row, i) => React.createElement(RowView, { key: i, row })),
    ),
    { columns: 72 },
  )

  if (COMPARE) {
    say('')
    say('【① 去掉颜色】—— 这是「无色还读不读得出来」的答案')
    for (const l of lines) say('  ' + l)
    say('')
    say('【② 带颜色】')
    for (const l of colored.split(NL)) say('  ' + l)
    say('')
    say('  看两件事：')
    say('    1) 块的边界（哪几行属于同一轮）还能不能一眼看出来')
    say('    2) 「思考」和「回答」的分界够不够清楚')
    say('       （这两类都是「符号 + 中文标签」，无色时最容易混）')
  } else {
    say('')
    say('  【带颜色】')
    for (const l of colored.split(NL)) say('  ' + l)
    say('')
    say('  想看去掉颜色的版本：npm run preview:ui -- --compare')
  }
}

// ── 输出 ──────────────────────────────────────────────────────
const text = buf.join(NL) + NL
process.stdout.write(NO_COLOR ? stripAnsi(text) : text)
