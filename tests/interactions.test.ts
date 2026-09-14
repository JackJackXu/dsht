// 交互队列的单测
//
// 重点是**协议形状**，不是业务逻辑 —— 之前就栽在这上面：
// 官方协议要求 user-questions 返回 { answers: [...] }，我返回了裸数组，
// 工具端执行 .answers.map(...) 直接炸，报错看起来还像是 dsh 自己的 bug。
// 所以这里把「返回什么形状」钉死。
import { InteractionQueue, type PendingInteraction } from '../src/interactions.ts'

let pass = 0, fail = 0
function ok(name: string, cond: boolean, extra?: string) {
  if (cond) { pass++; console.log('  ✓', name) }
  else { fail++; console.log('  ✗', name, extra ?? '') }
}

/**
 * 取出队首并断言它是审批。
 *
 * 不用 `as any` —— 那样写测试能通过、但形状错了也照样通过，
 * 等于把「被测对象是不是我想的那个」这件事交给了读者去脑补。
 * 这里宁可抛错：形状不对，测试立刻红，而且告诉你实际拿到了什么。
 */
function approvalAt(q: InteractionQueue, index = 0): Extract<PendingInteraction, { kind: 'approval' }> {
  const item = q.getSnapshot()[index]
  if (item === undefined || item.kind !== 'approval') {
    throw new Error(`期望第 ${index} 项是审批，实际是 ${item === undefined ? '（空）' : item.kind}`)
  }
  return item
}
function questionAt(q: InteractionQueue, index = 0): Extract<PendingInteraction, { kind: 'question' }> {
  const item = q.getSnapshot()[index]
  if (item === undefined || item.kind !== 'question') {
    throw new Error(`期望第 ${index} 项是提问，实际是 ${item === undefined ? '（空）' : item.kind}`)
  }
  return item
}

console.log('=== 审批：返回的是「结果字符串」===')
{
  const q = new InteractionQueue()
  const promise = q.askApproval({ toolName: 'write', callId: 'c1', reason: '要写文件' })
  ok('先入队', q.getSnapshot().length === 1)
  const item = approvalAt(q)
  ok('带上了工具名', item.toolName === 'write')
  ok('带上了原因', item.reason === '要写文件')
  item.settle('allowed-once')
  const got = await promise
  ok('resolve 出来的是字符串', typeof got === 'string', `实际 ${typeof got}`)
  ok('值正确', got === 'allowed-once')
  ok('出队了', q.getSnapshot().length === 0)
}

console.log('=== 审批：工具名缺失时有兜底 ===')
{
  const q = new InteractionQueue()
  const p = q.askApproval({})
  ok('不是 undefined', approvalAt(q).toolName === '未知工具')
  approvalAt(q).settle('rejected')
  await p
}

console.log('=== 提问：必须返回 { answers: [...] } 信封 ===')
{
  const q = new InteractionQueue()
  const promise = q.askQuestions({
    questions: [{ id: 'q1', question: '选哪个？', options: [{ label: 'A' }] }],
  })
  const item = questionAt(q)
  ok('题目带过来了', item.questions.length === 1)
  ok('题目内容正确', item.questions[0]?.id === 'q1')
  item.settle([{ id: 'q1', selected: ['A'] }])
  const got: unknown = await promise

  ok('不是裸数组', !Array.isArray(got), `实际是 ${Array.isArray(got) ? '数组' : typeof got}`)
  const env = got as { answers?: unknown }
  ok('有 answers 字段', got !== null && typeof got === 'object' && 'answers' in (got as object),
     `实际键：${got !== null && typeof got === 'object' ? Object.keys(got as object).join(',') : '(无)'}`)
  ok('answers 是数组', Array.isArray(env.answers))
  ok('answers 内容正确', JSON.stringify(env.answers) === JSON.stringify([{ id: 'q1', selected: ['A'] }]))
}

console.log('=== 队列行为：先进先出 ===')
{
  const q = new InteractionQueue()
  const a = q.askApproval({ toolName: 'one' })
  const b = q.askApproval({ toolName: 'two' })
  ok('两个都入队', q.getSnapshot().length === 2)
  ok('队首是第一个', approvalAt(q).toolName === 'one')
  ok('队尾是第二个', approvalAt(q, 1).toolName === 'two')
  approvalAt(q).settle('rejected')
  await a
  ok('第一个出队后第二个顶上', q.getSnapshot().length === 1 && approvalAt(q).toolName === 'two')
  approvalAt(q).settle('rejected')
  await b
  ok('全清空', q.getSnapshot().length === 0)
}

