// 整屏帧的渲染测试
//
// 为什么必须有这一层：src/ui/cursor.ts 记的「坑 2」说
//   Ink 的 overflow="hidden" 不是裁剪，是「挤」—— 内容超过盒子高度时，
//   它会丢掉/叠掉行，而且**总行数看起来仍然是对的**。
//
// 所以「高度算错了」这件事只在两个地方露馅：
//   ① 帧行数跟终端行数不一致；
//   ② 某一行本该出现的内容不见了、或被压进了别的行。
// 只断言总行数抓不到 ②（实测：高度 5 装 6 行，输出还是 5 行，但第一行没了）。
// 所以下面两种断言都要有。
//
// 之前的测试只验了 contentHeight 的公式（tests/cursor.test.ts），没验真实渲染，
// 于是「滚动提示行没进高度预算」这类问题全都漏过去了。
import React from 'react'
import { renderToString } from 'ink'
import { App } from '../src/ui/App.tsx'
import type { PendingInteraction } from '../src/interactions.ts'
import { windowPanel, type PanelRow } from '../src/ui/panels.ts'
import { displayWidth } from '../src/ui/width.ts'

let pass = 0, fail = 0
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name) }
  else { fail++; console.log('  ✗', name, detail !== undefined ? `\n      ${detail}` : '') }
}

/** 造一个假的 binding/session，只要 App 用到的那几个方法。 */
function makeHarness(entries: readonly unknown[] = []) {
  let snap: Record<string, unknown> = { openState: 'open', running: false }
  const session = {
    sessionId: 'test-session-id',
    getSnapshot: () => snap,
    subscribe: () => () => {},
    prompt: async () => ({ ok: true }),
    command: async () => ({ ok: true, value: { matched: true } }),
  }
  const binding = {
    session,
    eventSource: {
      getSnapshot: () => ({ entries }),
      subscribe: () => () => {},
    },
  }
  const interactions = {
    getSnapshot: (): readonly PendingInteraction[] => [],
    subscribe: () => () => {},
  }
  return {
    session,
    binding,
    interactions,
    setSnap: (next: Record<string, unknown>) => { snap = next },
  }
}

/** 测试用的命令清单（形状照抄 dsh 真实返回的 6 条）。 */
const TEST_COMMANDS = [
  { name: 'compact', description: 'Compact older conversation history' },
  { name: 'export', description: 'Download this Session log as a ZIP archive' },
  { name: 'feedback', description: 'record feedback about this session', input: { hint: '<text>' } },
  { name: 'goal', description: 'set or view the goal', input: { hint: '[<objective>|clear]' } },
  { name: 'permission', description: 'Switch the permission preset', input: { hint: '<preset>' } },
  { name: 'plan', description: 'Enter or leave plan mode', input: { hint: '[off|message]' } },
]

/** 把渲染结果切成「帧里的行」。 */
function frameLines(out: string): string[] {
  return out.endsWith('\n') ? out.slice(0, -1).split('\n') : out.split('\n')
}

function renderApp(
  size: { columns: number; rows: number },
  entries: readonly unknown[] = [],
  extra: Record<string, unknown> = {},
  snap: Record<string, unknown> = {},
): string {
  const h = makeHarness(entries)
  h.setSnap({ openState: 'open', running: false, ...snap })
  return renderToString(
    React.createElement(App, {
      session: h.session,
      binding: h.binding,
      interactions: h.interactions,
      title: '测试会话',
      onExit: () => {},
      interactive: false,
      fallbackSize: size,
      ...extra,
    } as never),
    { columns: size.columns },
  )
}

/**
 * 造 n 条用户消息。
 *
 * 形状必须跟 transcript.ts 认的一致：`{ type: 'event', event: { type, data } }`。
 * 而且 source.kind 必须是 'user' —— 那是「用户真的打了字」的唯一可靠判据
 * （见 transcript.ts isRealUserMessage 的说明）。
 */
