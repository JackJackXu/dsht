// 状态行的数字：合成、格式化、按宽度降级
//
// 为什么值得单测：
//   · 这些数字是**用户唯一能看到的用量/花费**，算错了他也没法发现
//   · 用户对成本敏感，所以规矩是「取不到就整段省掉，绝不编」
//   · 降级顺序决定了窄终端上先牺牲谁，是设计的一部分
import {
  readStatusNumbers, shortNumber, statusCandidates,
  type CostUsageProjection, type ContextPressureProjection,
  type SessionStatsProjection, type TokenUsageProjection,
} from '../src/ui/status.ts'

let pass = 0, fail = 0
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name) }
  else { fail++; console.log('  ✗', name, detail !== undefined ? `\n      ${detail}` : '') }
}
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; console.log('  ✓', name) }
  else { fail++; console.log('  ✗', name, `\n      得到 ${g}\n      期望 ${w}`) }
}

// 真实数据：从用户那个会话的投影里 dump 出来的
const REAL_STATS: SessionStatsProjection = {
  turns: 173, steps: 2260, llmMs: 12897045, toolMs: 16998239,
  ttftMs: 4193952, ttftSteps: 2256, decodeMs: 8688296, decodeTokens: 1805945,
}
const REAL_TOKENS: TokenUsageProjection = {
  uncachedInputTokens: 3855503, outputTokens: 1805945,
  cacheReadTokens: 825595136, cacheWriteTokens: 0,
}
const REAL_COST: CostUsageProjection = { cost: 6.343968513888899 }

console.log('=== 解码速度：decodeTokens / decodeMs ===')
{
  const n = readStatusNumbers({ stats: REAL_STATS })
  // 1805945 / (8688296/1000) = 207.86…
  ok('算出来约 208 tok/s', n.tokPerSec !== undefined && Math.abs(n.tokPerSec - 207.86) < 0.5,
     `实际 ${n.tokPerSec}`)
  eq('用 Math.round 显示就是 208', Math.round(n.tokPerSec!), 208)

  // decodeMs 为 0 时不能除（新会话就是 0）
  const fresh = readStatusNumbers({ stats: { turns: 0, steps: 0, decodeMs: 0, decodeTokens: 0 } })
  eq('decodeMs=0 时不给速度（不是 Infinity，也不是 0）', fresh.tokPerSec, undefined)

  eq('没有统计投影时也不给速度', readStatusNumbers({}).tokPerSec, undefined)
}

console.log('=== 缓存命中率：只看**输入** token ===')
{
  const n = readStatusNumbers({ tokens: REAL_TOKENS })
  // 825595136 / (825595136 + 3855503) = 0.99535…
  ok('算出来约 99.54%', n.cacheHitRate !== undefined && Math.abs(n.cacheHitRate - 0.99535) < 0.0001,
     `实际 ${n.cacheHitRate}`)

  // 输出 token 不该进分母：outputTokens 1805945 如果算进去会把命中率拉低到 99.3% 左右，
  // 跟 dsh 自己的 Web UI 对不上
  const wrong = 825595136 / (825595136 + 3855503 + 1805945)
  ok('分母里没有输出 token（否则会跟 dsh 自己显示的对不上）',
     n.cacheHitRate !== undefined && Math.abs(n.cacheHitRate - wrong) > 0.0005,
     `我们 ${n.cacheHitRate} / 错误算法 ${wrong}`)

  // 只给一个数算不出来 —— 不能拿它当 0
  eq('只有 cacheRead 时不给命中率', readStatusNumbers({ tokens: { cacheReadTokens: 100 } }).cacheHitRate, undefined)
  eq('全零时不给命中率（不能显示 0%）',
     readStatusNumbers({ tokens: { cacheReadTokens: 0, uncachedInputTokens: 0 } }).cacheHitRate, undefined)
}

console.log('=== 上下文占用 ===')
{
  eq('新会话的 contextPressure 是空对象 → 不给占用率',
     readStatusNumbers({ pressure: {} }).contextRatio, undefined)
  const p: ContextPressureProjection = { projectedTokens: 651215, contextWindow: 1000000 }
  const n = readStatusNumbers({ pressure: p })
  ok('算出来约 65%', n.contextRatio !== undefined && Math.abs(n.contextRatio - 0.651215) < 0.0001)
  eq('窗口为 0 时不给占用率',
     readStatusNumbers({ pressure: { projectedTokens: 10, contextWindow: 0 } }).contextRatio, undefined)
}

console.log('=== 缺哪个就省哪个，绝不编 ===')
{
  const n = readStatusNumbers({ stats: { turns: 5 } })
  eq('turns 有就给', n.turns, 5)
  eq('steps 没有就是 undefined', n.steps, undefined)
  eq('速度没有就是 undefined', n.tokPerSec, undefined)
  eq('花费没有就是 undefined', n.cost, undefined)
  eq('完全空输入 → 一个字段都没有', Object.keys(readStatusNumbers({})), [])
}

console.log('=== 大数缩写（跟 dsh 自己的 Web UI 一致）===')
{
  eq('825595136 → 825M（截断，跟 dsh 的 Web UI 一致）', shortNumber(825595136), '825M')
  eq('999999 → 999K（不是 1000K）', shortNumber(999999), '999.9K')
  eq('1200 → 1.2K', shortNumber(1200), '1.2K')
  eq('999 → 999', shortNumber(999), '999')
  eq('3.4e9 → 3G（截断）', shortNumber(3.4e9), '3G')
  eq('不是有限数 → 破折号', shortNumber(Number.NaN), '—')
}

console.log('=== 降级：从长到短，第一段（轮次）永远留着 ===')
{
  const n = readStatusNumbers({ stats: REAL_STATS, tokens: REAL_TOKENS, cost: REAL_COST })
  const c = statusCandidates(n)
  ok('至少有一条', c.length > 0)
  ok('最长的那条以「轮」开头', c[0]!.startsWith('173 轮'), c[0])
  ok('包含步数', c[0]!.includes('2260 步'), c[0])
  ok('包含速度', c[0]!.includes('208 tok/s'), c[0])
  ok('包含缓存命中', c[0]!.includes('缓存 99.5%'), c[0])
  ok('包含花费', c[0]!.includes('花费 6.34'), c[0])
  eq('最短的那条只剩轮次', c[c.length - 1], '173 轮')
  ok('每一条都比上一条短', c.every((s, i) => i === 0 || s.length < c[i - 1]!.length))

  // 完全没有数字时不该硬造一条空的
  eq('一个数字都没有 → 空列表（调用方会整段省掉）', statusCandidates({}), [])

  // 新会话不该冒出「0 tok」这种噪音
  const fresh = statusCandidates({ turns: 0, steps: 0, cacheReadTokens: 0 })
  eq('0 tok 不显示', fresh[fresh.length - 1], '0 轮')
  ok('整条里没有「0 tok」', !fresh[0]!.includes('0 tok'), fresh[0])
}

console.log('')
console.log(`通过 ${pass} / ${pass + fail}`)
if (fail > 0) process.exitCode = 1
