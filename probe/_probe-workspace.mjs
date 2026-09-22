// 探针：Esc 面板要的两样东西读不读得到 —— 会话列表、工作区列表
//
// 用法：node probe/_probe-workspace.mjs
//
// 为什么值得单独探一次：
//   src/connect.mjs 只挂了 7 个官方客户端包，**没有**
//   dsh-api-workspace-controller —— 也就是说 ctx.workspaces 现在压根不存在。
//   Esc 面板最重要的两条（选对话、选工作区）全都靠它，所以先验证：
//     ① 会话列表快照里到底有哪些字段（面板要显示标题 / 时间 / 工作区）
//     ② 把 workspace-controller 挂上之后，ctx.workspaces 能不能用

import { startDshWeb } from '../src/dsh-web.mjs'
import { connect, waitForGeneration } from '../src/connect.mjs'
import { importClientBundle, getClientModule } from '../src/client-loader.mjs'

const WS_PKG = '@deepseek-ai/dsh-api-workspace-controller'

/** 打印一个快照，隐掉体积大又无关的投影值 */
function show(label, value) {
  console.log('')
  console.log('--- ' + label + ' ---')
  console.log(JSON.stringify(value, (k, v) => (k === 'projectionValues' ? '<省略>' : v), 2))
}

const server = await startDshWeb({})
try {
  const { ctx, dispose } = await connect({ base: server.base, token: server.token })
  try {
    await waitForGeneration(ctx)
    await ctx.sessions.refresh()

    const list = ctx.sessions.list.getSnapshot()
    console.log('会话数：' + list.ids.length)
    console.log('list 顶层字段：' + Object.keys(list).join(', '))

    const sampleIds = list.ids.slice(0, 3)
    show('sessions.list 快照（取样 3 条）', {
      current: list.current,
      phase: list.phase,
      ids: sampleIds,
      byId: Object.fromEntries(sampleIds.map(id => [id, list.byId[id]])),
    })

    console.log('')
    console.log('--- 挂载前 ---')
    console.log('ctx.workspaces = ' + typeof ctx.workspaces)
    console.log('ctx.remote.workspace = ' + typeof ctx.remote?.workspace)

    console.log('')
    console.log('--- 尝试挂载 ' + WS_PKG + ' ---')
    await importClientBundle(WS_PKG)
    await ctx.plugin(getClientModule(WS_PKG))

    console.log('ctx.workspaces = ' + typeof ctx.workspaces)
    console.log('ctx.remote.workspace = ' + typeof ctx.remote?.workspace)

    if (ctx.workspaces !== undefined) {
      // 挂上之后是异步拉取的（state=loading / phase=pending），等它到位
      let ws = ctx.workspaces.list.getSnapshot()
      for (let i = 0; i < 100 && ws.phase !== 'ready'; i++) {
        await new Promise(r => setTimeout(r, 200))
        ws = ctx.workspaces.list.getSnapshot()
      }
      console.log('workspaces.list 顶层字段：' + Object.keys(ws).join(', '))
      console.log('state=' + ws.state + '  phase=' + ws.phase + '  错误=' + JSON.stringify(ws.error))
      console.log('工作区数：' + ws.items.length)
      console.log('归档会话数：' + ws.archivedSessionIds.length)
      for (const w of ws.items) {
        console.log('  · ' + w.title + '  ' + w.path + '  会话 ' + w.sessionIds.length + ' 个')
      }
      if (ws.items.length > 0) show('第一个工作区的完整形状', ws.items[0])
    }
  } finally {
    await dispose()
  }
} finally {
  await server.stop()
}
