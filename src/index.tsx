// dsht 入口
//
// 流程：起 dsh web → 连官方 API → 建会话 → 渲染界面
//
// 用法：
//   npx tsx src/index.tsx              新建会话
//   npx tsx src/index.tsx --resume <id>  打开已有会话

import React from 'react'
import { render } from 'ink'
import { startDshWeb } from './dsh-web.mjs'
import { connect, waitForGeneration } from './connect.mjs'
import { App } from './ui/App.tsx'
import { InteractionQueue } from './interactions.ts'
import type { SlashCommand } from './ui/commands.ts'

const args = process.argv.slice(2)
const arg = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const resumeId = arg('--resume')
/** 自检模式：不接管键盘，渲染若干秒后退出（用于在管道/非 TTY 下看画面） */
const selftest = args.includes('--selftest')
const selftestSeconds = Number(arg('--seconds') ?? 6)
/** 自检时自动发一条消息，用来验证「能聊天」整条链路 */
const initialMessage = arg('--message')
/** 自检时初始展开思考 */
const showReasoning = args.includes('--reasoning')
/** 在状态栏显示最近一次按键的原始信息（排查终端按键上报问题） */
const keyDebug = args.includes('--keydebug')
/** 自检时自动应答审批/提问（值：approve | reject） */
const autoAnswer = arg('--auto-answer') as 'approve' | 'reject' | undefined

let server: Awaited<ReturnType<typeof startDshWeb>> | undefined
let dispose: (() => Promise<void>) | undefined

/**
 * 收尾：断开连接 + 收掉 dsh web 及其整个子进程树。
 *
 * ⚠️ 这里**共享同一个 Promise**，而不是用「布尔量挡重入 + 直接 return」。
 * 旧写法是 `if (stopped) return; stopped = true; ...`，问题在于第二次调用会
 * **立刻返回**（而不是等第一次做完）。而 SIGINT 处理器紧接着就 `process.exit()`，
 * 于是 `server.stop()`（Windows 上是 `taskkill /T`）还没跑完，dsh web 连同它
 * 用 shell 拉起的 cmd.exe 和一堆子进程就全成了孤儿，继续占着端口和 CPU。
 * 连按两次 Ctrl+C 就能复现 —— 而连按 Ctrl+C 恰恰是最常见的退出方式。
 *
 * 现在所有调用方（正常退出、信号、App 里的 onExit）都 await 同一个 Promise，
 * 谁先来谁发起，后来的一起等。
 */
let stopping: Promise<void> | undefined
function cleanup(): Promise<void> {
  stopping ??= (async () => {
    try { await dispose?.() } catch { /* 连接可能已经断了，无所谓 */ }
    await server?.stop()
  })()
  return stopping
}

/**
 * 收到终止信号：先收干净再退出，但**不能无限等** ——
 * 万一 stop() 卡住，用户按了 Ctrl+C 却退不出去是更糟的体验。
 */
function onSignal(code: number, label: string): void {
  void (async () => {
    const timeout = new Promise<void>(resolve => { setTimeout(resolve, 8000) })
    const finished = await Promise.race([cleanup().then(() => true), timeout.then(() => false)])
    if (!finished) process.stderr.write(`\ndsht: ${label} 后收尾超时（8 秒），强制退出\n`)
    process.exit(code)
  })()
}

process.on('SIGINT', () => onSignal(130, 'Ctrl+C'))
process.on('SIGTERM', () => onSignal(143, 'SIGTERM'))
// 关掉终端窗口时 POSIX 会发 SIGHUP；不处理的话子进程同样会残留
process.on('SIGHUP', () => onSignal(129, 'SIGHUP'))

