// 看看现在真实生效的配色
//
// 跑法：npm run palette
// 想比较浅色底：DSHT_THEME=light npm run palette
import { activePalette, DARK_PALETTE, LIGHT_PALETTE, type Palette } from '../src/ui/theme.ts'
import { displayWidth } from '../src/ui/width.ts'
import {
  AGENT_MARK,
  ERR_MARK,
  SYS_MARK,
  THINK_MARK,
  TOOL_MARK,
  USER_MARK,
} from '../src/ui/layout.ts'
import { PANEL_CURSOR_MARK } from '../src/ui/panels.ts'

const ESC = '\u001b['
const R = '\u001b[0m'
/** 基础色名 → ANSI 码 */
const CODES: Record<string, number> = {
  black: 30, red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36, white: 37,
  blackBright: 90, gray: 90, grey: 90, redBright: 91, greenBright: 92, yellowBright: 93,
  blueBright: 94, magentaBright: 95, cyanBright: 96, whiteBright: 97,
}
/** 按基础色名上色（bold 只加粗，不换成亮色） */
const paint = (name: string | undefined, s: string, bold = false): string =>
  name === undefined ? s : `${ESC}${bold ? '1;' : ''}${CODES[name] ?? 39}m${s}${R}`

const P = activePalette()
const which = P === DARK_PALETTE ? '深色底（默认）' : P === LIGHT_PALETTE ? '浅色底' : '自定义'

console.log('')
console.log(`━━━ 当前配色：${which} ━━━`)
console.log(`    ${paint(P.dim, '换浅色底看效果：DSHT_THEME=light npm run palette')}`)
console.log('')

const tokens: Array<[keyof Palette, string]> = [
  ['user', '你说的话'],
  ['agent', '智能体说的话'],
  ['tool', '工具调用'],
  ['thinking', '思考过程'],
  ['error', '错误'],
  // 下面两个是多用途的：dim 既画系统消息（- 前缀）也画正文细节和提示
  ['dim', '系统消息（- 前缀）· 提示 · 工具参数'],
  ['border', '边框'],
  ['attention', '面板选中 · 等你回应 · 工作中'],
]
console.log(paint(P.dim, '  令牌        颜色        用在哪'))
// 注意：系统消息没有自己的令牌，故意复用 dim —— 它本来就该不显眼。
for (const [token, desc] of tokens) {
  const name = P[token].padEnd(10)
  console.log(`  ${name} ${paint(P[token], '  ● 示例  ')}  ${paint(P.dim, desc)}`)
}

console.log('')
console.log('━━━ 实际界面的样子 ━━━')
console.log('')
console.log(`${paint(P.user, USER_MARK)}${paint(P.user, '帮我看看这个报告')}`)
console.log('')
console.log(`${paint(P.agent, AGENT_MARK)}${paint(P.agent, '好的，我先读一下。')}`)
console.log('')
console.log(paint(P.tool, TOOL_MARK + '工具 read') + paint(P.dim, '  report.md'))
console.log(paint(P.thinking, THINK_MARK + '思考 已折叠（Ctrl+O 展开）'))
console.log(paint(P.command, SYS_MARK + '/plan'))
console.log('')
console.log(`${paint(P.agent, AGENT_MARK)}${paint(P.agent, '报告主要讲了三点……')}`)
console.log(paint(P.error, ERR_MARK + '读取失败：权限不足'))
console.log(paint(P.dim, '↑ 上面还有 12 行'))
console.log('')
console.log(paint(P.border, '╭────────────────────────────────────╮'))
console.log(`${paint(P.border, '│')} ${paint(P.user, USER_MARK)}${'输入框的样子'}`)
console.log(paint(P.border, '╰────────────────────────────────────╯'))
console.log(`${paint(P.dim, '  Enter 发送 · Ctrl+Enter 换行 · PgUp/PgDn 翻页')}   ${paint(P.attention, '● 工作中')}`)
console.log('')
console.log('━━━ 面板（审批 / 提问）━━━')
console.log('')
console.log(paint(P.attention, '╭────────────────────────────────────╮'))
console.log(`${paint(P.attention, '│')} ${paint(P.attention, '提问 1/2', true)}`)
console.log(`${paint(P.attention, '│')} 这次要规划哪一件事？`)
console.log(`${paint(P.attention, '│')}`)
console.log(`${paint(P.attention, '│')} ${paint(P.attention, PANEL_CURSOR_MARK + ' 申请审批（推荐）', true)}`)
console.log(`${paint(P.attention, '│')} ${paint(P.dim, '   阶段 2 的剩余阻塞项')}`)
console.log(`${paint(P.attention, '│')}   先补文档`)
console.log(`${paint(P.attention, '│')}     ${paint(P.dim, '自己输入…')}`)
console.log(`${paint(P.attention, '╰────────────────────────────────────╯')}`)
console.log('')
if (displayWidth('测试') !== 4) console.log('⚠ 中文宽度计算异常')
