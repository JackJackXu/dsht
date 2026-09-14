// 审批 / 提问 / 计划评审 面板的「行数组」构造
//
// 为什么要返回行数组而不是直接写 JSX：
// 面板高度必须和渲染内容严格一致（Ink 的溢出会花屏，见 cursor.ts 说明）。
// 同一个函数既算高度又出内容，就不会对不上。
//
// 视觉沿用主界面的语言：方框、`·`、中文标签、不用 emoji。

import type { PendingInteraction, QuestionItem } from '../interactions.ts'
import { approveLabelOf, isPlanReview } from '../interactions.ts'
import { wrapText, clip, displayWidth } from './width.ts'
import { customIndex, type QuestionFlowState } from './question-flow.ts'
import { CONT } from './layout.ts'
import {
  PALETTE_MAX_ROWS,
  syntaxOf,
  type CommandArgument,
  type SlashCommand,
} from './commands.ts'
import { cursorBeforeWidth, layoutInput } from './input.ts'
import { panelContentWidth } from './cursor.ts'
import { USER_MARK } from './layout.ts'

/**
 * 面板里「当前选中哪一项」的标记。
 *
 * 故意跟用户标记用同一个符号：两个地方的意思都是「**你**在这」。
 * 直接引用 USER_MARK，所以你改了用户标记，面板自动跟着变，不会两边不一致。
 * 面板里它是黄色、缩进在方框内，跟对话流里青色、顶格的用户行不会混。
 */
export const PANEL_CURSOR_MARK = USER_MARK.trimEnd()

export type PanelTone =
  | 'title'
  | 'label'
  | 'value'
  | 'option'
  | 'optionActive'
  | 'hint'
  | 'blank'

export interface PanelRow {
  text: string
  tone: PanelTone
  /** 这一行是「自己输入」的编辑行 —— 界面要把终端光标放到这里 */
  customInput?: boolean
  /**
   * 光标在这一行里、距行首的显示列数（CJK 按 2 列算）。
   * 界面把终端光标放在「量出来的行坐标 + 这个偏移」处。
   */
  customCursorX?: number
  /**
   * 这一行是「当前选中项」。
   *
   * 面板比屏幕长时要靠它决定窗口往哪儿滑 —— 不支持滚动的面板里，
   * 唯一不能让用户看不见的就是他正在选的那一项。
   */
  focus?: boolean
}

const MAX_REASON_LINES = 4
/** 「原因  」前缀的列数（续行对齐用同样宽度） */
const REASON_INDENT = 6
/**
 * 面板里每行开头「标记」占的列数：符号 1 列 + 一个空格。
 *
 * 所有行（选项、说明、自己输入）都从第 2 列开始内容，形成一条干净的竖线。
 * 别在某个分支里偷偷多加空格 —— 之前「自己输入」就是这样跟选项错开的。
 */
const MARK_COLS = 2

/** 「自己输入」最多显示几行 */
const CUSTOM_MAX_LINES = 4

/** 审批面板。 */
export function buildApprovalPanel(
  request: { toolName: string; callId?: string; reason?: string },
  cursor: number,
  width: number,
): PanelRow[] {
  const inner = panelContentWidth(width)
  const rows: PanelRow[] = []

  rows.push({ text: clip(`工具  ${request.toolName}`, inner), tone: 'label' })
  if (request.callId !== undefined) {
    rows.push({ text: clip(`调用  ${request.callId}`, inner), tone: 'hint' })
  }
  if (request.reason !== undefined && request.reason !== '') {
    // ⚠️ 折行宽度必须**先扣掉行首那 6 列前缀**。
    // 早先是 `wrapText(reason, inner)` 之后再拼前缀，于是每行变成
    // 「6 列前缀 + inner 列正文」= 超出可用宽度 6 列，Ink 自己又折一次 ——
    // 面板高度直接翻倍，而记账只按 wrapText 的条数。
    // 触发条件很常见：原因长于 inner-6 列（中文约 35 字）就必然发生。
    const wrapped = wrapText(request.reason, Math.max(4, inner - REASON_INDENT)).slice(0, MAX_REASON_LINES)
    wrapped.forEach((line, i) =>
      rows.push({ text: clip((i === 0 ? '原因  ' : ' '.repeat(REASON_INDENT)) + line, inner), tone: 'value' }))
  }

  rows.push({ text: '', tone: 'blank' })
  const options = ['允许一次', '拒绝']
  options.forEach((label, i) => {
    const active = i === cursor
    rows.push({
      text: `${active ? PANEL_CURSOR_MARK : ' '} ${label}`,
      tone: active ? 'optionActive' : 'option',
      ...(active ? { focus: true } : {}),
    })
  })
  rows.push({ text: '', tone: 'blank' })
  rows.push({ text: clip('↑↓ 选择 · Enter 确认 · Esc 拒绝', inner), tone: 'hint' })

  return rows
}

