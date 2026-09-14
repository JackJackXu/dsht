// 标识符（标记）候选清单 —— 把系统里每一个标记列出来，逐个给候选
//
// 跑法：npm run markers
import { activePalette } from '../src/ui/theme.ts'
import {
  AGENT_MARK,
  ERR_MARK,
  SYS_MARK,
  THINK_MARK,
  TOOL_MARK,
  USER_MARK,
} from '../src/ui/layout.ts'
import { displayWidth, isAmbiguousCodePoint } from '../src/ui/width.ts'

const ESC = '\u001b['
const R = '\u001b[0m'
const CODES: Record<string, number> = {
  black: 30, red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36, white: 37,
  gray: 90, blackBright: 90,
}
const paint = (name: string | undefined, s: string): string =>
  name === undefined ? s : `${ESC}${CODES[name] ?? 39}m${s}${R}`
const dim = (s: string) => paint('gray', s)

const P = activePalette()

// 面板选中项的标记在 src/ui/panels.ts 里。跑一下脚本确认没有漂移：
//   grep -rn '▸' src/ui/panels.ts
const PANEL_CURSOR_MARK = '▸ '

interface Role {
  label: string
  current: string
  /** 标记后面跟的示例文字 */
  sample: string
  /** 用什么颜色渲染这个标签（跟真实界面一致） */
  color: string
  /** 无标记时的示例（靠缩进） */
  indentAlt?: boolean
  candidates: Array<{ ch: string; note?: string }>
}

const roles: Role[] = [
  {
    label: '你说的话',
    current: USER_MARK,
    sample: '帮我看看这个报告',
    color: P.user,
    candidates: [
      { ch: USER_MARK, note: '现在用的（也是 Claude Code 的）' },
      { ch: '» ', note: '双尖角，比 > 更有"我说"的气势' },
      { ch: '❯ ', note: '粗箭头，很多现代 CLI 的提示符' },
      { ch: '› ', note: '细尖角，轻' },
      { ch: '▸ ', note: '小三角' },
      { ch: '≡ ', note: '三条横线，像"输入行"' },
      { ch: '$ ', note: '经典 shell 提示符' },
      { ch: '： ', note: '中文冒号，占 2 列' },
    ],
  },
  {
    label: '智能体说的话',
    current: AGENT_MARK,
    sample: '好的，我先读一下。',
    color: P.agent,
    indentAlt: true,
    candidates: [
      { ch: AGENT_MARK, note: '现在用的（语义上偏"近似/家目录"，评审说不够直观）' },
      { ch: '< ', note: '跟 > 成对（用户 >，智能体 <）' },
      { ch: '« ', note: '跟 » 成对' },
      { ch: '= ', note: '等号，中性（你现在的选择）' },
      { ch: '≡ ', note: '恒等于 / 三条横线 —— 已否决：宽度不定（同 ※）' },
      { ch: '- ', note: '短横线，最轻' },
      { ch: ': ', note: '冒号，"接下来是"' },
      { ch: '▏ ', note: '细竖线' },
      { ch: '', note: '不用标记，纯靠缩进 —— 最安静（见最下面）' },
    ],
  },
  {
    label: '工具调用',
    current: TOOL_MARK,
    sample: 'read  report.md',
    color: P.tool,
    candidates: [
      { ch: TOOL_MARK, note: '现在用的（大圆点，你说没问题）' },
      { ch: '⚙ ', note: '齿轮，语义最准 —— 但可能被当 emoji' },
      { ch: '◆ ', note: '实心菱形' },
      { ch: '◈ ', note: '空心菱形' },
      { ch: '▣ ', note: '实心方框' },
      { ch: '▶ ', note: '实心三角' },
      { ch: '◉ ', note: '同心圆' },
      { ch: '⬢ ', note: '六边形' },
    ],
  },
  {
    label: '思考过程',
    current: THINK_MARK,
    sample: '已折叠（Ctrl+O 展开）',
    color: P.thinking,
    candidates: [
      { ch: THINK_MARK, note: '现在用的（数学星号，居中）' },
      { ch: '✻ ', note: 'Claude Code 用的' },
      { ch: '✦ ', note: '四角星' },
      { ch: '⟳ ', note: '旋转箭头，"正在想"' },
      { ch: '⋯ ', note: '居中省略号' },
      { ch: '∴ ', note: '数学"所以"，跟推理贴切' },
      { ch: '※ ', note: '日文「米印」—— 已否决：宽度不定，兼容性差' },
      { ch: '🌀', note: '（emoji，别用）' },
    ],
  },
  {
    label: '系统消息（命令反馈）',
    current: SYS_MARK,
    sample: '/plan  → Plan mode on',
    color: P.dim,
    candidates: [
      { ch: SYS_MARK, note: '短横线 —— 你现在的选择；跟 ● 完全不同形' },
      { ch: '‣ ', note: '小三角点' },
      { ch: '◦ ', note: '空心小圆' },
      { ch: '┆ ', note: '虚线竖线' },
      { ch: '∣ ', note: '细竖线' },
      { ch: ': ', note: '冒号' },
      { ch: '» ', note: '双尖角' },
    ],
  },
  {
    label: '错误',
    current: ERR_MARK,
    sample: '读取失败：permission denied',
    color: P.error,
    candidates: [
      { ch: '! ', note: '单感叹号 —— 你要改回这个；宽度确定，最安全' },
      { ch: '⁉ ', note: '问叹号（宽度不定）' },
      { ch: '✗ ', note: '叉号' },
      { ch: '× ', note: '乘号，比 ✗ 轻，但宽度不定' },
      { ch: '▲ ', note: '三角警告' },
      { ch: ERR_MARK, note: '双感叹号（现在用的）' },
      { ch: '⚠ ', note: '警告符号 —— 可能被当 emoji' },
    ],
  },
  {
    label: '面板选中项',
    current: PANEL_CURSOR_MARK,
    sample: '审批面板（推荐）',
    color: P.attention,
    candidates: [
      { ch: PANEL_CURSOR_MARK, note: '现在用的（小三角）' },
      { ch: '> ', note: '跟用户标记一致' },
      { ch: '→ ', note: '箭头' },
      { ch: '❯ ', note: '粗箭头' },
      { ch: '▪ ', note: '小方块' },
      { ch: '» ', note: '双尖角' },
    ],
  },
]

