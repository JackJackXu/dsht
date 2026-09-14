// 待处理的交互（审批 / 提问 / 计划评审）
//
// 数据来源：官方客户端的两条「waterfall」事件——
//   approval/request        工具审批   → 返回 'allowed-once' | 'rejected' | ...
//   user-questions/request  提问       → 返回 { answers: [...] }
//
// 计划评审不是独立协议：它是提问里某道题带了
//   intent: { kind: 'plan-review', approve: '<批准那个选项的标签>' }
// 只是渲染方式不同，协议完全一样。
//
// 这一层只负责「排队 + 通知界面 + 把用户的决定送回去」，不碰渲染。

/** 工具审批的结果词表（官方就这四个）。 */
export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

/** 提问里的一个选项。 */
export interface QuestionOption {
  label: string
  description?: string
}

/** 提问里的「呈现意图」。目前只定义了计划评审。 */
export interface QuestionIntent {
  kind: 'plan-review'
  /** 「批准」那个选项的标签；其余选项都算不批准 */
  approve: string
}

/** 一道题。 */
export interface QuestionItem {
  id: string
  question: string
  detail?: string
  header?: string
  options?: QuestionOption[]
  multiSelect?: boolean
  intent?: QuestionIntent
}

/**
 * 官方的回答信封。
 *
 * ⚠️ 踩过的坑：协议要求返回 `{ answers: [...] }`，**不是裸数组**。
 * 工具端拿到结果后会直接执行 `.answers.map(...)`，
 * 返回裸数组就会报 "Cannot read properties of undefined (reading 'map')"。
 * 这个错看起来像 dsh 的 bug，其实是回答器的形状写错了。
 */
export interface QuestionAnswerEnvelope {
  answers: readonly QuestionAnswerItem[]
}

/** 一道题的答案。 */
export interface QuestionAnswerItem {
  id: string
  selected: string[]
  custom?: string
}

/** 待处理事项。 */
export type PendingInteraction =
  | {
    kind: 'approval'
    id: string
    toolName: string
    callId?: string
    reason?: string
    /** 把决定送回去。重复调用无害。 */
    settle: (outcome: ApprovalOutcome) => void
  }
  | {
    kind: 'question'
    id: string
    questions: readonly QuestionItem[]
    /** 把答案送回去。 */
    settle: (answers: readonly QuestionAnswerItem[]) => void
  }

let seq = 0

/**
 * 一个极小的可观察队列（跟官方那套 getSnapshot/subscribe 用法一致）。
 * 界面直接订阅它；一次只显示队首那个。
 */
export class InteractionQueue {
  private items: PendingInteraction[] = []
  private readonly listeners = new Set<() => void>()

  getSnapshot(): readonly PendingInteraction[] {
    return this.items
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener()
  }

  private push(item: PendingInteraction): void {
    this.items = [...this.items, item]
    this.notify()
  }

  private remove(id: string): void {
    const next = this.items.filter(i => i.id !== id)
    if (next.length === this.items.length) return
    this.items = next
    this.notify()
  }

  /**
   * 登记一个工具审批，返回一个 Promise —— 它 resolve 之前，
   * 服务端的回答链会一直等着，所以 agent 会停在这里等用户决定。
   */
  askApproval(request: { toolName?: string; callId?: string; reason?: string; signal?: AbortSignal }): Promise<ApprovalOutcome> {
    return new Promise<ApprovalOutcome>(resolve => {
      let done = false
      const settle = (outcome: ApprovalOutcome): void => {
        if (done) return
        done = true
        this.remove(id)
        resolve(outcome)
      }
      const id = `approval-${++seq}`
      // 上游取消（比如用户中断了回合）时，别让面板永远挂着
      request.signal?.addEventListener('abort', () => settle('cancelled'), { once: true })
      this.push({
        kind: 'approval',
        id,
        toolName: String(request.toolName ?? '未知工具'),
        ...(request.callId === undefined ? {} : { callId: String(request.callId) }),
        ...(request.reason === undefined ? {} : { reason: String(request.reason) }),
        settle,
      })
    })
  }

  /** 登记一次提问（含计划评审），同样会挂住 agent 直到用户答完。 */
  askQuestions(request: { questions?: readonly QuestionItem[]; signal?: AbortSignal }): Promise<QuestionAnswerEnvelope> {
    const questions = request.questions ?? []

    // 没有问题就问不出东西来 —— 直接回空信封，**不要入队**。
    //
    // 曾经的做法是照常入队，于是界面上什么面板都没有，但键盘已经被这次交互
    // 接管了：用户看到的是一个「能打字但打不进字」的输入框，而交互的 Promise
    // 永远不 settle，agent 就一直干等。这种死局很难归因，所以在源头掐掉。
    if (questions.length === 0) return Promise.resolve({ answers: [] })

    return new Promise<QuestionAnswerEnvelope>(resolve => {
      let done = false
      const settle = (answers: readonly QuestionAnswerItem[]): void => {
        if (done) return
        done = true
        this.remove(id)
        // 必须包一层：工具端读的是 result.answers
        resolve({ answers })
      }
      const id = `question-${++seq}`
      request.signal?.addEventListener('abort', () => settle([]), { once: true })
      this.push({
        kind: 'question',
        id,
        questions,
        settle,
      })
    })
  }
}

/** 判断一道题是不是计划评审。 */
export function isPlanReview(item: QuestionItem): boolean {
  return item.intent?.kind === 'plan-review'
}

/**
 * 计划评审里，哪个选项标签代表「批准」；不是计划评审就给 undefined。
 *
 * 这是**唯一**判断这件事的地方 —— 面板画「← 批准」标记、
 * 以及默认光标停在哪一项，都调它。之前这两处各读了一次 intent.approve，
 * 改协议字段时得同时改三处，漏一处不会报错、只会行为悄悄不一致。
 */
export function approveLabelOf(item: QuestionItem | undefined): string | undefined {
  return item?.intent?.kind === 'plan-review' ? item.intent.approve : undefined
}
