import { sanitizeForDisplay } from './width.ts'

// 输入框的文本编辑器
//
// 支持光标移动（左右 / 跨行上下）与在光标处增删。
//
// 光标位置是**码点索引的近似**：移动和删除都按「一个码点」走，
// 不会把 emoji 这样的补充平面字符切成半个（那样发给模型的是残缺字符串）。
// 纯函数，无副作用，方便单独测试。
//
// 为什么只有这几个操作：键位是用户亲自定下来的，就这几种 ——
//   Enter 发送 · Ctrl+Enter 换行 · Ctrl+U 清空 · Ctrl+O 思考 · Ctrl+C 退出
//   Backspace 删左 · Delete 删右 · 方向键移动
// 早期这里还实现过一整套 readline（Ctrl+K/W/Y 剪切、Home/End、粘回来），
// 但那套键位被砍掉了，实现留着就变成没人调用的死代码 —— 而且会让人以为那些键有绑定。
// 真要用的时候再按当时的成本补回来。


export interface Editor {
  readonly text: string
  /** 光标位置（字符索引，0 ~ text.length） */
  readonly cursor: number
}

export const empty = (): Editor => ({ text: '', cursor: 0 })

/**
 * 光标左边那个字符的起点。
 *
 * 不能直接 `cursor - 1`：emoji 这类字符在 JS 字符串里占**两个** UTF-16 单元
 * （一对代理项），减 1 会停在中间，切出半个字符 —— 退格一次留下一个残缺的
 * 高代理项，而且这个残缺字符串会原样发给模型。
 */
function prevIndex(text: string, from: number): number {
  if (from <= 0) return 0
  const c = text.charCodeAt(from - 1)
  // 低代理项 → 前面那个是高代理项，两个一起跳
  if (c >= 0xdc00 && c <= 0xdfff && from >= 2) {
    const p = text.charCodeAt(from - 2)
    if (p >= 0xd800 && p <= 0xdbff) return from - 2
  }
  return from - 1
}

/** 光标右边那个字符的终点。跟 prevIndex 对称。 */
function nextIndex(text: string, from: number): number {
  if (from >= text.length) return text.length
  const c = text.charCodeAt(from)
  // 高代理项后面跟着低代理项 → 两个一起跳
  if (c >= 0xd800 && c <= 0xdbff && from + 1 < text.length) {
    const n = text.charCodeAt(from + 1)
    if (n >= 0xdc00 && n <= 0xdfff) return from + 2
  }
  return from + 1
}

/** 当前光标在哪一行、哪一列（按换行符切分）。 */
export function lineCol(editor: Editor): { line: number; col: number } {
  const before = editor.text.slice(0, editor.cursor)
  const line = before.split('\n').length - 1
  const col = before.length - (before.lastIndexOf('\n') + 1)
  return { line, col }
}

/** 所有行的起止索引。 */
function lineSpans(text: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = []
  let start = 0
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === '\n') {
      spans.push({ start, end: i })
      start = i + 1
    }
  }
  return spans
}

/**
 * 在光标处插入文本（可含换行）。
 *
 * 先过一遍 {@link sanitizeForDisplay}：键盘敲的单个字符无所谓，但**粘贴**进来的
 * 东西带着 `\r`、`\t` 之类的字符，它们的终端渲染宽度不可预测，
 * 留在草稿里会让折行和光标位置全算错。
 */
export function insert(editor: Editor, chunk: string): Editor {
  const clean = sanitizeForDisplay(chunk)
  const text = editor.text.slice(0, editor.cursor) + clean + editor.text.slice(editor.cursor)
  return { text, cursor: editor.cursor + clean.length }
}

/** 删掉光标左边一个字符（按码点，emoji 整个删掉而不是切一半）。 */
export function backspace(editor: Editor): Editor {
  if (editor.cursor === 0) return editor
  const at = prevIndex(editor.text, editor.cursor)
  return {
    text: editor.text.slice(0, at) + editor.text.slice(editor.cursor),
    cursor: at,
  }
}

/** 删掉光标右边一个字符（按码点）。 */
export function deleteForward(editor: Editor): Editor {
  if (editor.cursor >= editor.text.length) return editor
  const at = nextIndex(editor.text, editor.cursor)
  return {
    text: editor.text.slice(0, editor.cursor) + editor.text.slice(at),
    cursor: editor.cursor,
  }
}

export function moveLeft(editor: Editor): Editor {
  return editor.cursor === 0 ? editor : { ...editor, cursor: prevIndex(editor.text, editor.cursor) }
}

export function moveRight(editor: Editor): Editor {
  return editor.cursor >= editor.text.length
    ? editor
    : { ...editor, cursor: nextIndex(editor.text, editor.cursor) }
}

/**
 * 上下移动光标，尽量保持列不变（到短行尾就停在行尾）。
 * @param delta -1 上一行 / +1 下一行
 */
export function moveVertical(editor: Editor, delta: number): Editor {
  const spans = lineSpans(editor.text)
  const { line, col } = lineCol(editor)
  const target = line + delta
  if (target < 0 || target >= spans.length) return editor
  const span = spans[target]!
  const length = span.end - span.start
  return { ...editor, cursor: span.start + Math.min(col, length) }
}
