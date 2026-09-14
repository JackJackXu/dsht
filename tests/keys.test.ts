// 按键判断的单测
//
// 用例全部来自真实终端实测（--keydebug 的原始输出），防止以后改回去再踩坑。
// 实测环境：Windows 11 + Windows Terminal 系终端，Ink 7.x。
import { isCtrlChar, isNewlineKey, CR, LF } from '../src/ui/keys.ts'

let pass = 0, fail = 0
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; console.log('  ✓', name) }
  else { fail++; console.log('  ✗', name, '\n      得到', g, '\n      期望', w) }
}

console.log('=== 实测：回车类按键（原样复刻 --keydebug 输出）===')

// Enter        -> input="\r" flags=[return]
eq('Enter 不是换行（是发送）', isNewlineKey(CR, { return: true }), false)

// Shift+Enter  -> input="\r" flags=[return]   ← 与 Enter 完全相同
eq('Shift+Enter 在实测终端里无法区分（不是换行）', isNewlineKey(CR, { return: true }), false)

// Ctrl+Enter   -> input="\n" flags=[]
eq('Ctrl+Enter 是换行', isNewlineKey(LF, {}), true)

// Ctrl+J       -> input="\n" flags=[]
eq('Ctrl+J 是换行（与 Ctrl+Enter 同上报方式）', isNewlineKey(LF, {}), true)

console.log('=== 兼容少数会上报修饰键的终端 ===')
eq('Shift+Enter（会上报 shift 的终端）', isNewlineKey(CR, { return: true, shift: true }), true)
eq('Alt+Enter（会上报 meta 的终端）', isNewlineKey(CR, { return: true, meta: true }), true)
eq('Ctrl+Enter（上报成 return+ctrl 的终端）', isNewlineKey(CR, { return: true, ctrl: true }), true)
eq('普通字符不是换行', isNewlineKey('a', {}), false)
eq('空字符不是换行', isNewlineKey('', {}), false)

console.log('=== Ctrl+字母 的两种上报方式 ===')
eq("方式一：char='a' + ctrl 标志", isCtrlChar('a', { ctrl: true }, 'a'), true)
eq('方式一：大写也认', isCtrlChar('A', { ctrl: true }, 'a'), true)
eq('方式二：只送控制字符 0x01', isCtrlChar('\u0001', {}, 'a'), true)
eq('方式二：不带 ctrl 标志', isCtrlChar('\u000f', {}, 'o'), true)
eq('普通字母不算 Ctrl', isCtrlChar('a', {}, 'a'), false)
eq('别的字母不算', isCtrlChar('b', { ctrl: true }, 'a'), false)

console.log(`\n通过 ${pass} / ${pass + fail}`)
process.exit(fail === 0 ? 0 : 1)
