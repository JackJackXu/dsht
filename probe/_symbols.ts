// 符号候选图表：思考标记用哪个
//
// 跑法：npm run symbols
//
// 跟 `npm run markers` 的分工：
//   本脚本 = 符号**本身**的横向对照表（码点、宽度、长得像不像），用于挑符号；
//   markers = 每个标记**放进真实句子里**的样子，覆盖全部角色，用于看最终效果。
import { displayWidth } from '../src/ui/width.ts'

const ESC = '\u001b['
const R = '\u001b[0m'
const dim = (s: string) => `${ESC}90m${s}${R}`
const blue = (s: string) => `${ESC}34m${s}${R}`

interface Cand {
  ch: string
  name: string
  note: string
}

const candidates: Cand[] = [
  { ch: '✻', name: 'U+273B TEARDROP-SPOKED ASTERISK', note: 'Claude Code 用的就是这个' },
  { ch: '✽', name: 'U+273D HEAVY TEARDROP-SPOKED ASTERISK', note: '比上面粗一点' },
  { ch: '✳', name: 'U+2733 EIGHT SPOKED ASTERISK', note: '八芒星，某些终端会当 emoji 渲染' },
  { ch: '✺', name: 'U+273A SIXTEEN POINTED ASTERISK', note: '十六芒，太密' },
  { ch: '∗', name: 'U+2217 ASTERISK OPERATOR', note: '✅ 已选：数学符号，设计上就是居中的' },
  { ch: '*', name: 'U+002A ASTERISK', note: '★ 但等宽字体里偏上（不在中间）' },
  { ch: '+', name: 'U+002B PLUS SIGN', note: '居中、兼容性最好（候选过）' },
  { ch: '✦', name: 'U+2726 BLACK FOUR POINTED STAR', note: '四角星，很好看' },
  { ch: '✧', name: 'U+2727 WHITE FOUR POINTED STAR', note: '空心四角星' },
  { ch: '◈', name: 'U+25C8 DIAMOND IN DIAMOND', note: '菱形套菱形' },
  { ch: '◉', name: 'U+25C9 FISHEYE', note: '圆里套圆' },
  { ch: '⊙', name: 'U+2299 CIRCLED DOT OPERATOR', note: '数学符号，居中' },
  { ch: '※', name: 'U+203B REFERENCE MARK', note: '日文"注意"记号，偏大' },
  { ch: '·', name: 'U+00B7 MIDDLE DOT', note: '现在给系统消息用的' },

  // ── 箭头 / 旋转 / 其他（用户提到"不应该是箭头吗"，补上这一类）──
  { ch: '→', name: 'U+2192 RIGHTWARDS ARROW', note: '普通箭头' },
  { ch: '↦', name: 'U+21A6 RIGHTWARDS ARROW FROM BAR', note: '数学映射箭头' },
  { ch: '↻', name: 'U+21BB CLOCKWISE OPEN CIRCLE ARROW', note: '"重新处理"的意思' },
  { ch: '⟳', name: 'U+27F3 CLOCKWISE GAPPED CIRCLE ARROW', note: '"正在处理"—— 像加载图标' },
  { ch: '⟲', name: 'U+27F2 ANTICLOCKWISE GAPPED CIRCLE ARROW', note: '同上，反方向' },
  { ch: '⇢', name: 'U+21E2 RIGHTWARDS DASHED ARROW', note: '虚线箭头，轻一点' },
  { ch: '▸', name: 'U+25B8 BLACK RIGHT-POINTING SMALL TRIANGLE', note: '小三角（现在面板选中项用的就是这个）' },
  { ch: '▹', name: 'U+25B9 WHITE RIGHT-POINTING SMALL TRIANGLE', note: '空心小三角' },
  { ch: '»', name: 'U+00BB RIGHT-POINTING DOUBLE ANGLE QUOTATION', note: '双尖角' },
  { ch: '⋯', name: 'U+22EF MIDLINE HORIZONTAL ELLIPSIS', note: '居中省略号，"还在想"' },
  { ch: '∴', name: 'U+2234 THEREFORE', note: '数学"所以" —— 跟"推理"贴切' },
  { ch: '↯', name: 'U+21AF DOWNWARDS ZIGZAG ARROW', note: '闪电箭头' },
]

console.log('')
console.log(dim('━━━ 思考标记候选（看哪个居中、好看、宽度稳）━━━'))
console.log('')
console.log(dim('  符号   宽度   名称 / 备注'))
console.log(dim('  ─────────────────────────────────────────────────────────────'))
for (const c of candidates) {
  const w = displayWidth(c.ch)
  const flag = w === 2 ? dim('(2列)') : '     '
  console.log(`   ${blue(c.ch)}     ${flag} ${c.name}`)
  console.log(dim(`              ${c.note}`))
}
console.log('')
console.log(dim('━━━ 放进真实行里看（这才是最终效果）━━━'))
console.log(dim('    上半是星号/圆点类，下半是箭头/旋转类'))
console.log('')
for (const c of candidates) {
  console.log(`${blue(c.ch + ' 思考 ')}${dim('已折叠（Ctrl+O 展开）')}`)
}
console.log('')
console.log(dim('  上面的行如果参差不齐，就是符号宽度不一致导致的。'))
console.log(dim('  注意看「思考」两个字有没有对齐。'))
console.log('')