function messages(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    type: 'event' as const,
    event: {
      type: 'user/message' as const,
      data: {
        content: [{ type: 'text', text: `第${i + 1}条用户消息` }],
        source: { kind: 'user' },
      },
    },
  }))
}

console.log('=== 帧行数必须正好等于终端行数 ===')
for (const size of [
  { columns: 80, rows: 24 },
  { columns: 80, rows: 12 },
  { columns: 40, rows: 30 },
  { columns: 100, rows: 10 },
]) {
  const out = renderApp(size)
  const got = frameLines(out).length
  ok(`${size.columns}×${size.rows} 空对话 → ${got} 行`, got === size.rows, `期望 ${size.rows} 行`)
}

console.log('=== 对话超过一屏时：帧行数仍要对，且滚动提示必须完整出现 ===')
for (const size of [
  { columns: 80, rows: 24 },
  { columns: 80, rows: 12 },
  { columns: 60, rows: 16 },
]) {
  const out = renderApp(size, messages(30))
  const lines = frameLines(out)
  ok(`${size.columns}×${size.rows} 长对话 → ${lines.length} 行`, lines.length === size.rows,
     `期望 ${size.rows} 行`)
  // 这一条才是「提示行没进高度预算」的直接判据 —— 那个 bug 下提示整条消失
  const hint = lines.find(l => l.includes('↑ 上方'))
  ok(`${size.columns}×${size.rows} 滚动提示完整存在`, hint !== undefined, '提示行整条不见了')
  if (hint !== undefined) {
    ok(`${size.columns}×${size.rows} 提示行格式正确（没被别的文字压进来）`,
       /^\s*↑ 上方 \d+ 行( · ↓ 下方 \d+ 行)?\s*$/.test(hint), `实际：${JSON.stringify(hint)}`)
  }
}

console.log('=== 对话很短时：不该出现滚动提示 ===')
{
  const out = renderApp({ columns: 80, rows: 24 }, messages(2))
  const lines = frameLines(out)
  ok('帧行数正确', lines.length === 24, `实际 ${lines.length}`)
  ok('没有滚动提示', !lines.some(l => l.includes('↑ 上方')))
  ok('下面也没有藏东西，不该报「下面还有」', !lines.some(l => l.includes('↓ 下方')))
  ok('内容确实渲染出来了', lines.some(l => l.includes('第1条用户消息')))
}

console.log('=== 空对话：显示引导语，且不超行 ===')
{
  const out = renderApp({ columns: 80, rows: 24 })
  const lines = frameLines(out)
  ok('帧行数正确', lines.length === 24, `实际 ${lines.length}`)
  ok('显示引导语', lines.some(l => l.includes('尚无对话')))
}

console.log('=== 输入框草稿超过上限：帧行数仍要对，且提示完整 ===')
for (const rows of [24, 16]) {
  const out = renderApp({ columns: 80, rows }, [], { initialMessage: undefined })
  ok(`${rows} 行终端基线正常`, frameLines(out).length === rows, `实际 ${frameLines(out).length}`)
}

console.log('=== 标题很长（中文）时不许把标题栏折成两行 ===')
{
  const long = '帮我看看这个报告里面有没有问题然后写一下总结再顺便查一下参考文献'
  for (const columns of [80, 40, 24]) {
    const h = makeHarness()
    const out = renderToString(
      React.createElement(App, {
        session: h.session, binding: h.binding, interactions: h.interactions,
        title: long, onExit: () => {}, interactive: false,
        fallbackSize: { columns, rows: 24 },
      } as never),
      { columns },
    )
    const lines = frameLines(out)
    ok(`${columns} 列下帧行数正确`, lines.length === 24, `实际 ${lines.length}`)
    ok(`${columns} 列下标题行只有一行`, lines[0]!.includes('dsht'), JSON.stringify(lines.slice(0, 3)))
  }
}

