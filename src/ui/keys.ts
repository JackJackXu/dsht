// 按键判断
//
// 单独抽出来的原因：终端对修饰键的上报差异极大，这里踩过坑。
// 实测数据见 docs/TERMINAL-KEYS.md。

/** Ink 传给 useInput 的 key 对象（只列我们用到的字段）。 */
export interface KeyFlags {
  ctrl?: boolean
  shift?: boolean
  meta?: boolean
  return?: boolean
  escape?: boolean
  tab?: boolean
  backspace?: boolean
  delete?: boolean
  upArrow?: boolean
  downArrow?: boolean
  leftArrow?: boolean
  rightArrow?: boolean
  pageUp?: boolean
  pageDown?: boolean
}

/** 回车发的字符（CR）。 */
export const CR = '\r'
/** 换行发的字符（LF）。 */
export const LF = '\n'

/**
 * 判断是不是一个「控制键 + 字母」。
 *
 * 不同终端有两种上报方式：
 *   1. char = 'a' 且 key.ctrl = true
 *   2. char = '\u0001'（控制字符本身），key.ctrl 可能为 undefined
 * 两种都认。
 */
export function isCtrlChar(char: string, key: KeyFlags, letter: string): boolean {
  if (key.ctrl !== true) {
    // 有些终端只送控制字符，不带 ctrl 标志
    return char === String.fromCharCode(letter.toLowerCase().charCodeAt(0) - 96)
  }
  return char === letter
    || char === letter.toUpperCase()
    || char === String.fromCharCode(letter.toLowerCase().charCodeAt(0) - 96)
}

/**
 * 判断是不是「插入换行」而不是「发送」。
 *
 * 实测（Windows Terminal 系，见 docs/TERMINAL-KEYS.md）：
 *   - Enter        送 CR，key.return = true
 *   - Shift+Enter  送的东西与 Enter **完全相同**（终端不上报 Shift）→ 无法区分
 *   - Ctrl+Enter   送 LF，key.return = false        → 可用
 *   - Ctrl+J       送 LF，key.return = false        → 可用（与 Ctrl+Enter 同义）
 *   - Alt+Enter    被终端自己吃掉，送不到程序
 *
 * 所以主要靠「送的是 LF」来判断；同时兼容少数会上报修饰键的终端。
 */
export function isNewlineKey(char: string, key: KeyFlags): boolean {
  if (char === LF) return true // Ctrl+Enter / Ctrl+J —— 主路径
  if (isCtrlChar(char, key, 'j')) return true
  if (key.return === true && (key.shift === true || key.meta === true || key.ctrl === true)) return true
  return false
}
