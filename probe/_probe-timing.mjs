// 量一下探针各阶段各花多久
//
// 用法：npm run timing
// 目的：搞清楚「跑一次探针要等很久」到底等在哪里。
//
// 结论（2026-09-14 实测，Windows + 300 个会话）：
//   dsh web 启动   ~8.6s   ← 绝大部分时间在这里，是 dsh 自身加载插件 + 建索引
//   连接           ~0.3s
//   会话列表刷新   ~0.3s
//   打开一个会话   ~0.9s
//   收尾           ~0.3s
//   合计           ~10.6s
//
// 所以「卡了好久」不是死循环，是**在等 dsh 起来**。想确认就重跑这个脚本。
import { startDshWeb } from '../src/dsh-web.mjs'
import { connect, waitForGeneration } from '../src/connect.mjs'
import { acquireProbeSession } from './_probe-session.mjs'

const t0 = Date.now()
const mark = (label) => {
  console.log(`  ${label.padEnd(34)} 累计 ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}

mark('开始')

const server = await startDshWeb({})
mark('dsh web 起来了')

try {
  const { ctx, dispose } = await connect({ base: server.base, token: server.token })
  try {
    mark('连上了（token→cookie + 装传输层）')
    await waitForGeneration(ctx)
    mark('连接代次建立')

    // 只复用探针自己的会话，不碰用户的（见 _probe-session.mjs 的说明）
    await acquireProbeSession(ctx)
    mark('会话就绪（复用探针会话）')

    const tList = Date.now()
    await ctx.remote['session/list']?.({})
    console.log(`  ${'列一遍会话'.padEnd(34)} 用了 ${((Date.now() - tList) / 1000).toFixed(1)}s`)

    const tDispose = Date.now()
    await dispose()
    console.log(`  ${'dispose（断开）'.padEnd(34)} 用了 ${((Date.now() - tDispose) / 1000).toFixed(1)}s`)

    const tStop = Date.now()
    await server.stop()
    console.log(`  ${'server.stop（收子进程）'.padEnd(34)} 用了 ${((Date.now() - tStop) / 1000).toFixed(1)}s`)
  } catch (e) {
    console.log('  出错：', e.message)
    await server.stop()
    process.exitCode = 1
  }
} finally {
  await server.stop()
}

console.log(`  ${'合计'.padEnd(34)} ${((Date.now() - t0) / 1000).toFixed(1)}s`)