/** 提问 / 计划评审面板。 */
export function buildQuestionPanel(
  question: QuestionItem,
  flow: QuestionFlowState,
  position: { index: number; total: number },
  width: number,
): PanelRow[] {
  const inner = panelContentWidth(width)
  const rows: PanelRow[] = []
  const plan = isPlanReview(question)
  const approveLabel = approveLabelOf(question)

  // 标题
  const title = plan
    ? `计划评审${position.total > 1 ? ` ${position.index + 1}/${position.total}` : ''}`
    : `提问${position.total > 1 ? ` ${position.index + 1}/${position.total}` : ''}`
  rows.push({ text: clip(title, inner), tone: 'title' })

  if (question.header !== undefined && question.header !== '') {
    rows.push({ text: clip(question.header, inner), tone: 'hint' })
  }

  // 问题正文
  const bodyLines = wrapText(question.question, inner).slice(0, 4)
  for (const line of bodyLines) rows.push({ text: line, tone: 'value' })

  // 有 detail 时，全文在对话区显示（这里只提示）
  if (question.detail !== undefined && question.detail !== '') {
    // 计划全文会自动跳到开头（见 App 里 showingDetail 的处理），所以这里只说「可以翻」，
    // 不说「按 PgUp 去翻」—— 那样会让人以为得先按键才看得到开头。
    rows.push({ text: clip(plan ? '（计划全文见上方 · PgUp/PgDn 翻阅）' : '（详细说明见上方）', inner), tone: 'hint' })
  }

  rows.push({ text: '', tone: 'blank' })

  // 选项
  const options = question.options ?? []
  const customAt = customIndex(question)
  for (const [i, option] of options.entries()) {
    const active = i === flow.cursor
    const box = question.multiSelect === true ? (flow.selected.includes(option.label) ? '[x] ' : '[ ] ') : ''
    // 「哪个选项是批准」只在一个地方判断（approveLabelOf），别在这里再读一遍 intent
    const badge = approveLabel === option.label ? '  ← 批准' : ''
    const line = `${active ? PANEL_CURSOR_MARK : ' '} ${box}${option.label}${badge}`
    rows.push({
      text: clip(line, inner),
      tone: active ? 'optionActive' : 'option',
      ...(active ? { focus: true } : {}),
    })
    if (option.description !== undefined && option.description !== '') {
      rows.push({ text: clip(`    ${option.description}`, inner), tone: 'hint' })
    }
  }

  // 「自己输入」这一项
  //
  // 布局规则跟上面所有行一致：**标记占 2 列（符号 + 一个空格），正文从第 2 列开始**。
  // 早先这里塞了个 `✎ ` 占位符（为了在编辑态跟非编辑态之间对齐），
  // 结果非编辑态渲染成 `>   自己输入…`（3 个空格），跟选项标签对不齐。
  const customActive = flow.cursor === customAt
  const customMark = `${customActive ? PANEL_CURSOR_MARK : ' '} `

  if (flow.editing) {
    // 必须折行，不能截断 —— 而且光标要跟着折行走。
    // 复用输入框那套（CJK 宽度感知 + 光标追踪），别自己算。
    const view = layoutInput(flow.custom, flow.custom.length, Math.max(4, inner - MARK_COLS), CUSTOM_MAX_LINES)
    // 记下「自定义输入从第几行开始」——提示行要插在这里，而不是整个面板的最前面。
    // （早先用 unshift 插到数组第 0 位，结果提示跑到了**标题上面**。）
    const customStart = rows.length
    const empty = flow.custom === ''

    view.lines.forEach((line, i) => {
      // 第一行接着标记写；续行用等宽空白对齐，看起来像一段连续的输入
      const prefix = i === 0 ? customMark : CONT
      // 一个字都还没打时给个占位提示（光标会停在这句话前面）
      const body = empty && i === 0 ? '自行输入…' : line
      const isCursorLine = i === view.cursorLine
      rows.push({
        text: clip(prefix + body, inner),
        tone: empty ? 'hint' : 'optionActive',
        ...(isCursorLine
          ? {
            customInput: true,
            customCursorX: displayWidth(prefix) + cursorBeforeWidth(line, view.cursorCol),
            // 正在输入时，「当前选中项」就是光标那一行 —— 窗口要保证它可见
            focus: true,
          }
          : {}),
      })
    })

    if (view.hiddenAbove > 0) {
      rows.splice(customStart, 0, {
        text: clip(`${CONT}（上方还有 ${view.hiddenAbove} 行）`, inner),
        tone: 'hint',
      })
    }
  } else {
    rows.push({
      text: clip(`${customMark}自己输入…`, inner),
      tone: customActive ? 'optionActive' : 'option',
      ...(customActive ? { focus: true } : {}),
    })
    // 有草稿但没在编辑（比如按 Esc 退出编辑回到选项）→ 把草稿显示出来，否则会被忘掉
    if (flow.custom !== '') {
      for (const line of wrapText(flow.custom, Math.max(4, inner - MARK_COLS)).slice(0, 2)) {
        rows.push({ text: clip(CONT + line, inner), tone: 'value' })
      }
    }
  }

  rows.push({ text: '', tone: 'blank' })
  const hint = flow.editing
    ? 'Enter 提交 · Esc 返回'
    : question.multiSelect === true
      ? '↑↓ 选择 · 空格 勾选 · Enter 确认 · 打字可补充'
      : '↑↓ 选择 · Enter 确认 · 打字可自行回答'
  rows.push({ text: clip(hint, inner), tone: 'hint' })

  return rows
}

