// 终端里的字符宽度计算
//
// 终端里 CJK 字符和全角标点占 2 列，其余占 1 列。
// 想对齐、想换行、想截断，都必须按「显示宽度」算，不能用 String.length。
//
// 范围表是**自动生成**的（src/ui/unicode-width.ts），因为手写必然漏 ——
// 本项目第一版就漏掉了整个 0x2000-0x2E7F 段，而 ※ … → “” 全在里面。
import { AMBIGUOUS, WIDE, ZERO } from './unicode-width.ts'

/** 在有序区间表里查码点。二分，因为表有几百段。 */
function inRanges(cp: number, ranges: ReadonlyArray<readonly [number, number]>): boolean {
  let lo = 0
  let hi = ranges.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const [a, b] = ranges[mid]!
    if (cp < a) hi = mid - 1
    else if (cp > b) lo = mid + 1
    else return true
  }
  return false
}

/**
 * 东亚宽度 A（Ambiguous）按几列算。
 *
 * 这类字符的宽度**没有唯一答案** —— Unicode 故意留白，让字体决定
 * （CJK 字体通常画 2 列，拉丁字体画 1 列）。所以只能选一个默认值，
 * 出问题时用环境变量覆盖。
 *
 * 默认 1：Windows Terminal 的默认设置是 1，而且用户实测 ● 就是 1 列。
 */
export const AMBIGUOUS_AS_WIDE = process.env.DSHT_AMBIGUOUS_WIDE === '2'

/** 这个码点是不是「宽度不定」。标记符号如果落在这一类，必须亲眼验证。 */
export function isAmbiguousCodePoint(cp: number): boolean {
  return inRanges(cp, AMBIGUOUS)
}

/** 一个字符占几列。 */
export function charWidth(ch: string): number {
  const cp = ch.codePointAt(0)!
  // 组合符号（变音符号等）叠在前一个字符上，不占位
  if (inRanges(cp, ZERO)) return 0
  // 东亚宽度 W/F 一定是 2 列
  if (inRanges(cp, WIDE)) return 2
  // 不定宽：字体说了算，按配置算
  if (inRanges(cp, AMBIGUOUS)) return AMBIGUOUS_AS_WIDE ? 2 : 1
  return 1
}

/**
 * 把文本里「终端渲染宽度无法预测」的字符换成可预测的。
 *
 * 为什么必须做：折行、对齐、截断全靠列宽算得准，但有几类字符的宽度根本不是固定的 ——
 *   - `\r`：Windows 剪贴板的多行文本是 `\r\n`，终端有时只给 `\r`。
 *     我们按 1 列算，终端却拿它当「回到行首」，整行就画花了。
 *   - `\t`：终端按**制表位**渲染，占几列取决于此刻在第几列。
 *     代码块里的缩进几乎全是 tab，这是最常见的错位来源。
 *   - 其余 C0/C1 控制符（响铃、退格、NUL…）：宽度无定义，只会添乱。
 *
 * 保留 `\n`：换行是我们自己管的（折行、多行输入都靠它）。
 */
export function sanitizeForDisplay(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')       // \r\n 和单独的 \r 都当换行
    .replace(/\t/g, '  ')          // 制表符换成两个空格
    // 其余控制字符丢掉（\n 保留、\r 和 \t 上面已处理）
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '')
}

/** 一段文本的显示宽度。 */
export function displayWidth(text: string): number {
  let w = 0
  for (const ch of text) w += charWidth(ch)
  return w
}

/**
 * 只保留前 maxLines 行；被截断时在末行末尾加省略号。
 *
 * 为什么要这个：Ink 的 Text 会自己折行，折几行我们事先不知道，
 * 而布局高度必须精确 —— 所以宁可主动截断，也不要让内容长出计划高度
 * （Ink 溢出时不是裁剪而是挤压，见 cursor.ts 坑 2）。
 *
 * 加省略号时用 clip 兜一下，保证**不会因为加了省略号反而多占一列**。
 * 注意它必须放在 displayWidth/clip 之后 —— 它依赖这两个。
 */
export function capLines(lines: readonly string[], maxLines: number, width: number): string[] {
  if (maxLines <= 0) return []
  if (lines.length <= maxLines) return [...lines]
  const kept = lines.slice(0, maxLines)
  kept[maxLines - 1] = clip(`${kept[maxLines - 1] ?? ''}…`, width)
  return kept
}

/** 按显示宽度截断，超出时加省略号。 */
export function clip(text: string, maxWidth: number): string {
  // 宽度 <= 0 时什么都不该画 —— 否则下面的 maxWidth - 1 会变成负数，
  // 函数退化成「返回一个省略号」，在零宽的位置硬塞 1 列进去。
  if (maxWidth <= 0) return ''
  if (displayWidth(text) <= maxWidth) return text
  let out = ''
  let w = 0
  for (const ch of text) {
    const cw = charWidth(ch)
    if (w + cw > maxWidth - 1) return out + '…'
    out += ch
    w += cw
  }
  return out
}

/**
 * 按显示宽度折行。
 * @param text 原文（可含换行，会被拆开）
 * @param width 可用宽度（列）
 * @returns 若干行
 */
export function wrapText(text: string, width: number): string[] {
  const maxWidth = Math.max(1, width)
  const out: string[] = []

  for (const paragraph of String(text).split('\n')) {
    if (paragraph === '') { out.push(''); continue }

    // 把「一个词 + 它后面的空白」当成一个整体，这样断行只发生在**词与词之间**。
    //
    // 为什么必须这样：早先这里是纯逐字符折行，于是英文单词会被从中间劈开 ——
    // 实测 `poli|cy`、`writin|g`、`rea|ding`。
    // 命令说明、工具名、服务端报错全是英文，被劈开之后非程序员读起来很费劲。
    // 中日韩本来就没空格，整段会是一个「词」，下面有逐字兜底。
    const units = paragraph.match(/\S+\s*/g) ?? [paragraph]
    let line = ''
    let lineWidth = 0

    const flush = (): void => {
      // 行尾空白不留 —— 否则每行末尾都挂一个看不见的空格
      out.push(line.replace(/\s+$/, ''))
      line = ''
      lineWidth = 0
    }
    /** 逐字兜底：这个词本身就比一整行还宽（长中文句、长 URL、长路径） */
    const breakByChar = (unit: string): void => {
      for (const ch of unit) {
        const cw = charWidth(ch)
        // line 为空时不能 flush（会推出一个空行）；宁可让这一个字超宽
        if (line !== '' && lineWidth + cw > maxWidth) flush()
        line += ch
        lineWidth += cw
      }
    }

    for (const unit of units) {
      const uw = displayWidth(unit)
      if (lineWidth + uw <= maxWidth) {
        line += unit
        lineWidth += uw
        continue
      }
      if (line !== '') flush()
      if (uw <= maxWidth) {
        line = unit
        lineWidth = uw
      } else {
        breakByChar(unit)
      }
    }
    if (line !== '') flush()
  }
  return out
}
