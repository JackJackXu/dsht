// 配色的单测
//
// 目的：保证语义令牌是齐的、映射是有效的。
// 令牌漏一个，界面上就会有一处掉色（undefined → 用终端默认色），很难发现。
import { DARK_PALETTE, LIGHT_PALETTE, activePalette, type Palette } from '../src/ui/theme.ts'

let pass = 0, fail = 0
function ok(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log('  ✓', name) }
  else { fail++; console.log('  ✗', name, extra ?? '') }
}

/** Ink/chalk 接受的 16 个基础色名 */
const BASE16 = new Set([
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'blackBright', 'gray', 'grey', 'redBright', 'greenBright', 'yellowBright',
  'blueBright', 'magentaBright', 'cyanBright', 'whiteBright',
])

const TOKENS: Array<keyof Palette> = [
  'user', 'agent', 'tool', 'thinking', 'error', 'dim', 'border', 'attention',
]

console.log('=== 令牌齐全 ===')
for (const [name, pal] of [['深色', DARK_PALETTE], ['浅色', LIGHT_PALETTE]] as const) {
  for (const token of TOKENS) {
    ok(`${name} 有 ${token}`, typeof pal[token] === 'string' && pal[token] !== '')
  }
}

console.log('=== 只用基础色（不用真彩色 / 256 色）===')
for (const [name, pal] of [['深色', DARK_PALETTE], ['浅色', LIGHT_PALETTE]] as const) {
  for (const token of TOKENS) {
    const v = pal[token]
    ok(`${name}.${token} = ${v} 是合法基础色`, BASE16.has(v), `实际 ${JSON.stringify(v)}`)
  }
}

console.log('=== attention 必须够醒目（它要在"需要你动手"时跳出来）===')
for (const [name, pal] of [['深色', DARK_PALETTE], ['浅色', LIGHT_PALETTE]] as const) {
  ok(`${name}: attention ≠ dim`, pal.attention !== pal.dim)
  ok(`${name}: attention ≠ border`, pal.attention !== pal.border)
}

console.log('=== 用户和智能体必须不同色（这是本界面的核心区分）===')
ok('深色下 user ≠ agent', DARK_PALETTE.user !== DARK_PALETTE.agent)
ok('浅色下 user ≠ agent', LIGHT_PALETTE.user !== LIGHT_PALETTE.agent)

// 用户实测 bright 太花眼，所以默认全用 base-16。
// 例外只有两个，都是「内容必须看清、而普通档对比度不达标」的情况：
//   · thinking —— 用户亲自挑的 blueBright（DeepSeek 品牌蓝 + CoT 致敬）。
//     普通蓝 2.38:1 → 亮蓝 4.95:1，是唯一能过 WCAG AA 的蓝。
//   · error    —— 普通红 3.23:1（勉强）→ 亮红 5.09:1（达标）。
//     依据跟 thinking 一样；错误是必须看清的东西，3.23:1 本来是这里最低的正文对比度之一。
// 两个例外都必须**在深色底上**成立；浅色底上「亮」反而更糊，所以那边维持普通档。
console.log('=== 不用 bright（用户实测 bright 太花眼）===')
const BRIGHT_EXCEPTIONS = ['thinking', 'error']
for (const [name, pal] of [['深色', DARK_PALETTE], ['浅色', LIGHT_PALETTE]] as const) {
  const brights = TOKENS.filter(t => pal[t].endsWith('Bright') && !BRIGHT_EXCEPTIONS.includes(t))
  ok(`${name} 里除 ${BRIGHT_EXCEPTIONS.join('/')} 外没有 bright 色`, brights.length === 0, `发现：${brights.join(', ')}`)
}
console.log('=== thinking：永远是蓝色家族 ===')
ok('深色底 thinking 用亮蓝', DARK_PALETTE.thinking === 'blueBright', `实际：${DARK_PALETTE.thinking}`)
// 白底上「越亮越看不清」，所以浅色主题必须反过来挑深档蓝。
ok('浅色底 thinking 用深蓝', LIGHT_PALETTE.thinking === 'blue', `实际：${LIGHT_PALETTE.thinking}`)
for (const [name, pal] of [['深色', DARK_PALETTE], ['浅色', LIGHT_PALETTE]] as const) {
  ok(`${name}: thinking 不是 magenta（用户讨厌洋红）`, pal.thinking !== 'magenta')
}

console.log('=== 环境变量切换 ===')
{
  const old = process.env.DSHT_THEME
  delete process.env.DSHT_THEME
  ok('默认是深色', activePalette() === DARK_PALETTE)
  process.env.DSHT_THEME = 'light'
  ok('DSHT_THEME=light 切浅色', activePalette() === LIGHT_PALETTE)
  process.env.DSHT_THEME = 'whatever'
  ok('无法识别的值回落到深色', activePalette() === DARK_PALETTE)
  if (old === undefined) delete process.env.DSHT_THEME
  else process.env.DSHT_THEME = old
}

console.log(`\n通过 ${pass} / ${pass + fail}`)
process.exit(fail === 0 ? 0 : 1)
