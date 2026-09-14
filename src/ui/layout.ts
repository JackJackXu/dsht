// 布局：把逻辑行拆成终端里的「物理行」
//
// 为什么要自己拆：Ink 自己换行的话，我们没法知道到底占了几行，
// 也就没法做滚动和高度控制。自己按显示宽度折行，一切都可控。
//
// 视觉风格（标记都在第 0 列，不用缩进）：
//
//   > 你说的话
//
//   = 智能体说的话
//
//   ● 工具 read  report.md
//   ∗ 思考 已折叠（Ctrl+O 展开）
//   - /plan
//   ! 出错了
//
// 具体用哪个符号只由下面的 *_MARK 常量决定，本注释不重复维护它们的值。
//
// 设计原则：**颜色只标识「这是什么」，不用来铺满内容。**
// 所以工具/思考这些行，只有开头的标签是彩色的，后面的具体内容退灰。
//
// 每一行都是「前缀 + 正文」两段，各有各的颜色。这样渲染层不用判特例。

import type { Line } from './transcript.ts'
import { wrapText, clip, displayWidth } from './width.ts'

/**
 * 颜色令牌的语义名（真正的颜色在 theme.ts，渲染层去查）。
 *
 * 这里只列**行**会用到的令牌。`attention`（面板选中、等你回应）不在此列 ——
 * 它不是某一行的属性，而是在渲染处直接取的（见 App.tsx 的活光标和 PanelBox 的边框）。
 * 曾经把它列在这里，但从没有任何地方产生过 attention 色调的行，属于死成员。
 */
export type Tone =
  | 'user'
  | 'agent'
  | 'tool'
  | 'thinking'
  | 'command'
  | 'notice'
  | 'error'
  | 'dim'

/**
 * 行的种类。
 *
 * 只有两种：正文行、以及对话块之间的空行。
 * （曾经还有过一个 'metaText'，但从没有任何地方产生它 —— 死成员比没有更糟，
 *  因为它会让读代码的人以为存在某种「元信息行」。）
 */
export type RowKind = 'line' | 'gap'

export interface Row {
  kind: RowKind
  /** 正文 */
  text: string
  /** 画在正文之前的标签，如 `> ` / `● 工具 ` */
  prefix?: string
  /** 标签的颜色 */
  prefixTone?: Tone
  /** 正文的颜色；不给就用终端默认前景色 */
  bodyTone?: Tone
  /** 这一行属于还没落盘的流式输出 */
  live?: boolean
}

export interface LayoutOptions {
  width: number
  showReasoning: boolean
}

// 各种行的标记。想换符号改这里。
//
// 现状（用户逐个挑的，候选表见 `npm run markers`）：
//   >  你说的话          —— 也是 Claude Code 的提示符
//   =  智能体说的话      —— 原先用 ~，评审说看不出「它在说话」
//   ●  工具调用
//   ∗  思考过程
//   -  系统消息          —— 原先用 ·，那是 ● 的小号，去掉颜色后分不出
//   !  错误            —— 单感叹号（宽度确定；‼ 曾用过，也是确定的，但没必要）
//
// 硬规则：标记必须是**宽度确定**的字符（东亚宽度不是 A）。
// 唯一例外是工具用的 ●，因为用户亲眼确认过它在本机终端里是 1 列。
// 被这条规则否掉的：※（U+203B）、≡（U+2261）、◆（U+25C6）、Ξ（U+039E）。
// 详见 tests/markers.test.ts 和 npm run markers 末尾的尺子。
//
// 导出是为了 `probe/_markers.ts`（候选清单）和测试能读到**真**标记，
// 而不是各抄一份 —— 抄的那份迟早会跟这里不一致。
export const USER_MARK = '> '
export const AGENT_MARK = '= '
export const TOOL_MARK = '● '
export const THINK_MARK = '∗ '
export const SYS_MARK = '- '
export const ERR_MARK = '! '
/**
 * 续行缩进 —— 跟标记等宽（2 列），所以折行后的文字跟首行正文对齐。
 *
 * 导出是为了让输入框（App.tsx）和对话流用同一个来源，不再各抄一份。
 */
export const CONT = '  '

/**
 * 这一行是不是「智能体输出」那一段里的。
 *
 * 思考 / 工具 / 回答在时间上本来就是连着发生的（同一轮里先想、再调工具、再作答），
 * 所以它们属于**同一个块**。
 */
