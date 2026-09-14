// 输入框的显示层：把文本 + 光标位置拆成「一行行可以直接渲染的文字」
//
// 为什么要自己折行：Ink 会自己折，但折完占几行我们事先不知道，
// 而布局高度必须精确（Ink 溢出时是挤压不是裁剪，见 cursor.ts 坑 2）。
// 自己按显示宽度折，行数和光标位置就都可控。
//
// 行就是普通字符串（不是「单元格数组」）—— 早期版本把每个字符包成
// `{ ch, cursor }` 对象，其中 cursor 字段从没被产品代码读过（真光标由终端画），
// 白算一遍还多一层间接。直接存字符串更简单，也少一个能出错的地方。

import { charWidth, displayWidth } from './width.ts'

export interface InputView {
  /** 可见的行（每行就是一段纯文本） */
  lines: string[]
  /** 顶部被折掉的行数 */
  hiddenAbove: number
  /** 光标在第几行（相对 lines） */
  cursorLine: number
  /** 光标在这行的第几个**字符**（不是列） */
  cursorCol: number
}

interface PhysicalLine {
  text: string
  /** 光标落在这个闭区间 [start, upper] 时算在这一行 */
  start: number
  upper: number
}

/** 把文本折成物理行，并给每行标出它「认领」的光标索引区间。 */
function buildPhysicalLines(text: string, width: number): PhysicalLine[] {
  const lines: PhysicalLine[] = []
  let buf = ''
  let bufWidth = 0
  let lineStart = 0

  const flush = (end: number, softWrapped: boolean): void => {
    // softWrapped：这一行是被**折行**切开的上半截，不是文本真正的行尾。
    // 区别很关键：折行处「行尾之后」和「下一行行首之前」是同一个位置，
    // 光标必须归给**下一行** —— 否则刚好填满一行时光标会画到内容区之外。
    lines.push({ text: buf, start: lineStart, upper: softWrapped ? end - 1 : end })
    buf = ''
    bufWidth = 0
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (ch === '\n') {
      // 换行符本身归上一行（光标可以停在它前面 = 真正的行尾）
      flush(i, false)
      lineStart = i + 1
      continue
    }
    const cw = charWidth(ch)
    if (bufWidth + cw > width && buf !== '') {
      flush(i, true)
      lineStart = i
    }
    buf += ch
    bufWidth += cw
  }
  flush(text.length, false)
  return lines
}

/**
 * 把文本按宽度折行，并标出光标位置。
 * @param maxLines 最多显示多少行（光标不可见时窗口向上滑）
 */
export function layoutInput(text: string, cursor: number, width: number, maxLines: number): InputView {
  const w = Math.max(4, width)
  const physical = buildPhysicalLines(text, w)

  // 找光标落在哪一行
  let cursorLine = physical.length - 1
  for (const [i, line] of physical.entries()) {
    if (cursor >= line.start && cursor <= line.upper) { cursorLine = i; break }
  }

  const line = physical[cursorLine]!
  // 光标列 = 光标之前那一段的**显示宽度**（不是字符个数，中文占 2 列）
  const before = text.slice(line.start, Math.min(cursor, text.length))
  const cursorCol = before.length

  // 光标不可见时，窗口向上滑
  const maxL = Math.max(1, maxLines)
  const hiddenAbove = Math.max(0, cursorLine - maxL + 1)
  const visible = physical.slice(hiddenAbove, hiddenAbove + maxL)

  return {
    lines: visible.map(l => l.text),
    hiddenAbove,
    cursorLine: cursorLine - hiddenAbove,
    cursorCol,
  }
}

/**
 * 光标之前那一段的显示宽度（列）。
 *
 * 单独抽出来是因为它必须和 cursorCol 用同一套折行结果 ——
 * 谁都不许自己再算一遍「光标在第几列」。
 */
export function cursorBeforeWidth(line: string, cursorCol: number): number {
  return displayWidth(line.slice(0, cursorCol))
}
