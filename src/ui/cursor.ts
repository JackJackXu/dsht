import { USER_MARK } from './layout.ts'
import { displayWidth } from './width.ts'

// 光标定位 · 终端度量
//
// 这个模块回答两类问题：
//   ① 光标该画在哪（见下）
//   ② 一个盒子里能放多少东西 —— 竖直方向的 contentHeight，水平的 *_ContentWidth
// 这些数字**必须只有一个来源**：App 的高度预算、面板的行宽、输入框的折行宽度
// 全都要用同一套，否则「算的」和「画的」会不一致，而 Ink 溢出时不是裁剪是挤压。
//
// 为什么不用自己画方块：中文输入法（IME）只认终端真光标的位置，
// 自己画的假光标它不认。Ink 的 useCursor 就是为这个设计的。
//
// ⚠️ 两个踩过的坑（都记在这里，别再犯）：
//
// 坑 1：坐标不能手推。
//   边框 1 列 + 内边距 1 列 + 前缀 2 列 = 4 —— 这算法本身没错，
//   但一旦有换行、溢出、内边距变化，手推的数字立刻就错了。
//   **正解是用 Ink 的 measureElement 量出元素的真实坐标**，
//   再在它基础上加偏移。
//
// 坑 2：Ink 的 overflow="hidden" 不是裁剪，是「挤」。
//   内容超过 height 时，它会把中间的行抽掉（实测 6 行挤成「2、4、6」），
//   结果是花屏而不是裁切。
//   所以必须自己保证：渲染出去的行数 ≤ 盒子高度。
//   下面 viewport 的切片就是对这一点负责的。

/**
 * 输入框行首前缀的宽度（列）。
 *
 * **从 USER_MARK 派生，不写死** —— 输入框、对话流、面板选中标记三处必须一致：
 * 用户改了行首标记，这三处要一起变，否则输入框文字会和对话流错开，
 * 光标也会按错的列偏移。
 *
 * 推导方式：标记本身是「符号 + 一个空格」，续行用等宽的 {@link CONT}，
 * 所以宽度就是标记的显示宽度（用 displayWidth 而不是 .length，
 * 万一日后换成全角符号，长度会算错）。
 */
export const INPUT_PREFIX_WIDTH = displayWidth(USER_MARK)

/**
 * 内容区可用高度 —— 终端有多少行就用多少行，不再留末尾空行。
 *
 * 早期版本会少留一行，让渲染结果以换行结尾（那是 Ink 光标换算的前提）。
 * 但那一行白空着太浪费，所以改成「用满 + 显式补偿光标坐标」，
 * 补偿量见 {@link CURSOR_Y_COMPENSATION}。
 */
export function contentHeight(terminalRows: number, usedByChrome: number): number {
  return Math.max(3, terminalRows - usedByChrome)
}

/**
 * 方框占掉的水平空间：左右边框各 1 列 + 左右内边距各 1 列。
 *
 * 输入框和面板都是 `borderStyle="round"` + `paddingX={1}`，所以都用这个数。
 */
export const BOX_CHROME_WIDTH = 4

/**
 * 输入框正文的可用宽度（列）。
 *
 * **不要自己写 `columns - 6`** —— 那个 6 = 边框 2 + 内边距 2 + 行首标记 2。
 * 改其中任何一项（换边框样式、去掉内边距、标记换全角），算错的那一方就会
 * 让正文比盒子宽 → Ink 自动折行 → 多出来的行把整屏挤花。
 */
export function composerContentWidth(terminalColumns: number): number {
  return Math.max(4, terminalColumns - BOX_CHROME_WIDTH - INPUT_PREFIX_WIDTH)
}

/**
 * 面板正文的可用宽度（列）。跟输入框的差别只是面板没有行首标记（少占 2 列）。
 *
 * 下限**不能**大于真实可用宽度：早期这里写的是 `Math.max(20, width - 4)`，
 * 于是终端窄于 24 列时 inner 反而比可用宽度大，clip 以为没超宽、Ink 却每行再折一次，
 * 面板实际高度直接翻倍。
 */
export function panelContentWidth(terminalColumns: number): number {
  return Math.max(4, terminalColumns - BOX_CHROME_WIDTH)
}

/**
 * Ink 光标 y 坐标的补偿量。
 *
 * 为什么需要它：Ink 内部这样算光标的移动量——
 *
 *     moveUp = visibleLineCount - cursor.y
 *
 * 并注明「假设光标在最后一行之后」。但这个假设只在渲染结果**以换行结尾**时成立。
 * 我们现在的布局用满了整屏、最后一行有内容，输出不以换行结尾，
 * 光标实际停在最后一行的**末尾**，于是 moveUp 会多减 1 —— 光标整体偏上一行。
 *
 * 所以设置光标时把 y 加 1 补偿掉。
 *
 * ⚠️ 这个补偿依赖 Ink 的现有行为。如果哪天 Ink 修了（比如把 onRender 改成
 * 先跑布局，或输出补一个换行），光标会偏下一行 —— 那时把这个常量改成 0。
 * 判断方法：看光标是不是整体偏了一行。
 */
export const CURSOR_Y_COMPENSATION = 1