try {
  // 1. 起服务
  process.stderr.write('dsht: 正在启动 dsh web…（首次可能要十几秒）\n')
  const started = await startDshWeb({})
  server = started
  if (started.token === null) {
    // 宁可在这里明确报错，也别用 `server.token!` 蒙混过去 ——
    // 真到 connect 里炸，报出来的是个跟原因无关的错误。
    throw new Error(`dsh web 打印的 URL 里没有 token：${started.url}\n（dsh 版本可能不兼容，见 docs/RESEARCH.md）`)
  }
  process.stderr.write(`dsht: dsh web 已就绪 ${started.base}\n`)

  // 2. 连官方 API
  process.stderr.write('dsht: 正在连接官方 API…\n')
  const conn = await connect({ base: started.base, token: started.token })
  dispose = conn.dispose
  const ctx = conn.ctx
  const gen = await waitForGeneration(ctx)
  if (gen === undefined) throw new Error('连接代次没建立（6 秒超时）')

  // 3. 拿会话
  process.stderr.write('dsht: 正在载入会话…\n')
  await ctx.sessions.refresh()
  const list = ctx.sessions.list.getSnapshot()
  const rows = list.ids.map((id: string) => list.byId[id]).filter(Boolean) as { id: string; displayTitle?: string }[]

  let sessionId: string
  if (resumeId !== undefined) {
    if (!rows.some(r => r.id === resumeId)) throw new Error(`找不到会话 ${resumeId}`)
    sessionId = resumeId
  } else {
    // 默认新建。想接着上次聊可以 --resume <id>
    sessionId = await ctx.sessions.create({ cwd: process.cwd() })
  }

  ctx.sessions.open(sessionId)
  const binding = ctx.sessions.binding(sessionId)
  if (binding === undefined) throw new Error('拿不到 session binding')

  // 4. 接住两条「waterfall」：工具审批、提问（含计划评审）
  //
  // 处理器的返回值就是答复 —— 所以返回一个「等用户点完才 resolve」的 Promise，
  // agent 就会停在这里等，直到用户在面板上做出决定。
  const interactions = new InteractionQueue()
  ctx.remote.$on('approval/request', (request: any) => interactions.askApproval(request))
  ctx.remote.$on('user-questions/request', (request: any) => interactions.askQuestions(request))

  // 等会话加载完（openState 从 loading 变 open）
  //
  // ⚠️ 这里必须**检查失败**，不能只看「不再 loading」。
  // 旧写法是 `if (openState !== 'loading') break` —— 出错时 openState 会变成
  // 'error'，循环同样会退出，然后界面照常渲染成「(还没有对话，说点什么吧)」。
  // 用户看到的是一个空会话，而不是「加载失败」，真正的原因（会话被删、
  // 服务端出错、传输断了）完全丢失，后面发消息时的报错也已经跟它无关了。
  let openState = binding.session.getSnapshot().openState
  for (let i = 0; i < 60 && openState === 'loading'; i++) {
    await new Promise(r => setTimeout(r, 200))
    openState = binding.session.getSnapshot().openState
  }
  const openError = binding.session.getSnapshot().openError?.message
  if (openState === 'error') {
    throw new Error(`会话打不开${openError === undefined ? '' : `：${openError}`}`)
  }
  if (openState === 'loading') {
    // 超时不致命：会话也许还能用，让用户自己判断，总比直接退出好
    process.stderr.write('dsht: 会话载入超时（12 秒），先按空会话继续\n')
  }

  // 4.5 取一次斜杠命令清单（给命令面板用）
  //
  // 问服务端要，不硬编码 —— 装了哪些插件、什么版本，清单就跟着变。
  // 拿不到也不致命：命令面板会显示「没有匹配的命令」，手打命令照样能用。
  let commands: readonly SlashCommand[] = []
  try {
    const res = await ctx.remote.commands.list(sessionId)
    if (res.ok && res.value !== undefined) commands = res.value
    else process.stderr.write('dsht: 拿不到命令清单，命令面板会是空的（手打命令不受影响）\n')
  } catch (error) {
    process.stderr.write(`dsht: 取命令清单出错：${error instanceof Error ? error.message : String(error)}\n`)
  }

  // 5. 渲染
  const title = rows.find(r => r.id === sessionId)?.displayTitle
  const app = render(
    React.createElement(App, {
      session: binding.session,
      binding,
      interactions,
      title: title ?? (resumeId === undefined ? '新会话' : undefined),
      interactive: !selftest,
      initialMessage,
      initialShowReasoning: showReasoning,
      keyDebug,
      autoAnswer,
      commands,
      onExit: () => { void cleanup() },
    }),
  )
  if (selftest) {
    setTimeout(() => app.unmount(), selftestSeconds * 1000)
  }
  await app.waitUntilExit()

  // 退出后清屏，别把界面残留在终端里
  process.stdout.write('\u001b[2J\u001b[3J\u001b[H')
} catch (error) {
  process.stderr.write(`\ndsht 启动失败：${error instanceof Error ? error.message : String(error)}\n`)
  if (error instanceof Error && error.stack) {
    process.stderr.write(error.stack.split('\n').slice(1, 4).join('\n') + '\n')
  }
  process.exitCode = 1
} finally {
  await cleanup()
}
