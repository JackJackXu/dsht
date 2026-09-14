// dsht 主界面
//
// 布局（固定高度，不会撑破终端）：
//   ┌────────────────────────────────────────┐
//   │ dsht  标题          PgUp/PgDn 翻页 …    │  1 行
//   │ 可滚动区（对话记录 / 或面板的全文）        │  flexGrow
//   │ ┌────────────────────────────────────┐ │
//   │ │ > 输入框   或   审批/提问面板        │ │  按内容
//   │ └────────────────────────────────────┘ │
//   │ Enter 发送 · …                  ○ 空闲  │  1 行
//   └────────────────────────────────────────┘
//
// 有面板时：面板「顶替」输入框，并且独占键盘（和 dsh-tui 一样）。
// 键盘永远只有一个归属者，这样不会有多个输入处理器抢事件的问题。
//
// 光标：不用自己画方块，而是把「终端真光标」搬到输入位置（IME 只认真光标）。
// 坐标用 measureElement 量，不手推 —— 见 cursor.ts 开头的说明。

import React, { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Box, Text, measureElement, useApp, useCursor, useInput, useStdout } from 'ink'
import { buildTranscript } from './transcript.ts'
import { layoutLines, scrollLayout, scrollNoticeText, type Row } from './layout.ts'
import { cursorBeforeWidth, layoutInput } from './input.ts'
import * as ed from './editor.ts'
import { isCtrlChar, isNewlineKey } from './keys.ts'
import { activePalette } from './theme.ts'
import type { Tone } from './layout.ts'
import { displayWidth, wrapText, clip, capLines } from './width.ts'
import {
  contentHeight, composerContentWidth, INPUT_PREFIX_WIDTH, CURSOR_Y_COMPENSATION,
} from './cursor.ts'
import type { PendingInteraction, QuestionAnswerItem } from '../interactions.ts'
import {
  buildApprovalPanel, buildQuestionPanel, detailOf,
  type PanelRow,
} from './panels.ts'
import { buildArgPanel, buildCommandPalette } from './panels.ts'
import { PanelBox, panelLayout } from './PanelBox.tsx'
import {
  argumentsOf, commandPrefixOf, completionFor, filterCommands,
  type CommandArgument, type PermissionOption, type SlashCommand,
} from './commands.ts'
import { readStatusNumbers, statusCandidates } from './status.ts'
import { ComposerBox, composerHeight } from './ComposerBox.tsx'
import {
  initialFlow, reduceFlow, type QuestionFlowState,
} from './question-flow.ts'

/**
 * 订阅一个**会话投影**。
 *
 * 投影是 dsh 自己算好的（轮次、步数、解码速度、缓存命中、花费、权限预设……），
 * 我们只读、不自己统计、更不估算 —— 估出来的数字会让本来就对花费敏感的用户更焦虑。
 *
 * 形状和字段来源见 src/ui/status.ts 的注释。取不到就是 undefined，
 * 调用方必须能接受「这一项没有」（绝不编一个默认值出来）。
 */
function useProjection(session: any, key: string): any {
  const read = () => session?.projections?.faceOf?.(key)?.getSnapshot?.()
  const [value, setValue] = useState(read)
  useEffect(() => {
    const face = session?.projections?.faceOf?.(key)
    if (face === undefined) return
    const sync = () => setValue(face.getSnapshot())
    sync()
    return face.subscribe(sync)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, key])
  return value
}

/** 拿不到终端尺寸时的兜底。 */
export interface FallbackSize {
  columns: number
  rows: number
}

const DEFAULT_SIZE: FallbackSize = { columns: 80, rows: 24 }

/**
 * 订阅终端尺寸。
 *
 * `fallback` 只在 `useStdout()` 给不出尺寸时用 —— 管道输出、
 * `renderToString`（测试）都是这种情况。做成参数是为了让渲染测试
 * 能覆盖各种终端尺寸，而不是只能测 80×24。
 */