/** 根据待处理事项，取出要显示在上方（可滚动区）的全文；没有就返回 undefined。 */
export function detailOf(interaction: PendingInteraction, flow: QuestionFlowState | undefined): string | undefined {
  if (interaction.kind !== 'question') return undefined
  const question = interaction.questions[flow?.index ?? 0]
  const detail = question?.detail
  return detail === undefined || detail === '' ? undefined : detail
}



/**
 * 命令面板（按 `/` 或 Tab 弹出来的那个）。
 *
 * 为什么要有它：用户是非程序员，不该被要求背下命令名和参数语法。
 * 清单来自 dsh 本身，所以这里只负责画，不负责「有哪些命令」。
 *
 * 只给**选中的那条**显示说明 —— 每条都带说明的话，6 条命令就是 12 行，
 * 会把对话区挤没。
 */
export function buildCommandPalette(
  commands: readonly SlashCommand[],
  cursor: number,
  width: number,
): PanelRow[] {
  const inner = panelContentWidth(width)
  const rows: PanelRow[] = []

  rows.push({ text: clip('命令', inner), tone: 'title' })

  if (commands.length === 0) {
    rows.push({ text: clip('  无匹配命令', inner), tone: 'hint' })
    rows.push({ text: '', tone: 'blank' })
    rows.push({ text: clip('Esc 取消', inner), tone: 'hint' })
    return rows
  }

  const top = Math.max(0, Math.min(cursor - PALETTE_MAX_ROWS + 1, commands.length - PALETTE_MAX_ROWS))
  const shown = commands.slice(top, top + PALETTE_MAX_ROWS)

  for (const [i, command] of shown.entries()) {
    const active = top + i === cursor
    rows.push({
      text: clip(`${active ? PANEL_CURSOR_MARK : ' '} ${syntaxOf(command)}`, inner),
      tone: active ? 'optionActive' : 'option',
    })
  }

  // 只解释当前选中的那条
  const current = commands[Math.max(0, Math.min(cursor, commands.length - 1))]
  if (current !== undefined) {
    rows.push({ text: '', tone: 'blank' })
    for (const line of wrapText(current.description, inner)) {
      rows.push({ text: clip(line, inner), tone: 'hint' })
    }
  }

  rows.push({ text: '', tone: 'blank' })
  const more = commands.length > shown.length ? `　（共 ${commands.length} 条）` : ''
  rows.push({ text: clip(`↑↓ 选择 · Enter 确认 · Esc 取消${more}`, inner), tone: 'hint' })

  return rows
}

