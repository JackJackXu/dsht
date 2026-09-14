// 高度分配的单测
//
// 锁死踩过的坑：Ink 的 overflow="hidden" 会把超出的行「挤掉」（不是裁剪），
// 所以渲染出去的行数必须 ≤ 盒子高度；而内容高度又必须给末尾空行留位置，
// 否则 Ink 的光标坐标换算会整体偏一行。
import { contentHeight, INPUT_PREFIX_WIDTH, CURSOR_Y_COMPENSATION } from '../src/ui/cursor.ts'

let pass = 0, fail = 0
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; console.log('  ✓', name) }
  else { fail++; console.log('  ✗', name, '\n      得到', g, '\n      期望', w) }
}

console.log('=== 前缀宽度 ===')
eq('输入框行首前缀是 2 列（"> "）', INPUT_PREFIX_WIDTH, 2)

console.log('=== 高度分配：总和必须正好等于终端行数 ===')
/**
 * 复刻 App 里的算法。
 * 注意：现在用满整屏，**没有末尾空行**了 —— 多出来的那一行还给了对话区。
 * 代价是光标 y 要补偿（见 CURSOR_Y_COMPENSATION）。
 */
function total(terminalRows: number, inputBoxHeight: number, noticeHeight: number): number {
  const transcript = contentHeight(terminalRows, 1 + inputBoxHeight + 1 + noticeHeight)
  return 1 /*标题*/ + transcript + noticeHeight + inputBoxHeight + 1 /*状态*/
}

for (const rows of [24, 30, 40, 50]) {
  for (const inputBox of [3, 4, 8]) {
    for (const notice of [0, 1]) {
      const sum = total(rows, inputBox, notice)
      eq(`rows=${rows} 输入框=${inputBox} 提示=${notice}`, sum, rows)
    }
  }
}

console.log('=== 光标 y 补偿 ===')
eq('补偿量是 1（用满整屏的代价，见 cursor.ts 说明）', CURSOR_Y_COMPENSATION, 1)

console.log('=== 边界 ===')
eq('极小的终端也给 3 行', contentHeight(5, 20), 3)
eq('正常终端', contentHeight(30, 1 + 3 + 1 + 0), 25)
eq('内容高度永远不为负', contentHeight(1, 100) >= 3, true)

console.log(`\n通过 ${pass} / ${pass + fail}`)
process.exit(fail === 0 ? 0 : 1)