function isAgentOutput(kind: Line['kind']): boolean {
  return kind === 'reasoning' || kind === 'tool' || kind === 'assistant'
}

/**
 * 这一行要不要在它前面留一个空行。
 *
 * 规则就一句话：**块之间空一行，块内部不空**。
 * 「块」有三种，正好对应三种角色：
 *
 *   · 一条用户消息
 *   · 一条系统消息（命令反馈、错误）
 *   · 一段智能体输出（思考 + 工具 + 回答）
 *
 * 为什么块内部不空：思考/工具/回答本来就是一轮里连着发生的事，
 * 每条之间都插空行会把一轮对话摊成三四段 —— 又占地方，又看不出它们是一伙的。
 * 它们各自有标记和颜色，本来就分得开。
 *
 * （早先的做法是「除了第一行，每行前面都空一行」，空行多到把屏幕占满，
 *   用户和评审都指出过。）
 */
/** 命令本身那一行（`command/run`）—— 它是「一条系统交互」的起点 */
function isCommandStart(line: Line): boolean {
  return line.kind === 'meta' && line.tone === 'command'
}

/** 系统类的行：命令、命令输出、错误。它们内部不该再空行。 */
function isSystemLine(line: Line): boolean {
  return line.kind === 'meta' || line.kind === 'error'
}

function startsNewBlock(line: Line, prev: Line | undefined): boolean {
  // 第一行前面不留空
  if (prev === undefined) return false
  // 智能体输出：只有从「别的东西」进到这里才算新块；块内部连着不算
  if (isAgentOutput(line.kind)) return !isAgentOutput(prev.kind)
  // ⚠️ 系统类要分两种：
  //   · 命令本身（`command/run`）→ 新块，因为它代表「又跑了一条命令」
  //   · 命令的输出（`command/done`）/ 错误 → **接在命令后面**，不空行
  //
  // 一开始把两者都当"各自成块"，结果一条命令被拆成两块：
  //     - /permission workspace-write
  //                                  ← 这行空行是多余的，它们本来是一件事
  //     - preset workspace-write
  // 用户指出过（`/goal` 那里更明显：命令、结果、用法说明被空行切成了三截）。
  if (isCommandStart(line)) return true
  return !isSystemLine(prev)
}

