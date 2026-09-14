// 逐个试跑斜杠命令，看它们实际返回什么
//
// 用法：npm run commands:try
//
// 这个脚本会真跑 `/plan`、`/goal` 这类**有副作用**的命令，
// 所以只能在「探针专用」会话上跑（见 _probe-session.mjs）——
// 它不会碰你自己的会话，最多占一个标题带 [探针] 的会话，你可以随时删。
import { startDshWeb } from '../src/dsh-web.mjs'
import { connect, waitForGeneration } from '../src/connect.mjs'
import { acquireProbeSession } from './_probe-session.mjs'

const NL = String.fromCharCode(10)

const server = await startDshWeb({})
try {
  const { ctx, dispose } = await connect({ base: server.base, token: server.token })
  try {
    await waitForGeneration(ctx)
    const { id, binding, reused } = await acquireProbeSession(ctx)
    const session = binding.session

    // 每次跑都把上次留下的状态收干净，免得结果受上一次影响
    await session.command('/plan off')
    await session.command('/goal clear')
    await new Promise(r => setTimeout(r, 400))

    const lines = [
      '/permission',
      '/plan',
      '/goal',
      '/plan off',
      '/compact',
      '/feedback 这是探针写的测试反馈',
      '/permission 乱写的预设',
      '/export',
    ]

    for (const line of lines) {
      const before = binding.eventSource.getSnapshot().entries.length
      try {
        await session.command(line)
      } catch (e) {
        console.log(`  ${line.padEnd(26)} 抛错：${e.message}`)
        continue
      }
      await new Promise(r => setTimeout(r, 600))

      // 输出走 command/done 事件，不在返回值里
      const fresh = binding.eventSource.getSnapshot().entries.slice(before)
      const done = fresh.find(e => e.type === 'event' && e.event?.type === 'command/done')
      const text = done?.event?.data?.text
      const kind = done?.event?.data?.kind
      if (text === undefined) {
        console.log(`  ${line.padEnd(26)} （没有 command/done 事件，产生 ${fresh.length} 条其它事件）`)
        continue
      }
      const all = String(text).split(NL)
      console.log(`  ${line.padEnd(26)} [${String(kind)}] ${all[0]}`)
      for (const extra of all.slice(1, 6)) console.log(`      │ ${extra}`)
    }

    console.log('')
    console.log(`探针会话 ${id.slice(0, 20)}…（${reused ? '复用的' : '新建的'}）`)
  } finally {
    await dispose()
  }
} finally {
  // 放在 finally 里：脚本崩了也要把 dsh web 收干净，不然会留下孤儿进程
  await server.stop()
}