console.log('=== 历史分页：滚到顶且有更早的记录时必须告诉用户 ===')
{
  // 内容放得下（hiddenAbove === 0）+ 官方说还有更早的 → 应该出现「再按 PgUp」的提示。
  // 这条很重要：官方 open() 只拉最近 50 条，不提示的话用户会以为已经看到全部历史了。
  const out = renderApp({ columns: 80, rows: 24 }, messages(2), {}, { hasMore: true })
  const lines = frameLines(out)
  ok('帧行数仍然正确', lines.length === 24, `实际 ${lines.length}`)
  const notice = lines.find(l => l.includes('↑'))
  ok('出现了顶部提示', notice !== undefined)
  ok('提示里说了怎么载入更早的', notice !== undefined && notice.includes('PgUp'), JSON.stringify(notice))
}
{
  const out = renderApp({ columns: 80, rows: 24 }, messages(2), {}, { loadingOlder: true })
  const notice = frameLines(out).find(l => l.includes('↑'))
  ok('正在载入时给出「载入中」反馈', notice !== undefined && notice.includes('正在载入'), JSON.stringify(notice))
}
{
  // 没有更早的了 → 明确说「已到最早」
  const out = renderApp({ columns: 80, rows: 24 }, messages(2), {}, { hasMore: false })
  const notice = frameLines(out).find(l => l.includes('↑'))
  ok('没有更多历史时不提示按 PgUp', notice === undefined)
}
{
  // 无历史分页信息时（老快照没有这两个字段）不该白占一行
  const out = renderApp({ columns: 80, rows: 24 }, messages(2))
  ok('快照没有 hasMore 字段时不占位', !frameLines(out).some(l => l.includes('↑')))
}

console.log('=== 空行必须占一行（Ink 里空 <Text> 的高度是 0）===')
{
  // 这个坑很隐蔽：RowView 对「没前缀 + 空文本」的行渲染 <Text></Text>，
  // Ink 给它高度 0 —— 于是空行凭空消失，盒子比预算矮一截，
  // 内容下面空出一大块。计划全文里空行多，所以那里最先被发现。
  const p = makeHarness()
  const detail = ['第 1 步', '', '', '', '第 5 步', '', '第 7 步'].join(String.fromCharCode(10))
  const q = {
    id: 'q-plan', question: '这个计划可以吗？', detail,
    options: [{ label: 'Approve' }],
    intent: { kind: 'plan-review' as const, approve: 'Approve' },
  }
  p.interactions.getSnapshot = () => [{ kind: 'question', id: 'plan', questions: [q], settle: () => {} }]
  for (const rows of [24, 18, 30]) {
    const out = renderToString(
      React.createElement(App, {
        session: p.session, binding: p.binding, interactions: p.interactions,
        onExit: () => {}, interactive: false, fallbackSize: { columns: 80, rows },
      } as never),
      { columns: 80 },
    )
    const lines = frameLines(out)
    ok(`${rows} 行终端：帧行数正确`, lines.length === rows, `实际 ${lines.length}`)
    // 关键：滚动区里那几行空行必须**真的占位置**。
    // 判据用「第 1 步」和「第 5 步」之间隔了几行 —— 中间有 3 个空行，
    // 所以行号应该差 4。空行一旦塌陷，这个差就会变小。
    const first = lines.findIndex(l => l.includes('第 1 步'))
    const fifth = lines.findIndex(l => l.includes('第 5 步'))
    ok(`${rows} 行终端：步骤之间保留了空行（没有塌陷）`,
       first >= 0 && fifth - first === 4,
       `第 1 步在第 ${first} 行、第 5 步在第 ${fifth} 行 —— 应该差 4（中间 3 个空行）`)
  }
}

