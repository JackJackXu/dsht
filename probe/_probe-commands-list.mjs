// 列出当前 dsh 支持的所有斜杠命令
//
// 用法：npm run commands
// 会自己起一个临时 dsh web，连上，问 commands/list，然后收干净。
//
// 为什么要问服务端而不是在源码里找：命令是插件注册的，装了什么插件、
// 版本是什么，都会影响清单。问运行中的实例才是**事实**。
//
// 会话：复用「探针专用」会话（见 _probe-session.mjs），不碰你自己的会话，
// 也不在你的列表里积垃圾。
import { startDshWeb } from '../src/dsh-web.mjs'
import { connect, waitForGeneration } from '../src/connect.mjs'
import { acquireProbeSession } from './_probe-session.mjs'

const server = await startDshWeb({})
try {
  const { ctx, dispose } = await connect({ base: server.base, token: server.token })
  try {
    await waitForGeneration(ctx)
    const { id, reused } = await acquireProbeSession(ctx)

    const res = await ctx.remote.commands.list(id)
    if (!res?.ok) {
      console.error('取命令清单失败：', JSON.stringify(res))
      process.exitCode = 1
    } else {
      const cmds = [...res.value].sort((a, b) => a.name.localeCompare(b.name))
      console.log('')
      console.log(`━━━ dsh 支持的斜杠命令（共 ${cmds.length} 个）━━━`)
      console.log('')
      for (const c of cmds) {
        const syntax = c.input ? `/${c.name} ${c.input.hint}` : `/${c.name}`
        console.log(`  ${syntax}`)
        console.log(`      ${c.description}`)
        if (c.input?.attachments === true) console.log('      （可以带附件）')
        console.log('')
      }
      console.log('  ⚠️ 说明来自 dsh 本身（英文），不是我编的。')
      console.log(`  （查的是${reused ? '复用的' : '新建的'}探针会话 ${id.slice(0, 20)}…）`)
      console.log('')
    }
  } finally {
    await dispose()
  }
} finally {
  // 放在 finally 里：脚本崩了也要把 dsh web 收干净，不然会留下孤儿进程
  await server.stop()
}
