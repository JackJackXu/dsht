// 色卡：列出终端支持的 16 个基础色，并标出 dsht 现在用在哪
//
// 标记符号直接引用 src/ui/layout.ts 的真常量，不再各抄一份。
import {
  AGENT_MARK, ERR_MARK, SYS_MARK, THINK_MARK, TOOL_MARK, USER_MARK,
} from '../src/ui/layout.ts'

const ESC = '\u001b['
const r = '\u001b[0m'
const c = (code: number, s: string): string => `${ESC}${code}m${s}${r}`
const bold = (s: string): string => `${ESC}1m${s}${r}`

/** Ink/chalk 的颜色名 → ANSI 码 */
const colors: Array<[string, number]> = [
  ['black', 30], ['red', 31], ['green', 32], ['yellow', 33],
  ['blue', 34], ['magenta', 35], ['cyan', 36], ['white', 37],
  ['blackBright（别名 gray）', 90], ['redBright', 91], ['greenBright', 92], ['yellowBright', 93],
  ['blueBright', 94], ['magentaBright', 95], ['cyanBright', 96], ['whiteBright', 97],
]

/** dsht 现在把哪些角色分给了谁 */
const current: Record<number, string> = {
  92: '你  > 前缀',
  96: 'dsh  ~ 前缀 · 面板高亮 · 标题徽标 · 流式光标',
  93: '工具行 · 面板里的标签',
  95: '思考行',
  91: '错误',
  90: '提示 / 次要信息 / 输入框边框（空闲）',
  33: '输入框边框（工作中）',
}

console.log('')
console.log(bold('━━━ 终端基础色一览（前 8 个是普通，后 8 个是「亮」版）━━━'))
console.log(`    ${ESC}90m这类颜色由你的终端主题决定，不是我们指定的${r}`)
console.log('')
for (const [name, code] of colors) {
  const use = current[code]
  const sample = '  ● 示例文字 the quick brown fox 中文字符  '
  console.log(`  ${c(code, sample)}  ${name.padEnd(26)} ${use === undefined ? '' : ESC + '90m← dsht 现在用于：' + use + r}`)
}
console.log('')
console.log(bold('━━━ 当前配色在这段对话上的效果 ━━━'))
console.log('')
console.log(`${c(92, USER_MARK)}帮我看看这个报告`)
console.log('')
console.log(`${c(96, AGENT_MARK)}好的，我先读一下。`)
console.log('')
console.log(c(93, '  · 工具 read  report.md'))
console.log(c(95, '  · 思考 已折叠（Ctrl+O 展开）'))
console.log('')
console.log(`${c(96, AGENT_MARK)}报告主要讲了三点……`)
console.log(c(91, '  ! 读取失败：权限不足'))
console.log(c(90, '  ↑ 上面还有 12 行'))
console.log('')
console.log(`${c(90, '╭────────────────────────────────────╮')}`)
console.log(`${c(90, '│')} ${c(92, USER_MARK)}输入框的样子`)
console.log(`${c(90, '╰────────────────────────────────────╯')}`)
console.log(`${c(33, '  ')}${ESC}90mEnter 发送 · Ctrl+Enter 换行${r}   ${c(33, '● 工作中')}`)
console.log('')
