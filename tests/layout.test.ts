// 滚动布局的不变量测试
//
// 这是「不花屏」的核心：cursor.ts 记的坑 2 说 Ink 的 overflow 不是裁剪而是挤压，
// 所以唯一的保护就是保证「渲染出去的行数 ≤ 盒子高度」。
// scrollLayout 是唯一负责这件事的地方，这里把它的不变量钉死。
import { layoutLines, scrollLayout, type Row } from '../src/ui/layout.ts'
import type { Line } from '../src/ui/transcript.ts'

let pass = 0, fail = 0
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name) }
  else { fail++; console.log('  ✗', name, detail !== undefined ? `\n      ${detail}` : '') }
}
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; console.log('  ✓', name) }
  else { fail++; console.log('  ✗', name, `\n      得到 ${g}\n      期望 ${w}`) }
}

const rows = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({ kind: 'line' as const, text: `第${i + 1}行` }))

console.log('=== 核心不变量：提示 + 内容 ≤ 盒子高度 ===')
for (const total of [0, 1, 5, 10, 19, 20, 21, 50, 200]) {
  for (const boxHeight of [1, 2, 3, 5, 10, 19]) {
    for (const scroll of [0, 1, 5, 19, 100]) {
      const r = scrollLayout(rows(total), boxHeight, scroll)
      const used = (r.showNotice ? 1 : 0) + r.visible.length
      if (used > boxHeight) {
        ok(`内容${total} 盒${boxHeight} 滚动${scroll}`, false, `占了 ${used} 行 > ${boxHeight}`)
      }
    }
  }
}
ok('穷举了 9×6×5 种组合，没有一种超过盒子高度', true)

console.log('=== 内容放得下时不该有提示 ===')
for (const [total, boxHeight] of [[0, 5], [1, 5], [5, 5], [3, 10]] as Array<[number, number]>) {
  const r = scrollLayout(rows(total), boxHeight, 0)
  ok(`内容 ${total} 行放进 ${boxHeight} 行的盒子：没有提示`, !r.showNotice)
  ok(`内容 ${total} 行放进 ${boxHeight} 行的盒子：全部可见`, r.visible.length === total)
  ok(`内容 ${total} 行放进 ${boxHeight} 行的盒子：上面没有藏东西`, r.hiddenAbove === 0)
}

console.log('=== 内容超出时必须给出提示，而且要占掉一行内容位 ===')
for (const [total, boxHeight] of [[20, 10], [10, 5], [21, 20]] as Array<[number, number]>) {
  const r = scrollLayout(rows(total), boxHeight, 0)
  ok(`内容 ${total} / 盒 ${boxHeight}：有提示`, r.showNotice)
  ok(`内容 ${total} / 盒 ${boxHeight}：内容位少一行`, r.visible.length === boxHeight - 1,
     `实际 ${r.visible.length}，期望 ${boxHeight - 1}`)
  ok(`内容 ${total} / 盒 ${boxHeight}：提示 + 内容正好填满`, 1 + r.visible.length === boxHeight)
  ok(`内容 ${total} / 盒 ${boxHeight}：上方确实有 ${total - (boxHeight - 1)} 行`,
     r.hiddenAbove === total - (boxHeight - 1), `实际 ${r.hiddenAbove}`)
}

console.log('=== 贴底滚动（scroll=0）显示的是最新的内容 ===')
{
  const r = scrollLayout(rows(30), 10, 0)
  ok('最后一行是第 30 行', r.visible[r.visible.length - 1]?.text === '第30行')
  ok('提示数 = 上面藏的行数', r.hiddenAbove === 30 - r.visible.length)
}

console.log('=== 滚到顶：上面的行数归零，不该出现负数 ===')
{
  const r = scrollLayout(rows(30), 10, 1000)   // 远超上限
  ok('hiddenAbove 不为负', r.hiddenAbove >= 0, `实际 ${r.hiddenAbove}`)
  ok('滚到顶时不再有隐藏行', r.hiddenAbove === 0)
  ok('第一行是第 1 行', r.visible[0]?.text === '第1行')
}

console.log('=== scrollLimit 跟实际能滚的最大值一致 ===')
{
  const r = scrollLayout(rows(30), 10, 0)
  const atTop = scrollLayout(rows(30), 10, r.scrollLimit)
  ok('滚到 scrollLimit 就到顶了', atTop.hiddenAbove === 0, `实际 ${atTop.hiddenAbove}`)
  const beyond = scrollLayout(rows(30), 10, r.scrollLimit + 5)
  ok('超过 scrollLimit 也不会出错', beyond.visible.length <= 10 && beyond.hiddenAbove === 0)
}