/**
 * 面板比屏幕还长时，只显示光标周围的一段，并**明确告诉用户还有多少**。
 *
 * 为什么必须有这么个函数：不裁的话，Ink 会挤压固定高度的盒子 ——
 * 它丢行、把两行文字叠在一起，最后连标题栏都被顶掉。
 * 用户看到的是乱码，而键盘**依然能选到屏幕外的项**，完全没有任何提示。
 *
 * 最阴的是：这种情况下**帧行数往往还是对的**，所以「只断言总行数」的测试会全绿。
 * 我们的测试就这么绿过（`tests/frame.test.tsx` 里那条"面板很长时不许挤爆整屏"），
 * 而实际渲染出来：24 行终端上 40 个选项只剩 6 个可见、文字互相叠、标题栏消失。
 *
 * @param maxRows 面板正文最多占几行（不含边框）
 */
export function windowPanel(rows: readonly PanelRow[], maxRows: number, inner: number): PanelRow[] {
  if (maxRows <= 0) return []
  if (rows.length <= maxRows) return [...rows]

  // 留一行给「还有多少」的提示
  const capacity = Math.max(1, maxRows - 1)
  const focusAt = rows.findIndex(r => r.focus === true)
  const focus = focusAt < 0 ? 0 : focusAt

  // 让光标大致居中，上下都留点上下文；再夹回边界内
  let start = Math.max(0, focus - Math.floor(capacity / 2))
  start = Math.min(start, rows.length - capacity)

  const hiddenAbove = start
  const hiddenBelow = rows.length - start - capacity
  const parts: string[] = []
  if (hiddenAbove > 0) parts.push(`上方 ${hiddenAbove} 行`)
  if (hiddenBelow > 0) parts.push(`下方 ${hiddenBelow} 行`)

  return [
    // ⚠️ 必须按内宽裁。这里曾经写死 `clip(..., 999)`（等于不裁），
    // 于是窄终端下这一行自己折成两行 → 面板比声明高度高一行 → Ink 挤压。
    // 它是整个文件里唯一没按 inner 裁的一行，评审逮到的就是它。
    { text: clip(`${CONT}… 还有 ${parts.join('、')}（↑↓ 继续）`, inner), tone: 'hint' },
    ...rows.slice(start, start + capacity),
  ]
}

/**
 * 命令的**参数**子面板（选中一条需要参数的命令之后弹出来的那一层）。
 *
 * 为什么要这一层：用户说「不要命令，只要选项 …… 不然写参数很麻烦」。
 * 有了它，`/permission` 的三个预设就是三个可选项，用户一个字都不用打。
 *
 * 自由文本类的参数（`/feedback <text>`）没法变成选项 ——
 * 那种会显示成「写一段反馈…」，选中后把命令名填进输入框，用户接着打字。
 */
export function buildArgPanel(
  command: SlashCommand,
  args: readonly CommandArgument[],
  cursor: number,
  width: number,
): PanelRow[] {
  const inner = panelContentWidth(width)
  const rows: PanelRow[] = []

  rows.push({ text: clip(`/${command.name}`, inner), tone: 'title' })

  // ⚠️ 有选项时**不显示原始的参数占位**（形如 `[<objective>|clear|edit…]`）。
  // 用户要的正是「不用看这个」—— 选项本身就是说明。
  // 只在没有选项（不知道有哪些）时才把占位拿出来，那对用户是真有用的线索。
  if (args.length === 0) {
    const hint = command.input?.hint ?? ''
    rows.push({ text: clip(CONT + '此命令的参数无法转为选项', inner), tone: 'hint' })
    if (hint !== '') {
      rows.push({ text: clip(CONT + '需手动输入：' + hint, inner), tone: 'hint' })
    }
    rows.push({ text: '', tone: 'blank' })
    rows.push({ text: clip('Esc 返回', inner), tone: 'hint' })
    return rows
  }

  rows.push({ text: '', tone: 'blank' })

  for (const [i, arg] of args.entries()) {
    const active = i === cursor
    rows.push({
      text: clip(`${active ? PANEL_CURSOR_MARK : ' '} ${arg.label}`, inner),
      tone: active ? 'optionActive' : 'option',
      ...(active ? { focus: true } : {}),
    })
    if (arg.description !== undefined && arg.description !== '') {
      rows.push({ text: clip(`    ${arg.description}`, inner), tone: 'hint' })
    }
  }

  rows.push({ text: '', tone: 'blank' })
  rows.push({ text: clip('↑↓ 选择 · Enter 确认 · Esc 返回', inner), tone: 'hint' })
  return rows
}
