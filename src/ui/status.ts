// 状态行的内容：从会话投影里取出数字，格式化成一行文字
//
// 数据来源全是 dsh 自己算好的**会话投影**（`session.projections.faceOf(key)`），
// 我们不自己统计、更不估算 —— 估出来的数字会让本来就对花费敏感的用户更焦虑。
//
// 各投影的形状来自官方包的类型声明：
//   sessionStats    —— dsh-session-projection 的会话统计
//   tokenUsage      —— token 用量
//   costUsage       —— 花费
//   contextPressure —— 上下文压力
//
// 为什么要单独放一个文件：这几个数字要按终端宽度**降级显示**（先省掉最不重要的），
// 而"怎么降级"和"怎么算"都是纯逻辑，值得单测。

/** 会话统计（`sessionStats` 投影）。 */
export interface SessionStatsProjection {
  readonly turns?: number
  readonly steps?: number
  readonly llmMs?: number
  readonly toolMs?: number
  readonly ttftMs?: number
  readonly ttftSteps?: number
  readonly decodeMs?: number
  readonly decodeTokens?: number
}

/** token 用量（`tokenUsage` 投影）。 */
export interface TokenUsageProjection {
  readonly uncachedInputTokens?: number
  readonly outputTokens?: number
  readonly cacheReadTokens?: number
  readonly cacheWriteTokens?: number
}

/** 花费（`costUsage` 投影）。 */
export interface CostUsageProjection {
  readonly input?: number
  readonly output?: number
  readonly cacheRead?: number
  readonly cacheWrite?: number
  readonly reasoning?: number
  /** 计价单位由 dsh 决定，我们原样显示，不做换算 */
  readonly cost?: number
}

/** 上下文压力（`contextPressure` 投影）。 */
export interface ContextPressureProjection {
  readonly pressureTokens?: number
  readonly projectedTokens?: number
  readonly contextWindow?: number
}

/** 一行里要显示的全部数字。全是可选 —— 投影可能还没填、也可能这个部署没装。 */
export interface StatusNumbers {
  turns?: number
  steps?: number
  /** 解码速度（token/秒），由 decodeTokens / decodeMs 算出来 */
  tokPerSec?: number
  /** 缓存读取的 token 数（跟 dsh 自己的 Web UI 一致，它显示的就是这个） */
  cacheReadTokens?: number
  /** 缓存命中率（0-1） */
  cacheHitRate?: number
  /** 累计花费（计价单位由 dsh 决定，我们原样显示） */
  cost?: number
  /** 上下文占了多少（0-1） */
  contextRatio?: number
}

/** 把几个投影合成一组数字。缺的键就是 `undefined`，绝不编。 */
export function readStatusNumbers(input: {
  stats?: SessionStatsProjection | undefined
  tokens?: TokenUsageProjection | undefined
  cost?: CostUsageProjection | undefined
  pressure?: ContextPressureProjection | undefined
}): StatusNumbers {
  const { stats, tokens, cost, pressure } = input

  const decodeMs = stats?.decodeMs
  const decodeTokens = stats?.decodeTokens
  // 速度要两个数都有效才算得出来；decodeMs 为 0 时不能除
  const tokPerSec =
    decodeMs !== undefined && decodeMs > 0 && decodeTokens !== undefined
      ? decodeTokens / (decodeMs / 1000)
      : undefined

  const cacheRead = tokens?.cacheReadTokens
  const uncached = tokens?.uncachedInputTokens
  // 命中率 = 缓存读 / (缓存读 + 未缓存输入)。
  // 分母只算**输入** —— 输出 token 不参与缓存，算进去会把命中率拉低，跟 dsh 自己的数对不上。
  const inputTotal = (cacheRead ?? 0) + (uncached ?? 0)
  const cacheHitRate =
    cacheRead !== undefined && uncached !== undefined && inputTotal > 0
      ? cacheRead / inputTotal
      : undefined

  const window = pressure?.contextWindow
  const used = pressure?.projectedTokens ?? pressure?.pressureTokens
  const contextRatio =
    window !== undefined && window > 0 && used !== undefined ? used / window : undefined

  return {
    ...(stats?.turns === undefined ? {} : { turns: stats.turns }),
    ...(stats?.steps === undefined ? {} : { steps: stats.steps }),
    ...(tokPerSec === undefined ? {} : { tokPerSec }),
    ...(cacheRead === undefined ? {} : { cacheReadTokens: cacheRead }),
    ...(cacheHitRate === undefined ? {} : { cacheHitRate }),
    ...(cost?.cost === undefined ? {} : { cost: cost.cost }),
    ...(contextRatio === undefined ? {} : { contextRatio }),
  }
}

/**
 * 大数缩写：1234 → `1.2K`，825595136 → `825M`。
 *
 * M/G 用**截断**而不是四舍五入 —— 跟 dsh 自己的 Web UI 一致
 *（825595136 它显示 825M；四舍五入会变成 826M，两个界面就对不上了）。
 */
export function shortNumber(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1e9) return `${Math.floor(n / 1e9)}G`
  if (abs >= 1e6) return `${Math.floor(n / 1e6)}M`
  // K 档先截断到 0.1 再格式化 —— 否则 999999 会显示成「1000.0K」这种丑东西
  if (abs >= 1e3) return `${(Math.floor(n / 100) / 10).toFixed(1)}K`
  return String(Math.round(n))
}

/**
 * 把数字拼成候选文案，**从长到短**。
 *
 * 调用方（`pickHint`）会挑第一条放得下的 —— 这跟按键提示是同一套降级机制。
 * 为什么要有降级：状态行的位置就那么宽，而数字有的重要有的次要。
 * 越靠前的越重要（轮次 > 速度 > 总量 > 命中率 > 花费 > 上下文）。
 */
export function statusCandidates(n: StatusNumbers): string[] {
  const parts: Array<string | undefined> = [
    n.turns === undefined ? undefined : `${n.turns} 轮`,
    n.steps === undefined ? undefined : `${n.steps} 步`,
    n.tokPerSec === undefined ? undefined : `${Math.round(n.tokPerSec)} tok/s`,
    // 0 就不显示 —— 新会话会冒出「0 tok」这种噪音，那不是信息
    n.cacheReadTokens === undefined || n.cacheReadTokens <= 0
      ? undefined
      : `${shortNumber(n.cacheReadTokens)} tok`,
    n.cacheHitRate === undefined ? undefined : `缓存 ${(n.cacheHitRate * 100).toFixed(1)}%`,
    n.cost === undefined || n.cost <= 0 ? undefined : `花费 ${n.cost.toFixed(2)}`,
    n.contextRatio === undefined ? undefined : `上下文 ${Math.round(n.contextRatio * 100)}%`,
  ]

  const all = parts.filter((p): p is string => p !== undefined)
  if (all.length === 0) return []

  // 从「全都要」逐级往下减，最后兜到只剩第一段
  const out: string[] = []
  for (let drop = 0; drop < all.length; drop++) {
    out.push(all.slice(0, all.length - drop).join(' · '))
  }
  return out
}
