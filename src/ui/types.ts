// 事件的宽松类型声明
//
// 官方客户端是动态加载的 JS，没有随包提供可用的 TS 类型入口。
// 与其编造精确类型，不如在这里只声明「我们用到的形状」，并注明来源。

/** 一条持久会话事件（dsh 的 session 事件，字段见 docs/RESEARCH.md 第十节）。 */
export interface DshSessionEvent {
  readonly type: string
  readonly seq?: number
  readonly time?: number
  readonly data?: any
}

/** 助手流式增量（client-only，未落盘）。 */
export interface AssistantLiveChunkEvent {
  readonly type: 'assistant/live-chunk'
  readonly seq: number
  readonly data: { readonly chunk: { type: string; text?: string } }
}

export type SessionEventLikeEntry =
  | { readonly type: 'event'; readonly event: DshSessionEvent }
  | { readonly type: 'transient'; readonly event: AssistantLiveChunkEvent }
