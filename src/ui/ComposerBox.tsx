// 输入框的外框渲染
//
// 为什么单独抽成组件（跟 PanelBox 同一个理由）：
//   「这个盒子渲染出来占几行」必须跟「盒子实际画了几行」是同一件事。
//   分散在两处手算，迟早对不上 —— 而对不上的后果不是难看，是花屏：
//   Ink 的 overflow 不是裁剪而是挤压（见 cursor.ts 坑 2）。
//   所以高度公式 {@link composerHeight} 和渲染放在同一个文件里。
//
// 抽出来还有个好处：非 TTY（管道）下 Ink 只输出最后一帧，端到端看不见中间画面，
// 现在可以用 renderToString 单独验证它。

import React from 'react'
import { Box, Text, type DOMElement } from 'ink'
import { CONT, USER_MARK } from './layout.ts'
import { composerContentWidth } from './cursor.ts'
import type { InputView } from './input.ts'
import { activePalette } from './theme.ts'

const P = activePalette()

/**
 * 这个盒子占几行。
 *
 * **App 的高度预算必须调这个函数，不许自己算一遍** ——
 * 一旦两处各算各的，改了渲染忘了改预算，整屏就会挤（而且总行数看起来还是对的）。
 */
export function composerHeight(view: InputView): number {
  // 上下边框 2 行
  return view.lines.length + (view.hiddenAbove > 0 ? 1 : 0) + 2
}

export interface ComposerBoxProps {
  view: InputView
  /** 边框颜色随状态变（工作中 = 工具色） */
  running: boolean
  /**
   * 挂到**装正文的那个内层盒子**上（不是外框），用于把终端光标量出来。
   * 内层盒子的 y 就是第一行正文的 y —— 提示行出现时它会自动下移，
   * 而 measureElement 量的是真实坐标，所以不用我们操心。
   */
  contentRef?: React.Ref<DOMElement>
}

export function ComposerBox({ view, running, contentRef }: ComposerBoxProps) {
  return (
    <Box
      borderStyle="round"
      borderColor={running ? P.tool : P.user}
      paddingX={1}
      flexDirection="column"
    >
      {view.hiddenAbove > 0 && (
        <Text color={P.dim}>（上方还有 {view.hiddenAbove} 行）</Text>
      )}
      <Box ref={contentRef} flexDirection="column">
        {view.lines.map((line, i) => (
          <Box key={i}>
            {/* ⚠️ 这里**不加 bold**：很多终端会把「bold + 基础色」渲染成该颜色的
                亮色版（Windows Terminal 的 intenseTextStyle 默认就是 bright），
                于是 cyan 看起来像 bright cyan，跟配色表对不上。
                标记靠颜色区分就够了。 */}
            {i === 0
              ? <Text color={P.user}>{USER_MARK}</Text>
              : <Text>{CONT}</Text>}
            <Text>{line}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  )
}