// --write：把同一份内容（去掉颜色）写进 docs/MARKERS.md，
// 这样文档永远跟这个脚本一致，不用手抄。
const out: string[] = []
const emit = (s: string) => { out.push(s); console.log(s) }

emit('')
emit(dim('━━━ 系统里所有标识符的候选 ━━━'))
emit(dim('    每一组都是同一句话，只换开头的标记。你看哪个顺眼。'))
emit('')

for (const role of roles) {
  emit('')
  emit(dim('──────────────────────────────────────────────────────────'))
  emit(`  ${role.label}    ${dim(`现在用：${JSON.stringify(role.current)}`)}`)
  emit('')
  for (const c of role.candidates) {
    const mark = c.ch
    const bare = mark.trim()
    const w = bare === '' ? 0 : displayWidth(bare)
    const size = bare === '' ? dim('无标记 ') : w >= 2 ? dim(' 2列 ') : dim(' 1列 ')
    // 码点也列出来 —— 想换的时候可以直接说「用 U+273B 那个」，不用描述长相
    const code = bare === ''
      ? '        '
      : 'U+' + bare.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')
    const amb = bare !== '' && isAmbiguousCodePoint(bare.codePointAt(0)!)
    // 「宽度不定」是真正的坑：Unicode 故意不给答案，字体说了算。
    // 一旦它在你终端里是 2 列而我们的算法按 1 列算，整行就歪。
    const flag = `${size}${code} ${amb ? paint(P.attention, '⚠宽度不定 ') : ''}`
    const isCurrent = mark === role.current
    const star = isCurrent ? paint(P.attention, ' ←现在') : ''
    emit(`    ${paint(role.color, mark + role.sample)}${star}`)
    emit(`    ${flag}${dim(c.note ?? '')}`)
  }
  if (role.indentAlt === true) {
    emit('')
    emit(dim('    【无标记 + 缩进的样子】'))
    emit(`      ${paint(role.color, role.sample)}`)
    emit(`      ${dim('第二行也这样缩进')}`)
  }
}

emit('')
emit(dim('──────────────────────────────────────────────────────────'))
emit(dim('  说明：标「2列」的是全角字符，占两个字符宽度；'))
emit(dim('        没有标注的都是 1 列（在大多数终端里）。'))
emit(dim('        带 emoji 风险的（⚙ ⚠ 🌀）在不同终端里可能显示成彩色图片，慎用。'))
emit(dim('        只挑符号本身（不看句子）时用 npm run symbols。'))

// ── 宽度自检 ───────────────────────────────────────────────
//
// 有些符号（∗ ‼ ‣ 等）在 Unicode 里是「东亚宽度不定」的，
// 有的终端/字体会画成 2 列。我们的列宽算法只能猜，猜错就全盘错位。
// 所以给你一条尺子：下面每行的 | 必须在你的终端里对齐成一竖列。
// 哪个偏了，哪个符号在你这里就是 2 列，不能用作标记。
emit('')
emit(dim('━━━ 宽度自检（你亲眼看一下）━━━'))
emit('')
emit(dim('  下面每行的 | 应该上下对齐成一竖列。'))
emit(dim('  哪个偏了一格，那个符号在你终端里就是 2 列宽，不能用。'))
emit('')
for (const [name, m] of [
  ['你说的话', USER_MARK],
  ['智能体', AGENT_MARK],
  ['工具', TOOL_MARK],
  ['思考', THINK_MARK],
  ['系统', SYS_MARK],
  ['错误 现在', ERR_MARK],
  ['②提议 ≡', '≡ '],
  ['⑤提议 ※', '※ '],
  ['⑥提议 !', '! '],
  ['（对照 1 列）', 'a '],
  ['（对照 2 列）', '中'],
] as Array<[string, string]>) {
  emit(`  ${m}1234567890|${dim('   ← ' + name)}`)
}
emit('')
emit(dim('  最后两行是参照物：a 一定是 1 列，中 一定是 2 列。'))
emit(dim('  凡是跟「中」那行偏一样多的，那个符号在你终端里就是 2 列 —— 不能用。'))
emit(dim('  特别注意 ≡ 和 ※ 这两行：它们在 Unicode 里是「不定宽」，字体说了算。'))
emit('')

if (process.argv.includes('--write')) {
  const fs = await import('node:fs')
  const target = new URL('../docs/MARKERS.md', import.meta.url)
  const NL = String.fromCharCode(10)
  const header = [
    '# 界面标记的候选清单',
    '',
    '> 这份文件由 `npm run markers:write` **自动生成**，不要手改。',
    '> 改标记请改 `src/ui/layout.ts` 里的常量，然后重新生成。',
    '',
    '```text',
    '',
  ].join(NL)
  // 剥掉 ANSI 颜色码 —— 存文件的是纯文本
  // eslint-disable-next-line no-control-regex
  const stripAnsi = (t: string) => t.replace(/\u001b\[[0-9;]*m/g, '')
  fs.writeFileSync(target, header + stripAnsi(out.join(NL)) + NL + '```' + NL, 'utf8')
  console.log('')
  console.log('已写入 docs/MARKERS.md')
}