console.log('=== 两种交互混排也按顺序 ===')
{
  const q = new InteractionQueue()
  const a = q.askApproval({ toolName: 'x' })
  const b = q.askQuestions({ questions: [{ id: 'q1', question: '？' }] })
  ok('审批在前', q.getSnapshot()[0]?.kind === 'approval')
  ok('提问在后', q.getSnapshot()[1]?.kind === 'question')
  approvalAt(q).settle('rejected')
  await a
  ok('审批出队后提问顶上', questionAt(q).questions[0]?.id === 'q1')
  questionAt(q).settle([])
  await b
  ok('全清空', q.getSnapshot().length === 0)
}

console.log('=== 重复 settle 无害（以第一次为准）===')
{
  const q = new InteractionQueue()
  const p = q.askApproval({ toolName: 'x' })
  const item = approvalAt(q)
  item.settle('rejected')
  item.settle('allowed-once')   // 第二次应被忽略
  ok('以第一次为准', (await p) === 'rejected')
  ok('不会重复出队报错', q.getSnapshot().length === 0)
}

console.log('=== 订阅通知 ===')
{
  const q = new InteractionQueue()
  let n = 0
  const off = q.subscribe(() => { n++ })
  const p = q.askApproval({ toolName: 'x' })
  ok('入队通知了一次', n === 1)
  approvalAt(q).settle('rejected')
  await p
  ok('出队又通知一次', n === 2)
  off()
  const p2 = q.askApproval({ toolName: 'y' })
  ok('取消订阅后不再通知', n === 2)
  approvalAt(q).settle('rejected')
  await p2
}

console.log('=== 快照只在变更时换新数组（React 外部 store 的契约）===')
{
  const q = new InteractionQueue()
  const before = q.getSnapshot()
  ok('空队列时两次快照是同一个引用', q.getSnapshot() === before)
  const p = q.askApproval({ toolName: 'x' })
  ok('入队后换了新引用', q.getSnapshot() !== before)
  const settled = q.getSnapshot()
  approvalAt(q).settle('rejected')
  void p
  ok('出队后又换了新引用', q.getSnapshot() !== settled)
}

console.log('=== AbortSignal：上游取消时面板不会永远挂着 ===')
{
  const q = new InteractionQueue()
  const ac = new AbortController()
  const p = q.askApproval({ toolName: 'x', signal: ac.signal })
  ok('先入队', q.getSnapshot().length === 1)
  ac.abort()
  ok('取消后审批结果被填成 cancelled', (await p) === 'cancelled')
  ok('取消后也出队了（不会卡住界面）', q.getSnapshot().length === 0)
}
{
  const q = new InteractionQueue()
  const ac = new AbortController()
  const p = q.askQuestions({ questions: [{ id: 'q1', question: '？' }], signal: ac.signal })
  ok('先入队', q.getSnapshot().length === 1)
  ac.abort()
  const got = await p
  ok('取消后提问返回空信封', Array.isArray(got.answers) && got.answers.length === 0)
  ok('取消后也出队了', q.getSnapshot().length === 0)
}

console.log('=== 空问题列表：直接回空信封，不入队（否则界面会死局）===')
{
  const q = new InteractionQueue()
  const got = await q.askQuestions({ questions: [] })
  ok('返回空信封', Array.isArray(got.answers) && got.answers.length === 0)
  // 关键：不入队。入队的话面板画不出来、键盘却被它吃掉，
  // 用户会看到一个「能打字但打不进字」的输入框，而 agent 永远等下去。
  ok('没有入队', q.getSnapshot().length === 0)
}
{
  const q = new InteractionQueue()
  const got = await q.askQuestions({})   // 连 questions 字段都没有
  ok('questions 缺失时同样返回空信封', Array.isArray(got.answers) && got.answers.length === 0)
  ok('同样没有入队', q.getSnapshot().length === 0)
}

console.log('=== 已经取消之后再 settle 也不会出错 ===')
{
  const q = new InteractionQueue()
  const ac = new AbortController()
  const p = q.askApproval({ toolName: 'x', signal: ac.signal })
  const item = approvalAt(q)
  ac.abort()
  item.settle('allowed-once')   // 已经错过了，应被忽略
  ok('结果仍是 cancelled', (await p) === 'cancelled')
  ok('队列干净', q.getSnapshot().length === 0)
}

console.log(`\n通过 ${pass} / ${pass + fail}`)
process.exit(fail === 0 ? 0 : 1)