console.log('=== wantNotice：滚到顶时才有话要说 ===')
{
  // 内容放得下 + 有话要说 → 顶部出现一行提示（占一行内容位）
  const r = scrollLayout(rows(3), 10, 0, { externalNotice: true })
  ok('滚到顶、有话要说 → 显示提示', r.showNotice)
  ok('是不是在顶部', r.atTop)
  ok('提示 + 内容不超盒子', 1 + r.visible.length <= 10)

  // 内容放不下 + 有话要说 → 只能显示「上面还有 N 行」（不能同时两条）
  const r2 = scrollLayout(rows(30), 10, 0, { externalNotice: true })
  ok('内容超一屏时只占一行提示', r2.showNotice && 1 + r2.visible.length === 10)
  ok('这时并不在顶部', !r2.atTop)

  // 没话要说时，内容放得下就不该白占一行
  const r3 = scrollLayout(rows(3), 10, 0)
  ok('无话可说时顶部不留空行', !r3.showNotice)
  ok('内容全可见', r3.visible.length === 3)

  // 有话要说但没滚到顶 → 不该出现提示
  const r4 = scrollLayout(rows(30), 10, 5, { externalNotice: true })
  ok('没滚到顶时不提示「已到顶部」', r4.showNotice, '上面还有内容时仍然要提示那一行')
  ok('没滚到顶时 atTop 为假', !r4.atTop)

  // 滚到顶后
  const r5 = scrollLayout(rows(30), 10, 1000, { externalNotice: true })
  ok('滚到顶后 atTop 为真', r5.atTop)
  ok('滚到顶后上面没有隐藏行', r5.hiddenAbove === 0)
}

console.log('=== 命令行的 tone 必须真的被用上 ===')
{
  // 这个坑踩过：layoutLines 的 case 'meta' 把 line.tone 整个丢掉了、一律按灰色画，
  // 于是**命令不像命令、失败也不变红**，跟 UI-DESIGN 的承诺不符。
  const opts = { width: 40, showReasoning: false }
  const cmd = layoutLines([{ kind: 'meta', text: '/plan off', tone: 'command' }], opts)
  eq('命令本体 → command 色调（蓝）', cmd[0]?.prefixTone, 'command')

  const done = layoutLines([{ kind: 'meta', text: 'Plan mode off.', tone: 'notice' }], opts)
  eq('命令成功返回 → notice 色调（灰）', done[0]?.prefixTone, 'notice')

  const failed = layoutLines([{ kind: 'meta', text: 'unknown preset', tone: 'error' }], opts)
  eq('命令失败 → 标记用 error', failed[0]?.prefixTone, 'error')
  eq('命令失败 → 正文也用 error（整行红）', failed[0]?.bodyTone, 'error')
}

console.log('=== 盒子只有 1 行时也不能崩 ===')
{
  for (const total of [0, 1, 5]) {
    const r = scrollLayout(rows(total), 1, 0)
    ok(`盒 1 行 / 内容 ${total}：不超`, (r.showNotice ? 1 : 0) + r.visible.length <= 1)
  }
}

