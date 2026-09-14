// `connect.mjs` 的类型声明（`dsh-web.mjs` 的在 src/dsh-web.d.mts）
//
// 为什么手写而不是从官方包里 import：
//   官方包**没有导出**客户端那一侧的公开类型（它们只在浏览器 bundle 里自注册，
//   见 src/client-loader.mjs 的说明）。`ctx` 上的 sessions / remote / connection
//   全部是 Cordis 插件在运行时注入的，TS 从 .mjs 里推断不出来。
//
// 所以这里只声明**我们真正用到的那一小块**，并标注每一条的出处。
// 这是边界，不是复制 —— 官方改了内部格式，这里要跟着改，跑不起来时看
// docs/RESEARCH.md 第十节（那里的探针脚本是重新验证的办法）。
//
// 声明文件命名成 `.d.mts` 是为了跟 `.mjs` 配对（TS 会优先找同名声明）。

/** 官方一元调用的统一信封。 */
export interface RemoteResult<T> {
  readonly ok: boolean
  readonly value?: T
  readonly error?: { readonly message?: string }
}

type SlashCommand = import('./ui/commands.ts').SlashCommand

/** 会话列表快照。`@deepseek-ai/dsh-api-session-controller` 的 store 形状。 */
export interface SessionsListSnapshot {
  readonly ids: readonly string[]
  readonly byId: Readonly<Record<string, { id: string; displayTitle?: string } | undefined>>
}

/**
 * 会话快照里我们真正读的字段。
 *
 * 出处：`@deepseek-ai/dsh-api-session-controller` 的
 * `lib/types/client/contract/snapshot.d.ts`。
 */
export interface SessionSnapshot {
  openState?: string
  /** 打不开时才有；`openState === 'error'` 时读它拿原因。 */
  openError?: { message?: string }
  promptError?: { message?: string }
  lastAgentError?: { message?: string }
  running?: boolean
  /**
   * 历史窗口前面是否还有更早的记录。
   *
   * 官方 `open()` 只拉**最近 50 条**（`events.open({ maxMessages: 50 })`），
   * 所以打开老会话时看到的只是尾巴；更早的要靠 `loadOlder()` 一次前拉 50 条。
   */
  hasMore?: boolean
  /** 正在前拉。用来给用户一个「在加载」的反馈，免得以为按了没反应。 */
  loadingOlder?: boolean
}

/** 一个会话（状态机）。 */
export interface ISession {
  getSnapshot(): SessionSnapshot
  subscribe(listener: () => void): () => void
  /**
   * 往前拉一页更早的历史。
   *
   * 官方实现里，它在「没打开 / 没有更多 / 正在载入」时会直接返回，
   * 所以重复调用是安全的，调用方不需要自己判。
   * 失败会把信息落进快照，不抛异常。
   */
  loadOlder?(): Promise<void>
  prompt(text: string, options?: { requestId?: string; signal?: AbortSignal }): Promise<unknown>
  command(line: string): Promise<unknown>
}

/** 一个会话的绑定：session 是状态机，eventSource 是历史事件流。 */
export interface SessionBinding {
  session: ISession
  eventSource: { getSnapshot(): { entries?: unknown[] }; subscribe(listener: () => void): () => void }
  readonly session: ISession
  readonly eventSource: {
    getSnapshot(): { entries?: unknown[] }
    subscribe(listener: () => void): () => void
  }
}

/** 会话服务（dsh-api-session-controller 注入）。 */
export interface SessionsService {
  refresh(): Promise<void>
  list: { getSnapshot(): SessionsListSnapshot }
  create(options: { cwd: string }): Promise<string>
  open(id: string): void
  binding(id: string): SessionBinding | undefined
}

/** Cordis 上下文，以及我们依赖的几个插件注入的服务。 */
export interface DshContext {
  readonly sessions: SessionsService
  /**
   * 一元远程调用，按**命名空间**分组。
   *
   * ⚠️ 调用形式是 `ctx.remote.session.rename({...})`，
   * **不是**扁平的 `ctx.remote['session/rename']` —— 后者不存在。
   * 而且写成 `ctx.remote?.['session/rename']?.(...)` 会把「方法不存在」
   * 吞成 undefined，失败全程无声。这个坑踩过一次，别再用可选链调它。
   */
  readonly remote: {
    /** 一元的「瀑布」钩子：审批、提问都从这里来。 */
    $on(event: string, handler: (payload: any) => any): void
    readonly commands: {
      /** 列出这个会话可用的斜杠命令（形状见 dsh-commands 的 CommandDescriptor）。 */
      list(agentId: string): Promise<RemoteResult<readonly SlashCommand[]>>
    }
    readonly session: {
      rename(request: { sessionId: string; title: string }): Promise<RemoteResult<{ title: string }>>
    }
  }
  readonly connection?: {
    generation?: { getSnapshot?(): { id: number } | undefined }
  }
  readonly fiber: { dispose(): Promise<void> }
}

export interface ConnectResult {
  ctx: DshContext
  base: string
  cookie: string
  dispose(): Promise<void>
}

/** 用启动 token 换一个会话 cookie。 */
export function exchangeTokenForCookie(base: string, token: string): Promise<string>

/** 建立到 dsh web 的连接，返回一个已就绪的 Cordis 上下文。 */
export function connect(options: { base: string; token: string }): Promise<ConnectResult>

/** 等连接代次建立（它是异步的），超时返回 undefined。 */
export function waitForGeneration(
  ctx: DshContext,
  timeoutMs?: number,
): Promise<{ id: number } | undefined>