function useTerminalSize(fallback: FallbackSize = DEFAULT_SIZE) {
  const { stdout } = useStdout()
  const read = () => ({
    columns: stdout?.columns ?? fallback.columns,
    rows: stdout?.rows ?? fallback.rows,
  })
  const [size, setSize] = useState(read)
  useEffect(() => {
    const onResize = () => setSize(read())
    stdout?.on('resize', onResize)
    return () => { stdout?.off('resize', onResize) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stdout, fallback.columns, fallback.rows])
  return size
}

// 颜色全部来自语义令牌（见 theme.ts）。组件里不出现具体颜色名。
const P = activePalette()

/** 色调名 → 实际颜色（transcript 的 Row 用） */
const TONE_COLOR: Record<Tone, string | undefined> = {
  user: P.user,
  agent: P.agent,
  tool: P.tool,
  thinking: P.thinking,
  command: P.command,
  notice: P.dim,
  error: P.error,
  dim: P.dim,
  // 注意：这里**没有** attention。它不是行的属性，而是在渲染处直接用 P.attention
  //（活光标、面板边框）。见 layout.ts 里 Tone 的说明。
}

const MAX_INPUT_LINES = 6

/**
 * 提示/错误最多占几行。
 *
 * 为什么封顶：提示内容可能来自服务端（错误消息长度不可控），
 * 如果不封顶，一条长错误会把整个对话区挤掉。封顶后仍然按真实折行数记账。
 */
const MAX_NOTICE_LINES = 2

/** 「 dsht 」徽标占的列数。标题栏给左边留位时要减掉它。 */
const BADGE_WIDTH = displayWidth(' dsht ')

/**
 * 按键提示（显示在标题栏右侧）。
 *
 * 从长到短排 —— `pickHint` 挑**第一条放得下**的，所以列表必须逐渐变短，
 * 而且最短的那条要是最不能省的部分（发送和退出）。
 * 终端一窄，先牺牲的是翻页、思考这些「学会了就不用再看」的。
 */
const KEY_HINTS = [
  'Enter 发送 · Ctrl+Enter 换行 · / 命令 · Ctrl+O 思考 · PgUp/PgDn 翻页 · Ctrl+C 退出',
  'Enter 发送 · Ctrl+Enter 换行 · / 命令 · Ctrl+O 思考 · Ctrl+C 退出',
  'Enter 发送 · Ctrl+Enter 换行 · / 命令 · Ctrl+C 退出',
  'Enter 发送 · Ctrl+Enter 换行 · Ctrl+C 退出',
  'Enter 发送 · Ctrl+C 退出',
  'Enter 发送',
]
/** agent 在跑时多一个「Esc 停止」——这时候它才有用，平时不该占地方 */
const KEY_HINTS_RUNNING = [
  'Esc 停止 · Enter 插话 · / 命令 · Ctrl+O 思考 · Ctrl+C 退出',
  'Esc 停止 · Enter 插话 · / 命令 · Ctrl+C 退出',
  'Esc 停止 · Enter 插话 · Ctrl+C 退出',
  'Esc 停止 · Enter 插话',
  'Esc 停止',
]
const pickHint = (candidates: readonly string[], width: number): string =>
  candidates.find(h => displayWidth(h) <= width) ?? candidates[candidates.length - 1] ?? ''

/**
 * 画一行。
 *
 * 导出是为了让预览脚本（`probe/_preview-ui.tsx`）能画出**真正一样**的对话流 ——
 * 另写一份「差不多的」渲染就等于把同一件事做两遍，迟早不一样。
 */
export function RowView({ row }: { row: Row }) {
  // 空行必须**画一个空格**，不能什么都不画。
  //
  // ⚠️ Ink 里空的 <Text>（没有任何子节点）高度是 **0**，不是 1。
  // 于是「一行空行」会凭空消失，整个盒子比预算矮一截 ——
  // 表现出来就是「内容比预期短、下面空出一大块」。
  // 计划全文里空行多，所以那里最明显；而且空行数随滚动变化，
  // 看起来就是「一会多一会少」。
  if (row.kind === 'gap') return <Text> </Text>
  const hasPrefix = row.prefix !== undefined && row.prefix !== ''
  if (!hasPrefix && row.text === '' && row.live !== true) return <Text> </Text>

  const prefixColor = row.prefixTone === undefined ? undefined : TONE_COLOR[row.prefixTone]
  const bodyColor = row.bodyTone === undefined ? undefined : TONE_COLOR[row.bodyTone]
  return (
    <Text>
      {row.prefix !== undefined && <Text color={prefixColor}>{row.prefix}</Text>}
      {row.text !== '' && <Text color={bodyColor}>{row.text}</Text>}
      {row.live === true && <Text color={P.attention}>▏</Text>}
    </Text>
  )
}

export interface AppProps {
  session: any
  binding: any
  /** 待处理交互的队列（审批 / 提问 / 计划评审） */
  interactions: {
    getSnapshot(): readonly PendingInteraction[]
    subscribe(listener: () => void): () => void
  }
  title?: string
  onExit: () => void
  interactive?: boolean
  initialMessage?: string
  initialShowReasoning?: boolean
  keyDebug?: boolean
  /** 自检用：收到审批/提问时自动应答，让端到端能跑完 */
  autoAnswer?: 'approve' | 'reject'
  /**
   * dsh 暴露的斜杠命令清单（启动时问一次，见 index.tsx）。
   * 拿不到时给空数组也行 —— 命令面板会显示「没有匹配的命令」，手打命令不受影响。
   */
  commands?: readonly SlashCommand[]
  /**
   * 拿不到终端尺寸时的兜底（管道输出、测试用 renderToString）。
   * 只影响 `useStdout()` 给不出值的情形，真实终端里用不到。
   */
  fallbackSize?: FallbackSize
  /**
   * **只给测试用**：一上来就填好草稿。
   *
   * 存在的理由：像命令面板这种「要按了键才出现」的东西，
   * `renderToString` 里按不了键（`useInput` 是空实现），
   * 没有入口就永远测不到它的整屏布局 —— 而布局正是最容易算错的地方。
   */
  initialDraft?: string
  /** **只给测试用**：一上来就把命令面板打开（配合 initialDraft 用）*/
  initialPaletteCursor?: number
}

export function App({
  session, binding, interactions, title, onExit,
  interactive = true, initialMessage, initialShowReasoning = false, keyDebug = false, autoAnswer,
  fallbackSize, commands = [], initialDraft, initialPaletteCursor,
}: AppProps) {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const size = useTerminalSize(fallbackSize)
  const { setCursorPosition } = useCursor()

  const [entries, setEntries] = useState<readonly any[]>(() => binding.eventSource.getSnapshot().entries)
  const [snap, setSnap] = useState<any>(() => session.getSnapshot())
  const [editor, setEditor] = useState<ed.Editor>(() => ed.insert(ed.empty(), initialDraft ?? ''))
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [showReasoning, setShowReasoning] = useState(initialShowReasoning)
  const [scroll, setScroll] = useState(0)
  const [lastKey, setLastKey] = useState('')

  // ── 命令面板 ──────────────────────────────────────────────────
  //
  // 只存「打开了没、光标在第几条」；**筛选条件直接从输入框的文字推**，
  // 不另存一份 —— 两份状态就得同步，而同步就会有一帧对不上。
  // 所以：输入框里是 `/pl`，面板就自动只显示 `/plan`。
  const [paletteCursor, setPaletteCursor] = useState<number | undefined>(initialPaletteCursor)
  /**
   * 命令的**参数子面板**（选中一条需要参数的命令之后弹出来的那一层）。
   *
   * 用户的原话：「不要命令，只要选项 …… 不然写参数很麻烦」。
   * 有了它，`/permission` 的三个预设就是三个可选项，一个字都不用打。
   * undefined = 没进子面板（正在看命令列表）。
   */
  const [argPanel, setArgPanel] = useState<{ command: SlashCommand; cursor: number } | undefined>(undefined)
  const sending = useRef(false)
  /** 防止连按 Esc 发一堆取消请求 */
  const cancelPending = useRef(false)

  // ── 待处理交互 ────────────────────────────────────────────────
  const [queue, setQueue] = useState<readonly PendingInteraction[]>(() => interactions.getSnapshot())
  useEffect(() => {
    const sync = () => setQueue(interactions.getSnapshot())
    sync()
    return interactions.subscribe(sync)
  }, [interactions])
  const pending = queue[0]

  // 审批面板的光标
  const [approvalCursor, setApprovalCursor] = useState(0)
  // 提问流程
  const [flow, setFlow] = useState<QuestionFlowState>(() => initialFlow([]))
  // 面板切换时重置内部状态
  const pendingId = pending?.id
  /**
   * 这次面板带不带「全文」（计划评审就是这种）。
   *
   * ⚠️ 这里**不能**用下面的 `detailRows` —— 那个是后面才算出来的，
   * 而下面那段重置逻辑必须排在这些 state 的定义之后、渲染之前。
   * 所以直接从 pending 的第一题上判断，两者对计划评审是等价的
   * （计划评审永远只有一道题）。
   */
  const showingDetail = pending !== undefined && detailOf(pending, undefined) !== undefined

  /**
   * 面板换了 → 把「属于这一次交互」的状态重置回初始值。
   *
   * ⚠️ 这里用 **React 官方的「渲染期调整 state」**写法，而不是 useEffect。
   *
   * 为什么不能用 effect：effect 在**提交之后**才跑，所以会先用上一次的
   * flow / 光标 / 滚动位置渲染一帧，然后才纠正过来。表现就是闪一下 ——
   * 计划全文会先出现在末尾、再跳到开头；面板会先显示上一题的选项。
   * （这个坑是代码审查指出来的，当时用的是 effect。）
   *
   * 渲染期 setState 不会提交中间态：React 会立刻用新值重跑渲染，
   * 用户一帧都看不到旧状态。
   */
  const [panelFor, setPanelFor] = useState<string | undefined>(undefined)
  if (panelFor !== pendingId) {
    setPanelFor(pendingId)
    setApprovalCursor(0)
    setFlow(pending !== undefined && pending.kind === 'question' ? initialFlow(pending.questions) : initialFlow([]))
    // scroll 表示「距底部多少行」：很大的数 = 滚到顶。
    // 计划全文给人从头读，所以到顶；普通对话停在底部 = 最新消息。
    setScroll(showingDetail ? Number.MAX_SAFE_INTEGER : 0)
    // 审批/提问来了就把命令面板收掉 —— 键盘归属必须只有一个
    setPaletteCursor(undefined)
    setArgPanel(undefined)
  }

  // 自检：面板渲染出来 1.5 秒后自动应答（先让画面有机会被看到）
  useEffect(() => {
    if (autoAnswer === undefined || pending === undefined) return
    const at = setTimeout(() => {
      if (pending.kind === 'approval') {
        pending.settle(autoAnswer === 'approve' ? 'allowed-once' : 'rejected')
      } else {
        const first = pending.questions[0]
        pending.settle(first === undefined ? [] : [{
          id: first.id,
          selected: first.options?.[0] === undefined ? [] : [first.options[0].label],
          ...(first.options === undefined || first.options.length === 0 ? { custom: '(自检自动回答)' } : {}),
        }])
      }
    }, 1500)
    return () => { clearTimeout(at) }
  }, [autoAnswer, pending])

  // ── 订阅会话 ──────────────────────────────────────────────────
  useEffect(() => {
    const es = binding.eventSource
    const onEvents = () => setEntries(es.getSnapshot().entries)
    const onSession = () => setSnap(session.getSnapshot())
    onEvents(); onSession()
    const u1 = es.subscribe(onEvents)
    const u2 = session.subscribe(onSession)
    return () => { u1(); u2() }
  }, [binding, session])

  // 光标改成下划线样式（DECSCUSR 4）。退出时还原。
  useEffect(() => {
    if (!interactive) return
    stdout?.write('\u001b[4 q')
    return () => { stdout?.write('\u001b[0 q') }
  }, [stdout, interactive])

  // ── 内容 ──────────────────────────────────────────────────────
  const transcriptLines = useMemo(() => buildTranscript(entries), [entries])
  const transcriptRows = useMemo(
    () => layoutLines(transcriptLines, { width: size.columns, showReasoning }),
    [transcriptLines, size.columns, showReasoning],
  )

  const questionNow = pending?.kind === 'question' ? pending.questions[flow.index] : undefined
  const detail = pending === undefined ? undefined : detailOf(pending, flow)

  /** 面板激活且题目带 detail 时，可滚动区改显示全文。 */
  const detailRows: Row[] | undefined = useMemo(() => {
    if (detail === undefined) return undefined
    return wrapText(detail, Math.max(4, size.columns)).map(text => ({ kind: 'line' as const, text }))
  }, [detail, size.columns])

  const activeRows = detailRows ?? transcriptRows

  // 面板
  const panelRows: PanelRow[] | undefined = useMemo(() => {
    if (pending === undefined) return undefined
    if (pending.kind === 'approval') {
      return buildApprovalPanel(pending, approvalCursor, size.columns)
    }
    if (questionNow === undefined) return undefined
    return buildQuestionPanel(questionNow, flow, {
      index: flow.index,
      total: pending.questions.length,
    }, size.columns)
  }, [pending, approvalCursor, questionNow, flow, size.columns])

  // ── 高度分配 ──────────────────────────────────────────────────
  //
  // 唯一规则：这里算出来的行数**必须等于实际渲染的行数**。
  // Ink 的 Box 装不下时不是裁剪，而是挤压/丢行（见 cursor.ts 坑 2），
  // 差一行就是花屏，而且表现出来只是「有点歪」，极难定位。
  //
  // 所以下面每一项都对应渲染里切切实实会占的行，不留「大概一行」的估计：
  //
  //   标题栏   1
  //   滚动区   scrollHeight（内部由 scrollLayout 自己保证不超）
  //   提示     noticeLines.length（会换行，所以按真实折行数算）
  //   下半区   lowerHeight（面板或输入框，都含边框）
  //   状态行   1
  const composerView = useMemo(
    // 可用宽度由 ComposerBox 自己算（它才知道边框和内边距占多少），
    // 这里不写 `columns - 6` 那种魔法数字。
    () => layoutInput(
      editor.text, editor.cursor,
      composerContentWidth(size.columns),
      MAX_INPUT_LINES,
    ),
    [editor, size.columns],
  )

  /** 提示/错误文字。可能很长（比如服务端错误），所以按真实折行算，并封顶。 */
  const noticeLines = useMemo(
    () => (notice === undefined
      ? []
      : capLines(wrapText(`· ${notice}`, size.columns), MAX_NOTICE_LINES, size.columns)),
    [notice, size.columns],
  )

  // 下半区占几行 —— 由各自的盒子说了算，这里只做选择。
  // 绝不在这里重算一遍边框/提示行，否则改了渲染忘了改预算就是花屏。
  // 命令面板：只有「已经打开 + 输入框里确实是个没打完的命令 + 没有别的事件面板」时才显示。
  // 三个条件少一个都不显示 —— 尤其最后一个：审批面板优先级更高，
  // 它一来就得把命令面板让出去，否则键盘归属会打架。
  // ── 会话投影：状态行的数字、以及命令面板里 /permission 的选项 ──
  //
  // 全是 dsh 算好的，我们只读。取不到就是 undefined —— statusCandidates()
  // 会直接把那一项省掉，绝不编一个数字出来。
  const statsProjection = useProjection(session, 'sessionStats')
  const tokenProjection = useProjection(session, 'tokenUsage')
  const costProjection = useProjection(session, 'costUsage')
  const pressureProjection = useProjection(session, 'contextPressure')
  const permissionsProjection = useProjection(session, 'permissions')
  const statusNumbers = useMemo(
    () => readStatusNumbers({
      stats: statsProjection,
      tokens: tokenProjection,
      cost: costProjection,
      pressure: pressureProjection,
    }),
    [statsProjection, tokenProjection, costProjection, pressureProjection],
  )
  /** /permission 的可选预设 —— 从投影读，不硬编码 */
  const permissionOptions: readonly PermissionOption[] =
    permissionsProjection?.options ?? []

  const palettePrefix = paletteCursor === undefined ? undefined : commandPrefixOf(editor.text)
  const paletteOpen = palettePrefix !== undefined && pending === undefined
  const paletteMatches = useMemo(
    () => (paletteOpen ? filterCommands(commands, palettePrefix) : []),
    [paletteOpen, commands, palettePrefix],
  )
  /** 当前子面板里的可选项（`/permission` 的预设从投影读，见 commands.ts） */
  const argChoices: readonly CommandArgument[] = useMemo(
    () => (argPanel === undefined ? [] : argumentsOf(argPanel.command, permissionOptions)),
    [argPanel, permissionOptions],
  )
  const paletteRows: PanelRow[] | undefined = useMemo(() => {
    if (!paletteOpen) return undefined
    if (argPanel !== undefined) {
      return buildArgPanel(argPanel.command, argChoices, argPanel.cursor, size.columns)
    }
    return buildCommandPalette(paletteMatches, paletteCursor ?? 0, size.columns)
  }, [paletteOpen, argPanel, argChoices, paletteMatches, paletteCursor, size.columns])

  /**
   * 面板最多占几行正文。
   *
   * 不能简单取「终端一半」—— 还要给标题行、状态行、输入框、滚动区的**最小 3 行**
   * 留出地方（`contentHeight` 有 `Math.max(3, …)` 兜底，不预留的话它会顶穿）。
   * 命令面板这一族就是没走这个上限才花屏的（评审逮到）。
   */
  const maxPanelRows = Math.max(3, Math.floor(size.rows / 2))
  /**
   * 事件面板裁完之后的最终行数 —— 预算用这个数。
   *
   * 渲染那边由 `PanelBox` 自己调同一个 `panelLayout()`，
   * 所以「算的」和「画的」不可能对不上（早先是两处各算各的，漏一个就花屏）。
   */
  const panelHeightRows = panelRows === undefined
    ? 0
    : panelLayout(panelRows, maxPanelRows, size.columns).height

  // 命令面板**叠在输入框上面**，不顶替它 —— 用户的原话：
  // 「命令选项应该在输入框上面，输入框就始终在底部」。
  // 理由也顺：你正是在输入框里敲 `/` 才叫出它的，把输入框藏起来就没法接着打字了。
  // （事件面板不同：审批/提问时要独占键盘，所以那个是**顶替**输入框。）
  // 命令面板也走同一个上限 —— 它以前整个绕过了裁剪（终端矮于 ~21 行就花屏）
  const paletteHeight = paletteRows === undefined
    ? 0
    : panelLayout(paletteRows, maxPanelRows, size.columns).height

  // 下半区（面板或输入框）占几行 —— 由各自的盒子说了算，这里只做选择。
  // 绝不在这里重算一遍边框/提示行，否则改了渲染忘了改预算就是花屏。
  const lowerHeight = panelRows !== undefined
    ? panelHeightRows
    : composerHeight(composerView)

  const scrollHeight = contentHeight(
    size.rows,
    1 /*标题*/ + paletteHeight + lowerHeight + noticeLines.length + 1 /*状态*/,
  )

  // 历史是不是只载入了最近一页。官方 open() 只拉最后 50 条，更早的要 loadOlder 前拉。
  const hasMore = snap?.hasMore === true
  const loadingOlder = snap?.loadingOlder === true

  // 滚动区里放什么 —— 提示行跟内容行互相抢位置，所以交给 scrollLayout 一起算。
  // wantNotice：滚到顶时如果有更早的历史可载入 / 正在载入，也要占一行说明。
  const scrollView = scrollLayout(activeRows, scrollHeight, scroll, {
    externalNotice: hasMore || loadingOlder,
    // 显示计划全文时提示行常驻：否则滚到顶它消失、内容区突然多一行，文字会跳
    alwaysNotice: detailRows !== undefined,
  })
  const visibleRows = scrollView.visible
  const hiddenAbove = scrollView.hiddenAbove
  const running = snap?.running === true

  // ── 光标定位 ──────────────────────────────────────────────────
  // 逻辑：无面板 → 输入框；面板里在编辑自定义回答 → 面板那一行；其余 → 隐藏
  const composerRef = useRef<any>(null)
  const customRef = useRef<any>(null)
  const cursorTargetRef = useRef<{ x: number; y: number } | undefined>(undefined)
  const [, bumpLayout] = useReducer((n: number) => n + 1, 0)

  const editingCustom = pending?.kind === 'question' && flow.editing
  // 光标之前那一段占几列 —— 用和折行同一套结果的辅助函数，不在这里重算
  const composerTail = composerView.lines[composerView.cursorLine] ?? ''
  const composerBefore = cursorBeforeWidth(composerTail, composerView.cursorCol)

  useLayoutEffect(() => {
    const node = editingCustom === true ? customRef.current : (panelRows === undefined ? composerRef.current : null)
    if (!interactive || node === null || node === undefined) {
      if (cursorTargetRef.current !== undefined) {
        cursorTargetRef.current = undefined
        bumpLayout()
      }
      return
    }
    const m = measureElement(node)
    if (m.width === 0 && m.height === 0) return
    // 面板会告诉我们：光标在「自己输入」的第几行、距行首多少列
    const customOffset = panelLayout(panelRows ?? [], maxPanelRows, size.columns).rows.find(r => r.customInput === true)?.customCursorX ?? 0
    const target = editingCustom === true
      ? { x: m.x + customOffset, y: m.y + CURSOR_Y_COMPENSATION }
      : {
        x: m.x + INPUT_PREFIX_WIDTH + composerBefore,
        y: m.y + composerView.cursorLine + CURSOR_Y_COMPENSATION,
      }
    const prev = cursorTargetRef.current
    if (prev === undefined || prev.x !== target.x || prev.y !== target.y) {
      cursorTargetRef.current = target
      bumpLayout()
    }
  })

  // 渲染期设置（官方 Ink 的 useCursor 只认渲染期设的值，否则慢一帧）
  if (!interactive || cursorTargetRef.current === undefined) setCursorPosition(undefined)
  else setCursorPosition(cursorTargetRef.current)

  // ── 发送 ──────────────────────────────────────────────────────
  async function send(textArg?: string) {
    const text = (textArg ?? editor.text).trim()
    if (text === '' || sending.current) return
    setEditor(ed.empty())
    setNotice(undefined)
    setScroll(0)
    sending.current = true
    try {
      // 以 / 开头 → 走「命令」而不是「提示词」。
      // 官方设计明确要求：命令行绝不能静默降级成普通提示词。
      if (text.startsWith('/')) {
        const res = await session.command(text)
        if (res?.ok === false) {
          setNotice(`命令执行失败：${res.error?.message ?? '未知错误'}`)
        } else if (res?.value?.matched === false) {
          setNotice(`无法识别的命令：${text.trim().split(/\s+/)[0]}（未发送）`)
        }
        return
      }

      // 插话发送：agent 正在跑 → steer（插进当前回合，在下一个步骤边界被领取）；
      // 空闲 → queue（正常开一个新回合）。
      const mode = running ? 'steer' : 'queue'
      const handle = session.beginSubmission({ mode, text, attachments: [] })
      try {
        const res = await session.prompt([{ type: 'text', text }], mode, undefined, handle.requestId)
        if (res?.ok === false) {
          setNotice(`发送失败：${res.error?.message ?? '未知错误'}`)
          // 这里**不用** abandon()：带 requestId 的 prompt 失败时，
          // 官方自己会 retireFailedSubmission(requestId)（见
          // dsh-api-session-controller 的 client.js），abandon 是空动作。
        }
      } catch (error) {
        // 这一条才是真要 abandon 的：prompt 直接抛异常，可能还没走到官方的 retire，
        // 本地那条 pendingSubmissions 回声会一直留到 dispose，让会话状态不干净。
        handle.abandon()
        throw error
      }
    } catch (error) {
      setNotice(`发送失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      sending.current = false
    }
  }

  /**
   * 在命令面板里选中了一条命令。
   *
   * 三条路：
   *   1. 不需要参数（`/compact`）→ 直接执行
   *   2. 需要参数**而且我们知道有哪些**（`/permission`）→ 进子面板，让用户选
   *   3. 需要参数但我们不知道有哪些 → 老实把命令名填进输入框，让用户自己打
   *      （不假装知道 —— 见 commands.ts 里 argumentsOf 的说明）
   */
  function pickCommand(command: SlashCommand): void {
    if (command.input === undefined) {
      setPaletteCursor(undefined)
      setEditor(ed.empty())
      void send(`/${command.name}`)
      return
    }

    const args = argumentsOf(command, permissionOptions)
    if (args.length > 0) {
      setArgPanel({ command, cursor: 0 })
      return
    }

    const completion = completionFor(command)
    setPaletteCursor(undefined)
    if (completion !== null) setEditor({ text: completion, cursor: completion.length })
  }

  /**
   * 在参数子面板里选中了一项。
   *
   * - `execute`：整条命令直接跑（`/permission read-only`）
   * - `fill`：把命令名和空格填进输入框，等用户补一段自由文本（`/feedback `）
   *   —— 自由文本没法变成选项，这是唯一诚实的做法
   */
  function pickArgument(arg: CommandArgument): void {
    setArgPanel(undefined)
    setPaletteCursor(undefined)
    switch (arg.action) {
      case 'execute':
        setEditor(ed.empty())
        void send(arg.command)
        return
      case 'fill':
        setEditor({ text: arg.prefix, cursor: arg.prefix.length })
        return
    }
  }

  /**
   * 停掉正在跑的 agent。
   *
   * 用户明确要求有这个快捷键。用 `Esc` —— 这是终端里"停下正在发生的事"
   * 的通用键，也是所有人第一反应会去按的那个。
   *
   * 官方接口是 `session.cancel()`，返回 `{ accepted: true }`（「已受理」，
   * 不等于「已经停住」——真正的停是一个过程，状态由 `snapshot.running` 反映）。
   * 这里加了防重入：连着按 Esc 不要发一堆取消请求。
   */
  function cancelAgent(): void {
    if (cancelPending.current) return
    cancelPending.current = true
    setNotice('正在停止…')
    void Promise.resolve(session.cancel?.())
      .then((res: any) => {
        if (res?.ok === false) setNotice(`停止失败：${res.error?.message ?? '未知错误'}`)
        else setNotice('已请求停止')
      })
      .catch((error: unknown) => {
        setNotice(`停止失败：${error instanceof Error ? error.message : String(error)}`)
      })
      .finally(() => { cancelPending.current = false })
  }

  /** 打开命令面板（按 `/` 或 Tab 时调）。 */
  function openPalette(): void {
    setArgPanel(undefined)
    setPaletteCursor(0)
  }

  const autoSent = useRef(false)
  useEffect(() => {
    if (initialMessage === undefined || autoSent.current) return
    autoSent.current = true
    void send(initialMessage)
  })

  // ── 滚动 ──────────────────────────────────────────────────────
  const pageStep = Math.max(1, scrollHeight - 1)

  /**
   * 往上翻到底了还想继续翻 → 跟官方要一页更早的历史。
   *
   * 官方的 loadOlder() 自己会在「还没打开 / 没有更多 / 正在载入」时直接返回，
   * 所以这里不用重复判断，重复调用也是安全的。
   */
  const loadOlderIfAtTop = (): void => {
    if (!hasMore || loadingOlder) return
    void Promise.resolve(session.loadOlder?.()).catch((error: unknown) => {
      // 失败不该静默 —— 否则用户只会看到「按了没反应」
      setNotice(`载入更早记录失败：${error instanceof Error ? error.message : String(error)}`)
    })
  }

  const scrollBy = (delta: number) => {
    // ⚠️ 基准要用 clampedScroll，不能用原始的 scroll ——
    // 「跳到顶部」是往 state 里塞了一个 MAX_SAFE_INTEGER，
    // 拿它去加减永远还是那么大，按 PgUp 会一动不动。
    const next = Math.max(0, Math.min(scrollView.scrollLimit, scrollView.clampedScroll + delta))
    setScroll(next)
    // 已经在最上面还要继续往上翻 → 拉一页
    if (delta > 0 && scrollView.atTop && next >= scrollView.scrollLimit) loadOlderIfAtTop()
  }

  // ── 键盘 ──────────────────────────────────────────────────────
  useInput((char, key) => {
    if (keyDebug) {
      const flags = Object.entries(key).filter(([, v]) => v === true).map(([k]) => k)
      setLastKey(`input=${JSON.stringify(char)} flags=[${flags.join(' ')}]`)
    }
    const ctrl = (letter: string): boolean => isCtrlChar(char, key, letter)

    // 退出
    if (ctrl('c')) { onExit(); exit(); return }

    // 滚动：两种模式共用
    if (key.pageUp) { scrollBy(pageStep); return }
    if (key.pageDown) { scrollBy(-pageStep); return }
    if (ctrl('p')) { scrollBy(1); return }
    if (ctrl('n')) { scrollBy(-1); return }

    // ── 面板独占键盘 ────────────────────────────────────────────
    //
    // 判据是 **panelRows，不是 pending** —— 键盘归属者必须跟屏幕上真正
    // 画出来的东西一致。否则一旦出现「有 pending 但画不出面板」的状态，
    // 键盘会被一个看不见的面板吃掉：用户看到的是一个能打字却打不进字的输入框，
    // 而那个交互永远不 settle（agent 干等）。
    // （这类状态现在已经在 InteractionQueue 源头堵掉了，但判据本身要立对。）
    if (panelRows !== undefined && pending !== undefined) {
      if (pending.kind === 'approval') {
        if (key.upArrow) { setApprovalCursor(0); return }
        if (key.downArrow) { setApprovalCursor(1); return }
        if (key.escape) { pending.settle('rejected'); return }
        if (char === 'y' || char === 'Y') { pending.settle('allowed-once'); return }
        if (char === 'n' || char === 'N') { pending.settle('rejected'); return }
        if (key.return) {
          pending.settle(approvalCursor === 0 ? 'allowed-once' : 'rejected')
          return
        }
        return
      }

      // 提问 / 计划评审
      const questions = pending.questions
      const apply = (action: Parameters<typeof reduceFlow>[1]) => {
        const { state, done } = reduceFlow(flow, action, questions)
        setFlow(state)
        if (done !== undefined) pending.settle(done as readonly QuestionAnswerItem[])
      }
      if (flow.editing) {
        if (key.escape) { apply({ type: 'cancelEdit' }); return }
        if (isNewlineKey(char, key)) { apply({ type: 'insert', text: '\n' }); return }
        if (key.return) { apply({ type: 'confirm' }); return }
        if (key.backspace || key.delete) { apply({ type: 'backspace' }); return }
        if (char && !key.ctrl && !key.meta) { apply({ type: 'insert', text: char }); return }
        return
      }
      if (key.upArrow) { apply({ type: 'up' }); return }
      if (key.downArrow) { apply({ type: 'down' }); return }
      if (key.return) { apply({ type: 'confirm' }); return }
      // 空格：多选时是「勾选」；单选时就是个普通字符（直接开始自己输入）
      if (char === ' ') {
        if (questionNow?.multiSelect === true) apply({ type: 'toggle' })
        else apply({ type: 'type', text: ' ' })
        return
      }
      // 直接打字 = 开始自己输入，不用先按 Enter 选中「自己输入…」
      if (char !== '' && !key.ctrl && !key.meta) { apply({ type: 'type', text: char }); return }
      return
    }

    // ── 命令面板 ────────────────────────────────────────────────
    //
    // 它比输入框优先，但**比事件面板低**：审批/提问来了必须让位。
    if (paletteOpen) {
      // 参数子面板：这时候 ↑↓ 选的是**参数**，不是命令
      if (argPanel !== undefined) {
        const total = argChoices.length
        const at = Math.max(0, Math.min(argPanel.cursor, Math.max(0, total - 1)))
        if (key.upArrow) { setArgPanel({ ...argPanel, cursor: (at - 1 + total) % Math.max(1, total) }); return }
        if (key.downArrow) { setArgPanel({ ...argPanel, cursor: (at + 1) % Math.max(1, total) }); return }
        // Esc / Tab：退回命令列表（不是关掉整个面板）
        if (key.escape || key.tab) { setArgPanel(undefined); setPaletteCursor(0); return }
        if (key.return) {
          const picked = argChoices[at]
          if (picked !== undefined) pickArgument(picked)
          return
        }
        return
      }

      const total = paletteMatches.length
      const at = Math.max(0, Math.min(paletteCursor ?? 0, Math.max(0, total - 1)))
      if (key.upArrow) { setPaletteCursor((at - 1 + total) % Math.max(1, total)); return }
      if (key.downArrow) { setPaletteCursor((at + 1) % Math.max(1, total)); return }
      if (key.escape || key.tab) { setPaletteCursor(undefined); setEditor(ed.empty()); return }
      if (key.return) {
        const picked = paletteMatches[at]
        if (picked !== undefined) pickCommand(picked)
        return
      }
      // 继续打字 = 继续筛选（筛选条件是从输入框文字推的，所以只要插进去就行）
      if (key.backspace) { setEditor(ed.backspace); return }
      if (char && !key.ctrl && !key.meta) { setEditor(e => ed.insert(e, char)); return }
      return
    }

    // ── 输入框 ──────────────────────────────────────────────────
    if (ctrl('o')) {
      setShowReasoning(v => !v)
      setNotice(showReasoning ? '已折叠思考' : '已展开思考')
      return
    }
    if (isNewlineKey(char, key)) {
      setEditor(e => ed.insert(e, '\n'))
      return
    }
    if (key.return) { void send(); return }
    if (key.leftArrow) { setEditor(ed.moveLeft); return }
    if (key.rightArrow) { setEditor(ed.moveRight); return }
    if (key.upArrow) { setEditor(e => ed.moveVertical(e, -1)); return }
    if (key.downArrow) { setEditor(e => ed.moveVertical(e, 1)); return }
    if (ctrl('u')) { setEditor(ed.empty()); setNotice(undefined); return }
    if (key.backspace) { setEditor(ed.backspace); return }
    if (key.delete) { setEditor(ed.deleteForward); return }
    if (key.escape) {
      // agent 在跑 → Esc = 停下（用户的明确要求）
      // 空闲时 → 留给以后的菜单
      if (running) { cancelAgent(); return }
      setNotice('Esc 菜单尚未实现')
      return
    }
    // Tab：想打命令时叫出面板；否则还是插入两个空格（缩进）
    //
    // ⚠️ 空输入框也必须认 —— 用户第一次按 Tab 时输入框多半是空的，
    // 那时如果只是「插入两个看不见的空格」，看起来就是**毫无反应**。
    if (key.tab) {
      if (editor.text === '' || commandPrefixOf(editor.text) !== undefined) openPalette()
      else setEditor(e => ed.insert(e, '  '))
      return
    }
    // 输入框空着时敲 `/` → 不插入，直接弹出命令面板（省得背命令名）
    if (char === '/' && editor.text === '') {
      setEditor(e => ed.insert(e, '/'))
      openPalette()
      return
    }
    if (char && !key.ctrl && !key.meta) setEditor(e => ed.insert(e, char))
  }, { isActive: interactive })

  // 状态行右边那个词先定下来，左边提示的可用宽度由它反推 ——
  // 不写死「留 12 列」，因为换个文案就会算错。
  const statusWord = pending !== undefined ? '● 等你回应' : running ? '● 工作中' : '○ 空闲'

  /** 两边并排的行，可用宽度 = 总宽 - 右边实际占用 - 1 个空格 */
  const sideBySide = (right: string) => Math.max(1, size.columns - displayWidth(right) - 1)

  // 标题栏：徽标 + 标题 在左，翻页提示在右。
  // 标题必须按**显示宽度**裁 —— 24 个汉字是 48 列，按 .slice(0,24) 裁会折行。
  /**
   * 滚动区顶部那一行说什么。
   *
   * 滚到顶时要说清楚「上面真的没有了」还是「还有，但要按 PgUp 去要」——
   * 早先这里只有「上面还有 N 行」，而 N 只统计**已载入**的行数，
   * 于是用户在历史被截断的情况下会以为已经看到全部了（实际只有最近 50 条）。
   */
  /**
   * 滚到顶时那句「上面真的没有了 / 还有，但要按 PgUp 去要」。
   *
   * 这只在**对话**模式下成立 —— 显示计划全文时滚动区里装的是一份文档，
   * 跟「历史记录分页」没关系，套用那套文案会说不通
   *（实测就出现过「↑ 已到最早的记录」出现在计划上）。
   */
  const historyNotice = showingDetail
    ? undefined
    : loadingOlder
      ? '↑ 正在载入更早记录…'
      : hasMore
        ? '↑ 尚有更早记录 · PgUp 载入'
        : '↑ 已是最早记录'

  const directionNotice = scrollNoticeText({
    hiddenAbove: scrollView.hiddenAbove,
    hiddenBelow: scrollView.hiddenBelow,
    external: historyNotice,
  })
  // 计划全文模式加个前缀，一眼知道滚的是什么东西，而且提示行常驻不会忽隐忽现
  const topNotice = showingDetail
    ? (directionNotice === '' ? '计划全文' : `计划全文 · ${directionNotice}`)
    : directionNotice

  /**
   * 按键提示。
   *
   * ⚠️ 它从**状态行搬到了标题栏** —— 状态行现在要显示实际数据
   *（轮次/步数/速度/缓存命中，跟 dsh 自己的 Web UI 一致，用户要求）。
   * 提示归上面、数据归下面，各占一行，不用互相抢地方。
   */
  // ⚠️ 可用宽度必须扣掉左边的「 dsht 」徽标 + 一个空格 ——
  // 早先按 `columns - 1` 算，于是提示一长就把标题栏折成两行，
  // 而折掉的那一行没人记账 → Ink 挤压丢内容行（评审实测：45 列时必现）。
  const headerHintWidth = Math.max(1, size.columns - BADGE_WIDTH - 1)
  const headerHint = clip(
    pickHint(
      pending !== undefined
        ? (pending.kind === 'approval'
          ? ['↑↓ 选择 · Enter 确认 · Esc 拒绝', '↑↓ 选择 · Enter 确认']
          // 提问面板没有「拒绝」这一说，别复用审批的文案
          : ['↑↓ 选择 · Enter 确认 · 打字可自行回答', '↑↓ 选择 · Enter 确认'])
        : (running ? KEY_HINTS_RUNNING : KEY_HINTS),
      headerHintWidth,
    ),
    headerHintWidth,
  )

  // 兜底成空串而不是留 undefined —— clip() 会崩在 undefined 上，
  // 而标题只是装饰，不该有能力把整个界面搞崩。
  const titleText = String(
    (title !== undefined && title !== '') ? title : (session.sessionId ?? ''),
  )
  const shownTitle = clip(
    titleText,
    Math.max(0, size.columns - BADGE_WIDTH - displayWidth(headerHint) - 2),
  )

  /**
   * 状态行左边：会话的实际数据。
   *
   * 数字全部来自 dsh 的投影，我们不自己算、更不估。取不到就整段省掉 ——
   * 空着也比编一个数字强（用户对花费敏感，编数字只会让他更焦虑）。
   * 按宽度从长到短降级，第一段（轮次）永远留着。
   */
  const statusLeft = clip(
    pickHint(statusCandidates(statusNumbers), sideBySide(statusWord)),
    sideBySide(statusWord),
  )

  return (
    <Box flexDirection="column" width={size.columns} height={size.rows}>
      {/* 标题栏 */}
      <Box width={size.columns} justifyContent="space-between">
        <Box>
          <Text backgroundColor={P.border} color="black"> dsht </Text>
          <Text color={P.dim}>{' '}{shownTitle}</Text>
        </Box>
        <Text color={P.dim}>{headerHint}</Text>
      </Box>

      {/* 可滚动区：平时是对话，面板带 detail 时换成全文 */}
      <Box flexDirection="column" height={scrollHeight} overflow="hidden">
        {/* 顶部提示行占掉一行内容位 —— 这件事由 scrollLayout 统一算，
            它保证「提示 + visibleRows」加起来正好等于 scrollHeight。 */}
        {scrollView.showNotice && (
          <Text color={P.dim}>{topNotice}</Text>
        )}
        {activeRows.length === 0 && <Text color={P.dim}>（尚无对话）</Text>}
        {visibleRows.map((row, i) => <RowView key={i} row={row} />)}
      </Box>

      {/* 提示 / 错误。行数已经算进高度 —— noticeLines 是折好并封顶的。 */}
      {noticeLines.map((line, i) => <Text key={i} color={P.dim}>{line}</Text>)}

      {/* 命令面板：叠在输入框**上面**，输入框始终留在底部 */}
      {paletteRows !== undefined
        && <PanelBox rows={paletteRows} maxRows={maxPanelRows} width={size.columns} />}

      {/* 下半区：事件面板 或 输入框。两者各自负责「自己占几行」。 */}
      {panelRows !== undefined
        ? <PanelBox rows={panelRows} maxRows={maxPanelRows} width={size.columns} customRef={customRef} />
        : <ComposerBox view={composerView} running={running} contentRef={composerRef} />}

      {/* 状态行 */}
      <Box width={size.columns} justifyContent="space-between">
        <Text color={P.dim}>{keyDebug && lastKey !== '' ? lastKey : statusLeft}</Text>
        <Text color={pending !== undefined ? P.attention : running ? P.tool : P.dim}>
          {statusWord}
        </Text>
      </Box>

      {/* ⚠️ 别在这里补「末尾空行」。
          早期为让输出以换行结尾而加过一个空 Text，实测它渲染 0 行、纯属无操作；
          而且那个做法早就废弃了 —— 现在是用满整屏 + CURSOR_Y_COMPENSATION 显式补偿。
          详见 cursor.ts 的「坑 2」和该常量的说明。 */}
    </Box>
  )
}
