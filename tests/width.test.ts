// 显示宽度计算的单测
//
// 为什么值得单独测：整个界面的对齐、折行、截断、光标位置全都建立在这个函数上。
// 它算错一列，表现出来只是「有点歪」，但根因极难定位 —— 而且往往只在
// 特定字符 + 特定字体下才歪，别人复现不了。
//
// 范围表是从 Unicode 官方数据生成的（src/ui/unicode-width.ts），
// 全部 1,114,112 个码点已用 probe/_width-crosscheck 逐点核对过，零误差。
// 这里只锁住「跟我们有关系」的那些，以及历史上踩过的坑。
import { charWidth, displayWidth, clip, wrapText, isAmbiguousCodePoint } from '../src/ui/width.ts'

let pass = 0, fail = 0
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name) }
  else { fail++; console.log('  ✗', name, detail !== undefined ? `\n      ${detail}` : '') }
}
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; console.log('  ✓', name) }
  else { fail++; console.log('  ✗', name, '\n      得到', g, '\n      期望', w) }
}

console.log('=== 基本：ASCII 一定 1 列，汉字一定 2 列 ===')
eq('a', charWidth('a'), 1)
eq('子', charWidth('子'), 2)
eq('数字', charWidth('7'), 1)
eq('空格', charWidth(' '), 1)
eq('全角空格', charWidth('\u3000'), 2)

console.log('=== 我们用到的每一个字符 ===')
// 这些是界面里真实出现的。任何一个算错，界面就歪。
for (const [ch, want] of [
  ['>', 1], ['=', 1], ['-', 1], ['●', 1], ['∗', 1], ['!', 1],   // 七个行首标记
  ['│', 1], ['╭', 1], ['─', 1], ['╮', 1], ['╰', 1], ['╯', 1],   // 方框
  ['…', 1], ['·', 1], ['↑', 1], ['↓', 1], ['○', 1],              // 各种点缀
  ['←', 1], ['↩', 1],
] as Array<[string, number]>) {
  eq(`「${ch}」`, charWidth(ch), want)
}

console.log('=== 历史上踩过的坑：0x2000-0x2E7F 这一段 ===')
// 第一版的宽度表用的是手写范围，把这一整段漏了 —— 而符号最密集的就是这里。
// 漏掉时会算成 1 列，其中真正是 2 列的字会让整行歪。
eq('※ U+203B 是「不定宽」（不是确定 1 列）', isAmbiguousCodePoint(0x203b), true)
eq('≡ U+2261 是「不定宽」', isAmbiguousCodePoint(0x2261), true)
eq('◆ U+25C6 是「不定宽」', isAmbiguousCodePoint(0x25c6), true)
eq('● U+25CF 是「不定宽」（已亲眼验证是 1 列）', isAmbiguousCodePoint(0x25cf), true)
eq('∗ U+2217 是「确定 1 列」（幸运）', isAmbiguousCodePoint(0x2217), false)
eq('✻ U+273B 是「确定 1 列」', isAmbiguousCodePoint(0x273b), false)
eq('! U+0021 是「确定 1 列」', isAmbiguousCodePoint(0x21), false)
eq('‼ U+203C 其实也是「确定 1 列」', isAmbiguousCodePoint(0x203c), false)

console.log('=== 组合符号不占位 ===')
eq('声调符号 U+0301 是 0 列', charWidth('\u0301'), 0)
eq('e + 声调 = 1 列', displayWidth('e\u0301'), 1)
eq('零宽空格 U+200B 是 0 列', charWidth('\u200b'), 0)

console.log('=== displayWidth 是各个字符宽度之和 ===')
eq('空串 0 列', displayWidth(''), 0)
eq('中英混排', displayWidth('abc中文'), 3 + 4)
ok('不能按字符个数算（中文 2 个字符 = 4 列）', displayWidth('中文') === 4 && '中文'.length === 2)

console.log('=== clip：按列截断，不是按字符个数 ===')
eq('够宽就不动', clip('abc', 10), 'abc')
eq('ASCII 截断', clip('abcdef', 4), 'abc…')
// 「中文」两个字符占 4 列。限 4 列时：要留 1 列给省略号，所以只能放 1 个字。
eq('中文截断（必须按列算）', clip('中文测试', 4), '中…')
ok('截断后宽度不超过上限', displayWidth(clip('中文测试测试', 5)) <= 5)
eq('刚好放得下就不加省略号', clip('中文', 4), '中文')

console.log('=== wrapText：英文优先在词边界断（不能把词劈开）===')
{
  // 这条是外部评审实测出来的：早先纯逐字符折，command 说明被劈成 poli|cy、
  // 报错信息被劈成 writin|g / rea|ding。命令说明、工具名、服务端报错全是英文，
  // 被劈开之后非程序员读起来很费劲。
  const eng = wrapText('Switch the permission preset (sandbox mode + approval policy)', 58)
  eq('英文在词边界断', eng, ['Switch the permission preset (sandbox mode + approval', 'policy)'])
  // 判据：折完把各行拼回去（空白连成单个空格），必须跟原文一致。
  // 单词一旦被劈开（poli + cy)），拼回来就会变成 "poli cy)" —— 对不上。
  const norm = (t: string) => t.replace(/\s+/g, ' ').trim()
  eq('拼回去跟原文一致（说明没有词被劈开）',
     norm(eng.join(' ')), norm('Switch the permission preset (sandbox mode + approval policy)'))

  const err = wrapText('permission denied while writing file_report_q3.md', 30)
  eq('报错信息也在词边界断', err, ['permission denied while', 'writing file_report_q3.md'])

  // 每行都不能超宽（词边界折行不能以超宽为代价）
  for (const [text, w] of [
    ['Switch the permission preset (sandbox mode + approval policy)', 40],
    ['a b c d e f g h i j k l m n o p', 7],
  ] as Array<[string, number]>) {
    ok(`宽度 ${w} 下每行都不超宽`, wrapText(text, w).every(l => displayWidth(l) <= w))
  }

  // 行尾不留空白（否则每行末尾挂一个看不见的空格）
  ok('行尾没有多余空白', wrapText('aaa bbb ccc', 7).every(l => l === l.replace(/\s+$/, '')),
     JSON.stringify(wrapText('aaa bbb ccc', 7)))

  // 中文没有空格，整段是一个「词」→ 走逐字兜底，行为跟以前一样
  eq('中文仍然逐字折', wrapText('中文字', 4), ['中文', '字'])

  // 单个「词」比一整行还宽（长 URL / 长路径）→ 必须逐字拆，不能无限长
  const url = wrapText('x https://example.com/very/long/path/that/never/ends', 20)
  ok('超长的词会被逐字拆开', url.every(l => displayWidth(l) <= 20), JSON.stringify(url))
  ok('拆开之后内容不丢', url.join('').replace(/\s/g, '').includes('never'), JSON.stringify(url))
}

console.log('=== wrapText：按列折行 ===')
eq('短文本不折', wrapText('abc', 10), ['abc'])
eq('ASCII 折行', wrapText('abcdef', 3), ['abc', 'def'])
eq('中文折行（每字 2 列）', wrapText('中文字', 4), ['中文', '字'])
eq('已有换行会被拆开', wrapText('a\nb', 10), ['a', 'b'])
eq('空段落保留', wrapText('a\n\nb', 10), ['a', '', 'b'])
ok('折行后每行都不超过宽度', wrapText('中英abc混排测试', 5).every(l => displayWidth(l) <= 5))

console.log('')
console.log(`通过 ${pass} / ${pass + fail}`)
if (fail > 0) process.exitCode = 1