export function layoutLines(lines: readonly Line[], options: LayoutOptions): Row[] {
  const { showReasoning } = options
  const width = Math.max(10, options.width)
  const rows: Row[] = []

  const wrap = (text: string, prefixWidth: number): string[] =>
    wrapText(text, Math.max(8, width - prefixWidth))

  /** 把一段文字铺成多行：首行带标记，续行缩进 */
  const pushBlock = (
    text: string, mark: string, prefixTone: Tone, bodyTone: Tone | undefined, live?: boolean,
  ): void => {
    // 用显示宽度而不是 mark.length —— 现在两者凑巧相等（标记都是「1 列符号 + 空格」），
    // 但那是 tests/markers.test.ts 保证的性质，不该在这里再假设一次。
    const wrapped = wrap(text, displayWidth(mark))
    for (const [i, physical] of wrapped.entries()) {
      rows.push({
        kind: 'line',
        prefix: i === 0 ? mark : CONT,
        prefixTone,
        text: physical,
        ...(bodyTone === undefined ? {} : { bodyTone }),
        ...(live === undefined ? {} : { live }),
      })
    }
  }

  for (const [index, line] of lines.entries()) {
    if (startsNewBlock(line, lines[index - 1])) rows.push({ kind: 'gap', text: '' })

    switch (line.kind) {
      case 'user':
        // 你说的话：整条上色（短，是锚点）
        pushBlock(line.text, USER_MARK, 'user', 'user')
        break

      case 'assistant':
        pushBlock(line.text, AGENT_MARK, 'agent', 'agent', line.live)
        break

      case 'reasoning': {
        if (!showReasoning) {
          // 折叠态：显示**第一行**，后面用省略号表示「还有」。
          //
          // 早先这里写的是「已折叠（Ctrl+O 展开）」—— 每个思考块后面都跟一句
          // 一模一样的话，很冗余（用户指出）。而且展开的快捷键本来就写在
          // 标题栏的按键提示里了，不需要每行再重复一遍。
          //
          // 现在这样既省地方又给了一点信息：一眼能看到它刚才在想什么。
          const firstLine = (line.text.split('\n')[0] ?? '').trim()
          if (firstLine === '') break
          // 只有「还有下文」时才加省略号 —— 否则看着像被截断了
          const hasMore = line.text.trim() !== firstLine
          const prefix = `${THINK_MARK}思考 `
          rows.push({
            kind: 'line',
            prefix,
            prefixTone: 'thinking',
            text: clip(hasMore ? `${firstLine}…` : firstLine, Math.max(8, width - displayWidth(prefix))),
            bodyTone: 'dim',
          })
          break
        }
        rows.push({ kind: 'line', prefix: `${THINK_MARK}思考`, prefixTone: 'thinking', text: '' })
        pushBlock(line.text, CONT, 'thinking', 'dim')
        break
      }

      case 'tool': {
        // 工具行：`● 工具 read` 全部用工具色（**工具名跟标签同色**），
        // 只有后面的**参数**退灰。
        //
        // 理由：一行里最该一眼看到的是「调用了哪个工具」，
        // 参数是次要的细节 —— 颜色只用来标识"这是什么"。
        //
        // 强制压成一行（截断）—— 参数经常是几百字符的命令，
        // 自由换行会把整条对话流淹掉。要看全貌时审批面板会完整显示。
        const prefix = `${TOOL_MARK}工具 ${line.name}`
        const detail = line.detail ?? ''
        rows.push({
          kind: 'line',
          prefix,
          prefixTone: 'tool',
          // ⚠️ 必须用 displayWidth 而不是 .length ——
          // 前缀里有中文和变量长度的工具名，用 .length 会算错列宽导致换行。
          text: detail === '' ? '' : clip(`  ${detail}`, Math.max(8, width - displayWidth(prefix))),
          bodyTone: 'dim',
        })
        break
      }

      case 'meta': {
        // 命令本身 / 命令反馈。
        //
        // tone 由 transcript 根据事件算好：
        //   'command' → 命令本身（如 `/plan off`），蓝色
        //   'notice'  → 命令成功返回，退灰
        //   'error'   → 命令失败，红色（跟 UI-DESIGN「错误 = 红」一致）
        // 早先这里把 tone 整个丢掉了、一律灰 —— 于是命令不像命令、失败也不变红。
        const tone: Tone = line.tone === 'error' ? 'error'
          : line.tone === 'command' ? 'command'
            : 'notice'
        pushBlock(line.text, SYS_MARK, tone, tone === 'error' ? 'error' : 'dim')
        break
      }

      case 'error':
        pushBlock(line.text, ERR_MARK, 'error', 'error')
        break
    }
  }

  return rows
}

/**
 * 取出要显示的那一段。
 * @param scroll 距离底部的行数（0 = 贴在底部 / 最新）
 */
function viewport(rows: readonly Row[], height: number, scroll: number): readonly Row[] {
  if (height <= 0) return []
  if (rows.length <= height) return rows
  const offset = Math.max(0, Math.min(scroll, rows.length - height))
  const end = rows.length - offset
  return rows.slice(end - height, end)
}

/** 可滚动的最大行数。 */
function maxScroll(rows: readonly Row[], height: number): number {
  return Math.max(0, rows.length - height)
}

/** 滚动区的排布结果。 */
export interface ScrollLayout {
  /** 要不要在滚动区里留一行提示（那行内容是调用方自己画的） */
  showNotice: boolean
  /** 视口上方还藏着多少行 —— 0 表示已经到顶了 */
  hiddenAbove: number
  /** 视口下方还藏着多少行 —— 0 表示已经到底了（显示的是最新内容） */
  hiddenBelow: number
  /** 实际渲染的内容行（**不含**提示行） */
  visible: readonly Row[]
  /** 夹紧之后的滚动量（回传给调用方存起来） */
  clampedScroll: number
  /**
   * 滚动量的最大值。调用方（键盘翻页）也用这个数做上限 ——
   * 不要自己另算一遍，否则提示行出现/消失时两边会差 1，按 PgUp 要多按几次才动。
   */
  scrollLimit: number
  /** 是不是已经滚到顶了（在顶部还往上翻 = 该去要更早的历史了） */
  atTop: boolean
  /** 是不是已经到底了（显示的是最新内容） */
  atBottom: boolean
}

