// 面板的外框渲染 + **裁剪**
//
// 单独抽成组件的原因：非 TTY（管道）下 Ink 只输出最后一帧，
// 端到端跑的时候看不见中间画面。抽出来就能用 renderToString 单独验证渲染结果。
//
// ⚠️ 这个文件现在负责一件很要紧的事：**面板永远不许比它说的高度高**。
//   为什么放在这里而不是放在调用方：早先「裁到半屏」只是 App 里那一句
//   `windowPanel(panelRows, maxPanelRows)` 的自觉行为，结果命令面板和参数子面板
//   整个绕过了它 —— 终端一矮就花屏（Ink 的溢出是挤压不是裁剪）。
//   把裁剪下沉到盒子，新加的面板类型**想绕也绕不过去**。

import React from 'react'
import { Box, Text, type DOMElement } from 'ink'
import { windowPanel, type PanelRow, type PanelTone } from './panels.ts'
import { activePalette } from './theme.ts'
import { clip, displayWidth } from './width.ts'
import { panelContentWidth } from './cursor.ts'

// 颜色全部来自语义令牌（见 theme.ts）。
const P = activePalette()
const TONE_COLOR: Record<PanelTone, string | undefined> = {
  title: P.attention,
  label: P.tool,
  value: undefined,
  option: undefined,
  optionActive: P.attention,
  hint: P.dim,
  blank: undefined,
}

function PanelRowView({ row }: { row: PanelRow }) {
  const color = TONE_COLOR[row.tone]
  const text = row.text === '' ? ' ' : row.text
  // ⚠️ 不用 bold：终端普遍把「bold + 基础色」渲染成亮色版，
  // 会让实际观感跟配色表对不上（输入框的 `>` 就是这么变亮的）。
  // 选中项靠颜色（attention）区分就够了。
  return color === undefined
    ? <Text>{text}</Text>
    : <Text color={color}>{text}</Text>
}

/**
 * 面板最终长什么样、占几行。
 *
 * **高度预算和渲染都必须走这个函数** —— 它一次给出裁完的行和对应的高度，
 * 两边不可能对不上。App 拿它算预算，PanelBox 拿它渲染。
 *
 * 三道保险，缺一不可：
 *   1. 先按行数上限裁（`windowPanel`），超出时提示「还有 N 行」
 *   2. 再把每一行按面板内宽裁一遍 —— 就算某个 builder 忘了裁，这里兜住
 *   3. 高度由裁完的行数算出来，不是由原始行数算
 */
export function panelLayout(
  rows: readonly PanelRow[],
  maxRows: number,
  terminalColumns: number,
): { rows: PanelRow[]; height: number } {
  const inner = panelContentWidth(terminalColumns)
  const windowed = windowPanel(rows, maxRows, inner)
  return {
    rows: windowed,
    // 上下边框 2 行
    height: windowed.length + 2,
  }
}

export interface PanelBoxProps {
  rows: readonly PanelRow[]
  /**
   * 面板正文最多占几行（不含边框）。超出就裁，并显示「还有 N 行」。
   *
   * **必填**：漏了它就会花屏，所以不给默认值 —— 宁可编译不过。
   */
  maxRows: number
  /** 终端列数：用来算内宽，保证每一行都不会折行 */
  width: number
  /** 会挂到「自己输入」那一行上，用于把终端光标量出来 */
  customRef?: React.Ref<DOMElement>
}

export function PanelBox({ rows, maxRows, width, customRef }: PanelBoxProps) {
  const view = panelLayout(rows, maxRows, width)
  const inner = panelContentWidth(width)
  return (
    <Box
      borderStyle="round"
      // 面板一出现就该整块跳出来（UI-DESIGN 的约定），所以边框恒为 attention。
      // 早先这里有个 highlight 开关，但唯一的调用方恒传真值 —— 那是死开关。
      borderColor={P.attention}
      paddingX={1}
      flexDirection="column"
    >
      {view.rows.map((row, i) => (
        <Box key={i} ref={row.customInput === true ? customRef : undefined}>
          {/* 兜底裁剪：builder 忘了裁也不会折行（折行就多占一行，Ink 会挤压） */}
          <PanelRowView row={row.text === '' ? row : { ...row, text: clip(row.text, inner) }} />
        </Box>
      ))}
    </Box>
  )
}

/** 一行文本在面板里会不会折行（调试/测试用） */
export function panelRowFits(text: string, terminalColumns: number): boolean {
  return displayWidth(text) <= panelContentWidth(terminalColumns)
}
