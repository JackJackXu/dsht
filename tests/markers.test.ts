// 标记（行首符号）的单测
//
// 为什么要测这个：整个界面的对齐是靠「标记宽度」手算出来的
// （layout.ts 里 clipping 用 displayWidth(prefix)，cursor.ts 里输入框前缀写死 2 列）。
// 只要混进一个全角字符（比如中文标点、某些 emoji），宽度就从 1 变 2，
// 所有续行的缩进、光标位置、工具行的裁剪会**集体**错位，而且看起来只是"有点歪"，
// 很难定位。所以这里直接把它锁死。
import {
  AGENT_MARK, ERR_MARK, SYS_MARK, THINK_MARK, TOOL_MARK, USER_MARK,
} from '../src/ui/layout.ts'
import { INPUT_PREFIX_WIDTH } from '../src/ui/cursor.ts'
import { PANEL_CURSOR_MARK } from '../src/ui/panels.ts'
import { AMBIGUOUS_AS_WIDE, displayWidth, isAmbiguousCodePoint } from '../src/ui/width.ts'

let pass = 0, fail = 0
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name) }
  else { fail++; console.log('  ✗', name, detail !== undefined ? `\n      ${detail}` : '') }
}

const marks: Array<[string, string]> = [
  ['USER_MARK（你）', USER_MARK],
  ['AGENT_MARK（智能体）', AGENT_MARK],
  ['TOOL_MARK（工具）', TOOL_MARK],
  ['THINK_MARK（思考）', THINK_MARK],
  ['SYS_MARK（系统）', SYS_MARK],
  ['ERR_MARK（错误）', ERR_MARK],
]

console.log('=== 每个标记都必须是 1 列宽（除非用户显式开了「不定宽按 2 列」）===')
for (const [name, m] of marks) {
  const bare = m.trim()
  const w = displayWidth(bare)
  const want = AMBIGUOUS_AS_WIDE && isAmbiguousCodePoint(bare.codePointAt(0)!) ? 2 : 1
  ok(`${name} 的「${bare}」是 ${want} 列`, w === want, `实际 ${w} 列（DSHT_AMBIGUOUS_WIDE=${process.env.DSHT_AMBIGUOUS_WIDE ?? '（未设）'}）`)
}

console.log('=== 六个标记的宽度必须**一致**，而且等于输入框前缀宽度 ===')
{
  // 这条比上面那条更本质：左边缘能不能对齐，只要求「所有标记一样宽」。
  //
  // 为什么单独拎出来：`width.ts` 有个 `DSHT_AMBIGUOUS_WIDE=2` 的开关，
  // 是给「终端把不定宽字符渲染成 2 列」的用户准备的正解。
  // 但 `●` 是不定宽、其余五个都是普通 ASCII —— 一开这个开关，
  // `●` 变 2 列而别人还是 1 列，**左边缘立刻参差**。
  // 早先这里硬断言「必须是 1 列」，于是那个开关一开测试就红，
  // 等于逃生门本身是坏的（外部评审发现）。
  // 现在改成断言「一致」，并在不一致时直接告诉用户该怎么办。
  // 这里比的是**符号本身**的宽度（不含后面那个空格）——「一致」是对符号说的
  const widths = marks.map(([name, m]) => ({ name, w: displayWidth(m.trim()) }))
  const uniq = [...new Set(widths.map(x => x.w))]
  ok(
    '六个标记宽度一致',
    uniq.length === 1,
    uniq.length === 1
      ? ''
      : '宽度不一致：' + widths.map(x => `${x.name.replace(/（.*/, '')}=${x.w}`).join(' ') +
        '\n      你的终端把「不定宽」字符渲染成了 2 列（所以 ● 比别的宽）。' +
        '\n      解法：把 TOOL_MARK 换成宽度确定的符号 —— 跑 `npm run markers` 看候选表和那把尺子。',
  )
  // 而行的缩进宽度是**整个标记**（符号 + 一个空格），输入框前缀也是这个含义
  for (const [name, m] of marks) {
    ok(`${name} 整段标记宽度 == 输入框前缀宽度（${INPUT_PREFIX_WIDTH}）`,
       displayWidth(m) === INPUT_PREFIX_WIDTH,
       `标记 ${JSON.stringify(m)} 实际 ${displayWidth(m)} 列`)
  }
}

console.log('=== 标记必须两两不同（同色区域内不能混淆）===')
{
  const bares = marks.map(([, m]) => m.trim())
  ok('六个行首标记互不相同', new Set(bares).size === bares.length, `实际：${bares.join(' ')}`)
  // 面板选中标记故意跟用户标记同符号，但它不在上面六个里，所以不冲突。
  ok('面板选中标记不占用行首标记以外的位置（只是复用用户标记）',
     bares.includes(PANEL_CURSOR_MARK))
}

console.log('=== 标记后面必须跟一个空格（跟正文分开）===')
for (const [name, m] of marks) {
  ok(`${name} 以空格结尾`, m.endsWith(' '), `实际：${JSON.stringify(m)}`)
}

console.log('=== 面板选中标记 = 用户标记（用户明确要求「跟①一致」）===')
// 用户挑⑦时选了「跟①一致」。这里把它做成**结构上**一致：
// PANEL_CURSOR_MARK 直接由 USER_MARK 推出，所以你改了用户标记，面板自动跟着变，
// 不会出现「改了⑦忘了改①」这种事。
ok('面板选中标记跟用户标记同符号', PANEL_CURSOR_MARK === USER_MARK.trimEnd(),
   `面板：${PANEL_CURSOR_MARK}  用户：${USER_MARK.trimEnd()}`)
ok('面板选中标记是 1 列宽', displayWidth(PANEL_CURSOR_MARK) === 1)
ok('面板选中标记后面没跟空格（面板代码自己补空格）', !PANEL_CURSOR_MARK.endsWith(' '))

console.log('=== 宽度必须是「确定的 1 列」，不能是「不定宽」===')
//
// 为什么这条最重要：Unicode 把一批符号的宽度留白（东亚宽度 A），让字体决定。
// 我们的算法只能猜 1 列；要是字体画成 2 列，整行的左边缘就参差 ——
// 而且测试会全绿，因为两边都「自认为」是对的。
// ※（U+203B）、≡（U+2261）、◆（U+25C6）都是这一类。
//
// 唯一的例外是 ●：用户亲眼确认过它在自己终端里是 1 列。
const VERIFIED_AMBIGUOUS: Record<string, string> = {
  '●': '用户实测：Windows Terminal 里就是 1 列',
}
for (const [name, m] of marks) {
  const bare = m.trim()
  const cp = bare.codePointAt(0)!
  const amb = isAmbiguousCodePoint(cp)
  const verified = VERIFIED_AMBIGUOUS[bare]
  ok(
    `${name} 宽度确定${verified !== undefined ? `（不定宽但已验证：${verified}）` : ''}`,
    !amb || verified !== undefined,
    amb ? `${bare} 是「东亚宽度 A」，字体说了算 —— 换一个确定 1 列的，或先亲眼验证再登记进 VERIFIED_AMBIGUOUS` : '',
  )
}

console.log('=== 不能有 ASCII 控制字符（会把光标搞乱）===')
for (const [name, m] of marks) {
  // eslint-disable-next-line no-control-regex
  ok(`${name} 不含控制字符`, !/[\u0000-\u001f\u007f]/.test(m))
}

console.log('')
console.log(`通过 ${pass} / ${pass + fail}`)
if (fail > 0) process.exitCode = 1