export interface ScrollLayoutOptions {
  /**
   * 外面有话要说（例如「还有更早的历史可以载入」）。
   * 只在**已经滚到顶**时才占位 —— 平时不占，否则白占一行。
   */
  externalNotice?: boolean
  /**
   * 提示行**常驻**：不管有没有内容被藏起来，都留一行给它。
   *
   * 用在「读文档」的场景（计划全文）：否则滚到顶时提示行消失、
   * 内容区突然多出一行，文字会跳 —— 用户报的「计划一会多一会少」就是这个。
   * 顺带那行还能一直显示「已到顶部/底部」，比忽隐忽现好读。
   */
  alwaysNotice?: boolean
}

/**
 * 算出滚动区里到底放什么。
 *
 * 为什么单独抽成函数：滚动区和它自己的高度是**互相依赖**的 ——
 * 提示行自己也要占一行，占掉之后能放的内容就少一行，
 * 而「上面/下面还有几行」又取决于放了多少内容。手写这段必然写错，
 * 本项目就写错过：提示行没进预算，盒子于是装了 height+1 行，
 * Ink 不是裁剪而是挤压 —— 结果提示**根本不显示**，还把首行对话压花。
 *
 * 不变量：`(showNotice ? 1 : 0) + visible.length <= boxHeight`
 * 这是「不花屏」的充要条件（见 cursor.ts 坑 2），由 tests/layout.test.ts 锁住。
 *
 * @param boxHeight 滚动盒的固定高度（行）
 * @param scroll 距底部的行数，0 = 贴在最新处。**可以传一个很大的值**表示「滚到顶」，
 *   这里会夹紧（调用方想跳到顶部时就这么干，不必自己知道上限）。
 */
export function scrollLayout(
  rows: readonly Row[],
  boxHeight: number,
  scroll: number,
  options: ScrollLayoutOptions = {},
): ScrollLayout {
  const { externalNotice = false, alwaysNotice = false } = options
  /** 盒子太矮（1 行）时连提示都放不下，就别硬塞了 */
  const canAffordNotice = boxHeight > 1

  // 常驻模式：先扣掉提示那一行，剩下的才是内容位
  let contentRows = boxHeight - (alwaysNotice && canAffordNotice ? 1 : 0)
  let clampedScroll = Math.min(scroll, maxScroll(rows, contentRows))
  let hiddenAbove = Math.max(0, rows.length - contentRows - clampedScroll)

  // 非常驻模式：按需再让出一行
  //
  // 重算后 hiddenAbove 只会变大（内容位少了一行），不会变回 0，
  // 所以不会出现「加了提示又说不需要」的来回抖动。
  if (!alwaysNotice && canAffordNotice && (hiddenAbove > 0 || (externalNotice && clampedScroll >= maxScroll(rows, contentRows)))) {
    contentRows -= 1
    // ⚠️ 必须用**原始的 scroll** 重新夹紧，不能在上一轮结果上再取 min。
    // 内容位少了一行 → 可滚范围大了一格；用户如果本来就要求滚到顶
    //（scroll 远超上限），在上一轮结果上再取 min 会让他**永远差一格到不了顶**。
    clampedScroll = Math.min(scroll, maxScroll(rows, contentRows))
    hiddenAbove = Math.max(0, rows.length - contentRows - clampedScroll)
  }

  const scrollLimit = maxScroll(rows, contentRows)
  return {
    showNotice: contentRows < boxHeight,
    hiddenAbove,
    // 滚动量的定义就是「距底部多少行」，所以它本身就等于下面藏了多少行
    hiddenBelow: clampedScroll,
    visible: viewport(rows, contentRows, clampedScroll),
    clampedScroll,
    scrollLimit,
    atTop: clampedScroll >= scrollLimit,
    atBottom: clampedScroll <= 0,
  }
}

/**
 * 拼出滚动区那一行提示的文案。
 *
 * 两个方向都要说 —— 早先只报「↑ 上面还有 N 行」，滚到中间时用户不知道
 * 下面还有没有内容、还要不要往下翻。
 */
export function scrollNoticeText(state: {
  hiddenAbove: number
  hiddenBelow: number
  /** 已经到顶，但外面还有话要说（例如还有更早的历史可载入） */
  external?: string
}): string {
  const { hiddenAbove, hiddenBelow, external } = state
  const parts: string[] = []
  if (hiddenAbove > 0) parts.push(`↑ 上方 ${hiddenAbove} 行`)
  else if (external !== undefined) parts.push(external)
  if (hiddenBelow > 0) parts.push(`↓ 下方 ${hiddenBelow} 行`)
  return parts.join(' · ')
}