console.log('=== 命令面板：叠在输入框上面，输入框仍在底部 ===')
{
  for (const rows of [24, 18, 30]) {
    const out = renderApp(
      { columns: 80, rows },
      [],
      { initialDraft: '/', initialPaletteCursor: 0, commands: TEST_COMMANDS },
    )
    const lines = frameLines(out)
    ok(`${rows} 行终端：帧行数正确`, lines.length === rows, `实际 ${lines.length}`)
    const paletteTitle = lines.findIndex(l => l.includes('命令'))
    const inputTop = lines.findIndex(l => l.startsWith('╭') && lines[lines.indexOf(l) + 1]?.includes('>'))
    // 输入框必须还在（没被命令面板顶替掉），而且在命令面板**下面**
    const hasComposer = lines.some(l => l.includes('Enter 发送'))
    ok(`${rows} 行终端：输入框没有被顶替`, hasComposer)
    ok(`${rows} 行终端：命令面板在输入框上方`,
       paletteTitle >= 0 && paletteTitle < lines.length - 3,
       `命令面板在第 ${paletteTitle} 行`)
    ok(`${rows} 行终端：能看到命令选项`, lines.some(l => l.includes('/plan')), '面板里没有命令')
  }
}

console.log('=== 宽度矩阵：窄终端是 bug 的高发区（评审报的三个 bug 全在这）===')
{
  // ⚠️ 为什么必须扫一遍宽度：
  // 之前所有渲染测试都固定在 80 列，而评审报的三个 bug —— 面板提示行没按内宽裁、
  // 标题栏提示没扣徽标宽度、命令面板没走裁剪 —— **只在窄终端出现**。
  // 80 列下它们完全看不出来，所以测试全绿。
  //
  // 断言三件事，每一件都是「挤压」的直接证据：
  //   1. 帧行数 == 终端行数（这是最低要求，单独并不够）
  //   2. 标题栏只占 1 行 —— 用「尚无对话」落在第 2 行来判定（折行了它就会被推下去）
  //   3. 没有任何一行的显示宽度超过终端列数
  const overWide = (line: string, cols: number) => displayWidth(line) > cols
  for (const cols of [24, 30, 40, 43, 45, 48, 52, 60, 66, 80]) {
    for (const rows of [10, 20, 24]) {
      const out = renderApp({ columns: cols, rows })
      const lines = frameLines(out)
      const tag = `${cols}列×${rows}行`
      ok(`${tag}：帧行数正确`, lines.length === rows, `实际 ${lines.length}`)
      ok(`${tag}：标题栏只占 1 行`, lines[1]?.includes('尚无对话') === true,
         `第 2 行是 ${JSON.stringify(lines[1])} —— 标题栏折行了`)
      const over = lines.filter(l => overWide(l, cols))
      ok(`${tag}：没有超出宽度的行`, over.length === 0, over.slice(0, 2).map(l => JSON.stringify(l)).join(' / '))
    }
  }
}

