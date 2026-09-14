// 把会话事件流翻译成「界面上要显示的一行行内容」
//
// 输入是 binding.eventSource 的快照 entries，输出是纯数据。
// 和渲染分开，方便单独测试。

import type { SessionEventLikeEntry } from './types.ts'
import { sanitizeForDisplay } from './width.ts'

export type Line =
  | { kind: 'user'; text: string }
  | { kind: 'meta'; text: string; tone: 'command' | 'notice' | 'error' }
  | { kind: 'assistant'; text: string; live?: boolean }
  | { kind: 'reasoning'; text: string }
  | { kind: 'tool'; name: string; detail?: string }
  | { kind: 'error'; text: string }

/** 从 content 块数组里分出正文和思考。 */
export function splitContent(content: unknown): { text: string; reasoning: string } {
  let text = ''
  let reasoning = ''
  if (!Array.isArray(content)) return { text, reasoning }
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const b = block as { type?: unknown; text?: unknown }
    if (typeof b.text !== 'string') continue
    if (b.type === 'text') text += b.text
    else if (b.type === 'reasoning') reasoning += b.text
  }
  // 控制字符清掉：\r 和 \t 的终端渲染宽度不可预测，留着会让折行算错。
  // 代码块里的缩进几乎全是 tab，所以这不是边角情况 —— 是每天都会遇到的。
  return { text: sanitizeForDisplay(text), reasoning: sanitizeForDisplay(reasoning) }
}

/**
 * 判断一条 user/message 是不是「用户真的打了字」。
 *
 * 不能靠文字前缀猜 —— dsh 会把很多东西伪装成 user/message 塞进来：
 *   source.kind = 'agent-instructions'  → <system-reminder> 工作区说明
 *   source.kind = 'plugin'              → 运行时上下文快照
 *   source.kind = 'plugin'              → 「background job xxx 结束了」这类通知
 * 它们长得跟用户消息一模一样，只有 source.kind 才是可靠依据。
 */
export function isRealUserMessage(data: unknown): boolean {
  const source = (data as { source?: { kind?: unknown } } | undefined)?.source
  return typeof source === 'object' && source !== null && source.kind === 'user'
}

/** 把工具参数压成一行短摘要。 */
function summarizeToolArgs(data: unknown): string | undefined {
  const d = data as { arguments?: unknown; args?: unknown } | undefined
  const raw = d?.arguments ?? d?.args
  if (raw === undefined) return undefined
  const raw2 = typeof raw === 'string' ? raw : JSON.stringify(raw)
  const text = sanitizeForDisplay(raw2 ?? '')
  if (!text || text === '{}') return undefined
  return text.length > 120 ? text.slice(0, 119) + '…' : text
}

/**
 * 把事件窗口翻译成显示行。
 *
 * 关键点：助手输出的增量（transient）是「还没落盘的流式片段」；
 * 一旦对应的持久事件（assistant/message）到达，就应该用持久版本。
 * 这里用「遇到持久事件就清空增量缓冲」的简单策略处理。
 */
export function buildTranscript(entries: readonly SessionEventLikeEntry[]): Line[] {
  const lines: Line[] = []
  let liveText = ''
  let liveReasoning = ''

  const flush = (): void => {
    if (liveReasoning.trim() !== '') lines.push({ kind: 'reasoning', text: liveReasoning })
    if (liveText !== '') lines.push({ kind: 'assistant', text: liveText, live: true })
    liveText = ''
    liveReasoning = ''
  }

  for (const entry of entries) {
    if (entry.type === 'transient') {
      const chunk = entry.event?.data?.chunk
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') liveText += chunk.text
      else if (chunk?.type === 'reasoning-delta' && typeof chunk.text === 'string') liveReasoning += chunk.text
      continue
    }

    const event = entry.event
    switch (event?.type) {
      case 'user/message': {
        flush()
        if (!isRealUserMessage(event.data)) break // 注入的上下文 / 后台任务通知，不显示
        const { text } = splitContent(event.data?.content)
        if (text !== '') lines.push({ kind: 'user', text })
        break
      }
      case 'assistant/message': {
        flush()
        const content = event.data?.message?.content ?? event.data?.content
        const { text, reasoning } = splitContent(content)
        if (reasoning.trim() !== '') lines.push({ kind: 'reasoning', text: reasoning })
        if (text !== '') lines.push({ kind: 'assistant', text })
        break
      }
      case 'command/run': {
        flush()
        const name = String(event.data?.name ?? '')
        const args = String(event.data?.args ?? '')
        lines.push({ kind: 'meta', text: `/${name}${args}`, tone: 'command' })
        break
      }
      case 'command/done': {
        flush()
        const text = String(event.data?.text ?? '')
        const kind = String(event.data?.kind ?? '')
        if (text !== '') lines.push({ kind: 'meta', text, tone: kind === 'success' ? 'notice' : 'error' })
        break
      }
      case 'tool/call': {
        flush()
        lines.push({
          kind: 'tool',
          name: String(event.data?.name ?? '工具'),
          detail: summarizeToolArgs(event.data),
        })
        break
      }
      case 'agent/error':
      case 'step/error': {
        flush()
        lines.push({ kind: 'error', text: JSON.stringify(event.data)?.slice(0, 200) ?? '出错' })
        break
      }
      case 'turn/end':
      case 'step/end': {
        flush()
        break
      }
      default:
        break
    }
  }

  flush()
  return lines
}
