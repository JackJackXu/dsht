// 编辑器与输入框渲染的单测
// 跑法：npm test
import * as ed from '../src/ui/editor.ts'
import { layoutInput } from '../src/ui/input.ts'

let pass = 0, fail = 0
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; console.log('  ✓', name) }
  else { fail++; console.log('  ✗', name, '\n      得到', g, '\n      期望', w) }
}

console.log('=== 基本编辑 ===')
let e = ed.empty()
e = ed.insert(e, '你好')
eq('插入后光标在末尾', e, { text: '你好', cursor: 2 })
e = ed.insert(e, '\n世界')
eq('插入换行', e, { text: '你好\n世界', cursor: 5 })
eq('lineCol', ed.lineCol(e), { line: 1, col: 2 })
eq('上移保持列', ed.lineCol(ed.moveVertical(e, -1)), { line: 0, col: 2 })
e = ed.insert(e, '1234567')
eq('长行 lineCol', ed.lineCol(e), { line: 1, col: 9 })
eq('上移到短行尾', ed.lineCol(ed.moveVertical(e, -1)), { line: 0, col: 2 })
eq('backspace', ed.backspace({ text: 'abc', cursor: 2 }), { text: 'ac', cursor: 1 })
eq('backspace 在开头是空操作', ed.backspace({ text: 'abc', cursor: 0 }), { text: 'abc', cursor: 0 })
eq('deleteForward', ed.deleteForward({ text: 'abc', cursor: 1 }), { text: 'ac', cursor: 1 })
eq('deleteForward 在末尾是空操作', ed.deleteForward({ text: 'abc', cursor: 3 }), { text: 'abc', cursor: 3 })
eq('moveLeft', ed.moveLeft({ text: 'abc', cursor: 2 }), { text: 'abc', cursor: 1 })
eq('moveLeft 在开头是空操作', ed.moveLeft({ text: 'abc', cursor: 0 }), { text: 'abc', cursor: 0 })
eq('moveRight', ed.moveRight({ text: 'abc', cursor: 1 }), { text: 'abc', cursor: 2 })
eq('moveRight 在末尾是空操作', ed.moveRight({ text: 'abc', cursor: 3 }), { text: 'abc', cursor: 3 })
eq('取消草稿', ed.empty(), { text: '', cursor: 0 })

/** 光标必须落在可见范围内（行号和列号都要合理） */
function okCursorVisible(v: { lines: string[]; cursorLine: number; cursorCol: number }) {
  eq('光标行在可见范围内', v.cursorLine >= 0 && v.cursorLine < v.lines.length, true)
  eq('光标列不超过该行长度', v.cursorCol >= 0 && v.cursorCol <= (v.lines[v.cursorLine] ?? '').length, true)
}

console.log('=== 输入框渲染 ===')
let v = layoutInput('abc', 1, 20, 6)
eq('单行', v.lines, ['abc'])
eq('光标列', v.cursorCol, 1)
eq('光标在第 1 个字符前', v.cursorCol, 1)

v = layoutInput('abc\ndef', 4, 20, 6)
eq('两行', v.lines, ['abc', 'def'])
eq('光标在第二行', v.cursorLine, 1)
eq('光标列=0', v.cursorCol, 0)

v = layoutInput('你好世界', 2, 4, 6)
eq('中文折行（宽度 4 → 每行 2 字）', v.lines, ['你好', '世界'])
// 光标在 index 2 = 「世」之前 → 属于**第二行行首**，不是第一行行尾。
// 早先这里断言的是 0（第一行），那是错的：宽 4 的行已经满了，
// 光标画在第一行第 4 列会跑到内容区外面（压到内边距/边框上）。
eq('中文折行时光标归下一行', v.cursorLine, 1)
eq('中文折行时光标在行首', v.cursorCol, 0)

v = layoutInput('', 0, 20, 6)
eq('空输入至少一行', v.lines.length, 1)
eq('空输入光标在第 0 列', v.cursorCol, 0)

v = layoutInput('a\nb\nc\nd\ne\nf\ng', 12, 20, 3)
eq('超出时窗口滑动', v.lines.length, 3)
okCursorVisible(v)

v = layoutInput('abcdefghij', 10, 5, 6)
okCursorVisible(v)

console.log('=== emoji / 代理对：不能切一半 ===')
{
  // 😀 在 JS 字符串里占两个 UTF-16 单元。按单元加减会把代理对切一半，
  // 切出来的残缺字符串会原样发给模型。
  const e = ed.insert(ed.empty(), 'a😀b')
  eq('插入后长度按单元算', e.text.length, 4)
  eq('光标在末尾', e.cursor, 4)

  const left = ed.moveLeft(e)
  eq('左移一格跳过整个 emoji', left.cursor, 3)
  const left2 = ed.moveLeft(left)
  eq('再左移一格到 a 之后', left2.cursor, 1)

  // 先把光标移到 b 前面（= emoji 之后），这时退格才该删 emoji
  const beforeB = ed.moveLeft(e)
  eq('移到 b 之前', beforeB.cursor, 3)
  const del = ed.backspace(beforeB)
  eq('退格删掉整个 emoji', del.text, 'ab')
  eq('退格后光标位置', del.cursor, 1)
  // 末尾退格只删一个普通字符，不该动 emoji
  eq('末尾退格只删 b', ed.backspace(e).text, 'a😀')

  const fwd = ed.deleteForward(ed.moveLeft(ed.moveLeft(e)))
  eq('右删删掉整个 emoji', fwd.text, 'ab')
  eq('右删后光标不动', fwd.cursor, 1)

  // 反复退格必须能把字符串清干净（不能留下半个代理项）
  let x = ed.insert(ed.empty(), '😀😀😀')
  for (let i = 0; i < 3; i++) x = ed.backspace(x)
  eq('三次退格清空', x.text, '')
  eq('没有残留代理项', /[\uD800-\uDFFF]/.test(x.text), false)
}

console.log('=== 粘贴：控制字符必须清掉（它们的渲染宽度不可预测）===')
{
  eq('CRLF 归一成 LF', ed.insert(ed.empty(), 'a\r\nb').text, 'a\nb')
  eq('单独的 CR 也归一', ed.insert(ed.empty(), 'a\rb').text, 'a\nb')
  eq('制表符换成两个空格', ed.insert(ed.empty(), 'a\tb').text, 'a  b')
  eq('响铃/退格/NUL 直接丢掉', ed.insert(ed.empty(), 'a\u0007b\u0008c\u0000d').text, 'abcd')
  eq('中文和换行保留', ed.insert(ed.empty(), '中文\n下一行').text, '中文\n下一行')
  // 光标要跟着规整后的长度走，否则粘贴完光标位置就错了
  const pasted = ed.insert(ed.empty(), 'a\tb')
  eq('光标按规整后的长度算', pasted.cursor, pasted.text.length)
}

console.log(`\n通过 ${pass} / ${pass + fail}`)
process.exit(fail === 0 ? 0 : 1)