console.log('=== 空行规则：块之间空一行，块内部不空 ===')
{
  // 三种块，正好对应三种角色：
  //   用户消息 / 系统消息 / 一段智能体输出（思考 + 工具 + 回答）
  // 目标形态（用户画的）：
  //   用户A
  //   (空)
  //   系统B
  //   (空)
  //   思考C
  //   工具D
  //   回答E
  //   (空)
  //   用户F
  //   (空)
  //   思考G
  //   回答H
  const seq: Line[] = [
    { kind: 'user', text: '用户A' },
    { kind: 'meta', text: '系统B', tone: 'notice' },
    { kind: 'reasoning', text: '思考C' },
    { kind: 'tool', name: '工具D' },
    { kind: 'assistant', text: '回答E' },
    { kind: 'user', text: '用户F' },
    { kind: 'reasoning', text: '思考G' },
    { kind: 'assistant', text: '回答H' },
  ]
  // 展开思考，否则思考只有一行「已折叠」，看不出块内部的关系
  const out = layoutLines(seq, { width: 60, showReasoning: true })
  const gaps = out.filter(r => r.kind === 'gap').length
  eq('一共 4 个空行（每两个块之间一个）', gaps, 4)

  // 每行取一个「签名」再找位置 —— 工具名在 prefix 里、思考正文前面挂了缩进，
  // 直接比 text 会找不到（第一版就是这么写错的）
  const sig = out.map(r => (r.kind === 'gap' ? '' : (r.prefix ?? '') + r.text))
  const at = (needle: string) => sig.findIndex(x => x.includes(needle))

  const a = at('用户A')
  const b = at('系统B')
  const c = at('思考C')
  const d = at('工具D')
  const e = at('回答E')
  const f = at('用户F')
  const g = at('思考G')
  const h = at('回答H')
  ok('8 个关键行都找得到', [a, b, c, d, e, f, g, h].every(i => i >= 0), JSON.stringify([a, b, c, d, e, f, g, h]))

  ok('第一行前面没有空行', out[0] !== undefined && out[0].kind !== 'gap')
  eq('系统消息前面空一行', b - a, 2)
  eq('智能体块的第一行前面空一行', c - b, 3)     // 中间还有「∗ 思考」标签行
  eq('思考和工具之间**不**空行', d - c, 1)        // c 是正文行，工具行紧跟在它后面
  eq('工具和回答之间**不**空行', e - d, 1)
  eq('新用户消息前面空一行', f - e, 2)
  eq('用户之后的智能体块前面空一行', g - f, 3)
  eq('思考和回答之间**不**空行（这一轮没有工具）', h - g, 1)

  // 折叠思考时也一样：块内部不该冒出空行
  const folded = layoutLines(seq, { width: 60, showReasoning: false })
  eq('折叠思考时也是 4 个空行', folded.filter(r => r.kind === 'gap').length, 4)
}

console.log('=== 命令和它的输出是**同一块**（中间不空行）===')
{
  // 用户实测发现的：一条命令被拆成了两块。
  //     - /permission workspace-write
  //                                  ← 这行空行是多余的
  //     - preset workspace-write
  // `/goal` 那里更明显：命令、结果、用法说明被空行切成了三截。
  const one: Line[] = [
    { kind: 'meta', text: '/permission workspace-write', tone: 'command' },
    { kind: 'meta', text: 'preset workspace-write', tone: 'notice' },
  ]
  eq('一条命令 + 它的输出：没有空行', layoutLines(one, { width: 60, showReasoning: true }).filter(r => r.kind === 'gap').length, 0)

  // 两条命令之间**要**空行 —— 它们是两件事
  const two: Line[] = [
    { kind: 'meta', text: '/permission workspace-write', tone: 'command' },
    { kind: 'meta', text: 'preset workspace-write', tone: 'notice' },
    { kind: 'meta', text: '/goal', tone: 'command' },
    { kind: 'meta', text: 'No goal is currently set.', tone: 'notice' },
  ]
  const out = layoutLines(two, { width: 60, showReasoning: true })
  eq('两条命令之间空一行', out.filter(r => r.kind === 'gap').length, 1)

  // 错误也接在命令后面（命令失败了，那还是同一条命令的事）
  const failed: Line[] = [
    { kind: 'meta', text: '/permission 乱写的', tone: 'command' },
    { kind: 'meta', text: 'unknown preset', tone: 'error' },
  ]
  eq('命令 + 失败输出：也没有空行',
     layoutLines(failed, { width: 60, showReasoning: true }).filter(r => r.kind === 'gap').length, 0)
}

console.log('=== 两条连续的用户消息：各自成块，所以之间有空行 ===')
{
  const out = layoutLines([
    { kind: 'user', text: '第一条' },
    { kind: 'user', text: '第二条' },
  ], { width: 60, showReasoning: true })
  eq('两条连续用户消息之间空一行', out.filter(r => r.kind === 'gap').length, 1)
}

console.log('=== 只有一行时不留空行 ===')
{
  for (const one of [
    [{ kind: 'user', text: '只有我' }],
    [{ kind: 'assistant', text: '只有它' }],
    [{ kind: 'meta', text: '只有系统', tone: 'notice' }],
  ] as Line[][]) {
    const out = layoutLines(one, { width: 60, showReasoning: true })
    eq(`「${one[0]!.kind}」单独一行时没有空行`, out.filter(r => r.kind === 'gap').length, 0)
  }
}

console.log('')
console.log(`通过 ${pass} / ${pass + fail}`)
if (fail > 0) process.exitCode = 1
