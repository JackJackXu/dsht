// 算前景色在背景上的对比度（WCAG 公式）
//
// 跑法：npm run contrast
//
// WCAG 标准：正文 ≥ 4.5:1，大字/粗体 ≥ 3:1。
// 这些 hex 取自 Windows Terminal 默认主题 Campbell —— 你自己的主题可能不同，
// 所以数字只作参考，最终还得你眼睛看（终端主题是用户自己设的，我们管不着）。
//
// 注意：这个脚本只能验证「配色方案本身」，验证不了「你终端实际用了哪个主题」。
// 所以我们只用 16 基础色（不用真彩色），把决定权留给终端主题。

/** `#RRGGBB` */
type Hex = string

/** 把 #RRGGBB 拆成三个 0-255 的分量。 */
function hex2rgb(h: Hex): [number, number, number] {
  return [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ]
}

/** 单通道的线性化（WCAG 定义）。 */
function linearize(channel: number): number {
  const s = channel / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function luminance(h: Hex): number {
  const [r, g, b] = hex2rgb(h)
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)
}

function ratio(fg: Hex, bg: Hex): number {
  const a = luminance(fg)
  const b = luminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

function verdict(r: number): string {
  if (r >= 7) return '★★★★ 极清楚'
  if (r >= 4.5) return '★★★  达标'
  if (r >= 3) return '★★   勉强'
  return '★    太暗 ⚠️'
}

/** Windows Terminal 默认主题 Campbell 的 16 色。 */
const CAMPBELL: ReadonlyArray<readonly [string, Hex]> = [
  ['black', '#0C0C0C'], ['red', '#C50F1F'], ['green', '#13A10E'], ['yellow', '#C19C00'],
  ['blue', '#0037DA'], ['magenta', '#881798'], ['cyan', '#3A96DD'], ['white', '#CCCCCC'],
  ['gray (blackBright)', '#767676'], ['redBright', '#E74856'], ['greenBright', '#16C60C'],
  ['yellowBright', '#F9F1A5'], ['blueBright', '#3B78FF'], ['magentaBright', '#B4009E'],
  ['cyanBright', '#61D6D6'], ['whiteBright', '#F2F2F2'],
]

const DARK_BG: Hex = '#0C0C0C'
const LIGHT_BG: Hex = '#F2F2F2'

function table(title: string, bg: Hex, rows: ReadonlyArray<readonly [string, Hex]>): void {
  console.log(`\n  ── ${title}（背景 ${bg}）──`)
  for (const [name, hex] of rows) {
    const r = ratio(hex, bg)
    console.log(`  ${name.padEnd(22)} ${hex}  ${r.toFixed(2).padStart(5)}:1  ${verdict(r)}`)
  }
}

console.log('')
console.log('  颜色                  色值      对比度    评价')
table('Campbell 的 16 色', DARK_BG, CAMPBELL)

// dsht 实际用到的颜色。改动配色时看这里 —— 它跟 src/ui/theme.ts 是一一对应的，
// 所以下面这份清单是「当前决定」，不是候选。
table('dsht 深色主题用到的', DARK_BG, [
  ['user      = cyan', '#3A96DD'],
  ['agent     = white', '#CCCCCC'],
  ['tool      = green', '#13A10E'],
  ['thinking  = blueBright', '#3B78FF'],
  ['command   = blueBright', '#3B78FF'],
  ['error     = redBright', '#E74856'],
  ['dim/border= gray', '#767676'],
  ['attention = yellow', '#C19C00'],
])

// 浅色主题（DSHT_THEME=light）用白底，要单独算 —— 而且「越亮越清楚」这条
// 在白底上是**反的**，所以深色主题的颜色不能直接搬过去。
table('dsht 浅色主题用到的', LIGHT_BG, [
  ['user      = blue', '#0037DA'],
  ['agent     = black', '#0C0C0C'],
  ['tool      = green', '#13A10E'],
  ['thinking  = blue', '#0037DA'],
  ['command   = blue', '#0037DA'],
  ['error     = red', '#C50F1F'],
  ['dim/border= gray', '#767676'],
  ['attention = red', '#C50F1F'],
])

console.log('')
console.log('  ⚠ 浅色主题那一组请重点看 tool / error / attention：')
console.log('    白底上它们用的是跟深色主题同一档的颜色，某些主题下会比较糊。')
console.log('    默认主题是深色，浅色只在 DSHT_THEME=light 时启用。')
console.log('')