console.log('=== 面板比屏幕长：必须裁 + 说清楚还有多少，不能挤压 ===')
{
  // ⚠️ 这条测试**以前是假绿的**。
  //
  // 原来只断言「帧行数 == 终端行数」—— 而这正是 UI-DESIGN 第三节第 4 条
  // 亲手写下的那个陷阱：「只数总行数是不够的，挤压发生时总行数往往仍然正确」。
  // 实际渲染出来是：24 行终端上 40 个选项只剩 6 个可见、文字互相叠在一起、
  // **标题栏整个消失**，而这条断言依然通过。
  //
  // 现在的断言分三类：
  //   1. 结构还在不在（标题栏 / 状态行 / 面板标题）—— 挤压会先把它们顶掉
  //   2. 装得下时，选项**一个都不能少**
  //   3. 装不下时，**当前选中项必须可见**，并明确提示还有多少
  const h = makeHarness()
  const optionCount = 40
  const bigQuestion: PendingInteraction = {
    kind: 'question',
    id: 'q-big',
    questions: [{
      id: 'q1',
      question: '选一个',
      options: Array.from({ length: optionCount }, (_, i) => ({ label: `选项${i}`, description: `说明${i}` })),
    }],
    settle: () => {},
  }
  h.interactions.getSnapshot = () => [bigQuestion]

  for (const rows of [24, 14, 40]) {
    const out = renderToString(
      React.createElement(App, {
        session: h.session, binding: h.binding, interactions: h.interactions,
        onExit: () => {}, interactive: false, fallbackSize: { columns: 80, rows },
      } as never),
      { columns: 80 },
    )
    const lines = frameLines(out)
    ok(`${rows} 行终端：帧行数正确`, lines.length === rows, `实际 ${lines.length}`)

    // ① 结构还在不在 —— 挤压最直接的证据（标题栏会第一个没）
    ok(`${rows} 行终端：标题栏还在`, lines[0]?.includes('dsht') === true, `第一行是 ${JSON.stringify(lines[0])}`)
    ok(`${rows} 行终端：状态行还在`, lines.some(l => l.includes('等你回应')), '状态行被挤掉了')
    ok(`${rows} 行终端：面板标题还在`, lines.some(l => l.includes('提问')), '面板标题被挤掉了')

    // ② 当前选中项（默认第一项）必须看得见
    ok(`${rows} 行终端：当前选中项可见`, lines.some(l => l.includes('> 选项0')), '光标停在看不见的项上')

    // ③ 装不下时要明确说「还有多少」
    const visibleOptions = lines.filter(l => /选项\d+/.test(l)).length
    if (visibleOptions < optionCount) {
      ok(`${rows} 行终端：提示还有多少项`, lines.some(l => l.includes('还有') && l.includes('继续')),
         `只看到 ${visibleOptions} 项，却没有提示`)
    } else {
      ok(`${rows} 行终端：装得下就要全显示（${visibleOptions} 项）`, visibleOptions === optionCount)
    }

    // ④ 不许出现重复渲染的选项（窗口化算错时会重复）
    const labels = lines.filter(l => /选项\d+/.test(l)).map(l => l.match(/选项\d+/)![0])
    ok(`${rows} 行终端：没有重复的选项`, new Set(labels).size === labels.length, labels.join(','))
  }
}

console.log('=== 面板窗口化：光标滑到后面时窗口要跟着走 ===')
{
  // 直接测纯函数，比隔着整屏渲染更容易看清边界
  const rows: PanelRow[] = Array.from({ length: 20 }, (_, i) => ({
    text: `第${i}项`, tone: 'option' as const, ...(i === 15 ? { focus: true as const } : {}),
  }))
  const win = windowPanel(rows, 6, 76)
  ok('窗口行数不超过上限', win.length <= 6, `实际 ${win.length}`)
  ok('提示行在最上面', win[0]?.text.includes('还有') === true)
  ok('选中项在窗口里', win.some(r => r.focus === true), '光标那一项没被包含进来')
  ok('选中项不在首尾（上下都留了上下文）',
     win.findIndex(r => r.focus === true) > 0 && win.findIndex(r => r.focus === true) < win.length - 1)

  // 光标在最后一项时不能越界
  const tail: PanelRow[] = Array.from({ length: 20 }, (_, i) => ({
    text: `第${i}项`, tone: 'option' as const, ...(i === 19 ? { focus: true as const } : {}),
  }))
  const win2 = windowPanel(tail, 6, 76)
  ok('光标在最后一项时也包含它', win2.some(r => r.focus === true))
  ok('不越界', win2.length <= 6)

  // 装得下就原样返回，不加提示行
  const small = windowPanel(rows.slice(0, 3), 6, 76)
  ok('装得下时不加提示行', small.length === 3 && !small.some(r => r.text.includes('还有')))
}

console.log('')
console.log(`通过 ${pass} / ${pass + fail}`)
if (fail > 0) process.exitCode = 1
