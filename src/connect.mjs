// 连接 dsh web 的官方 API
//
// 这是整个项目的地基：把「一个 Node 进程」变成「dsh 的一个合法客户端」。
//
// 完整流程（每一步都实测验证过）：
//   1. token 换 cookie
//   2. 给 Node 补 location（官方用它拼 ws:// 地址）
//   3. 包装 WebSocket（官方 new WebSocket(url) 不带 cookie，我们补上）
//   4. 装 __DSH_TRANSPORT__.fetch（一元调用走这里）
//   5. 装客户端模块加载器
//   6. 按序挂官方客户端插件
//
// 官方没有承诺这些内部格式稳定。跑不起来时，先看 docs/RESEARCH.md 第十节。

import { installModuleLoaderShim, importClientBundle, getClientModule } from './client-loader.mjs'

/**
 * 需要加载进来的官方客户端 bundle —— 加载 = 执行它们的自注册
 * （每个 bundle 会把自己注册进 `window.__ModuleLoader__`，见 client-loader.mjs）。
 *
 * **顺序无关**：这里只是「让这些包有机会注册」。
 * 真正的挂载顺序由下面的 PLUGINS 决定。
 *
 * 注意 dsh-client-store 只在这里出现、不在 PLUGINS 里 ——
 * 它是个普通 npm 包（没有 ./client 子路径），作用是给别的 bundle 提供 zustand 等依赖，
 * 本身不是一个要挂载的插件。
 */
const BUNDLES = [
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-typert-registry',
  '@deepseek-ai/dsh-api-gateway',
  '@deepseek-ai/dsh-api-remotes',
  '@deepseek-ai/dsh-client-file-upload',
  '@deepseek-ai/dsh-api-session-controller',
]

/**
 * 插件的挂载顺序 —— **这里是唯一决定顺序的地方**，前者是后者的依赖。
 * 改顺序改这里，不要改上面的 BUNDLES（那个顺序不影响任何东西）。
 */
const PLUGINS = [
  '@deepseek-ai/dsh-typert-registry',
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-api-gateway',
  '@deepseek-ai/dsh-api-remotes',
  '@deepseek-ai/dsh-client-file-upload',
  '@deepseek-ai/dsh-api-session-controller',
]

/**
 * 用启动 token 换一个会话 cookie。
 * @param {string} base 服务器根地址，如 http://127.0.0.1:7799
 * @param {string} token 启动时打印的 token
 * @returns {Promise<string>} `name=value` 形式的 cookie 串
 */
export async function exchangeTokenForCookie(base, token) {
  const res = await fetch(`${base}/?token=${encodeURIComponent(token)}`, { redirect: 'manual' })
  const cookie = (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ')
  if (cookie === '') {
    throw new Error(`token 换 cookie 失败：HTTP ${res.status}（token 可能已失效，重启 dsh web 会换新的）`)
  }
  return cookie
}

/**
 * 建立到 dsh web 的连接，返回一个已就绪的 Cordis 上下文。
 * @param {{ base: string, token: string }} options
 *   base 是服务器根地址，token 是启动 token。
 * @returns {Promise<import('./connect.d.mts').ConnectResult>}
 */
export async function connect({ base, token }) {
  const cookie = await exchangeTokenForCookie(base, token)

  // ── ① location：官方用 location.origin 拼 ws:// 地址 ──────────
  // 用一个真正的 URL 实例，字段齐全（origin/href/protocol/host/...）
  Object.defineProperty(globalThis, 'location', {
    value: new URL(base + '/'),
    configurable: true,
    writable: true,
  })

  // ── ② WebSocket：官方的 mux 客户端是 `new WebSocket(url)` 一个参数，
  //        而 Node 内置 WebSocket 支持把 { headers } 作为第二个参数。
  //        所以套一层子类，把 cookie 补进去。
  const NativeWebSocket = globalThis.WebSocket
  class CookieWebSocket extends NativeWebSocket {
    constructor(url, protocols) {
      super(url, protocols ?? { headers: { cookie } })
    }
  }
  globalThis.WebSocket = CookieWebSocket

  // ── ③ 传输层：一元调用。官方会拿形如 http://dsh.internal/xxx 的 URL
  //        来找我们（没 location 时的兜底基址），我们重挂到真实服务器。
  globalThis.__DSH_TRANSPORT__ = {
    fetch: async (input, init) => {
      const src = new URL(String(input))
      const target = new URL(src.pathname + src.search, base)
      const headers = new Headers(init?.headers)
      headers.set('cookie', cookie)
      headers.set('origin', base)
      return fetch(target, { ...init, headers })
    },
  }

  // ── ④ 客户端模块加载器 ─────────────────────────────────────────
  installModuleLoaderShim()

  // ── ⑤ 加载 bundle（执行它们的注册） ────────────────────────────
  for (const id of BUNDLES) {
    try {
      await importClientBundle(id)
    } catch (error) {
      // 有些包没有 ./client 子路径（是普通 npm 包），属于预期
      if (!/is not defined by "exports"/.test(error.message)) throw error
    }
  }

  // ── ⑥ 建 Cordis 应用并挂插件 ──────────────────────────────────
  const { Context } = await import('@deepseek-ai/cordis')
  const ctx = new Context()
  for (const id of PLUGINS) {
    await ctx.plugin(getClientModule(id))
  }

  // Cordis 的 Context 要等插件挂载之后才有 sessions / remote（那是服务注入），
  // 静态类型里当然没有这两个属性 —— 但它们在运行时确实存在。
  // 所以在这个**唯一**的返回点上显式声明一次：官方若改了注入方式，只需改这里。
  const runtimeCtx = /** @type {import('./connect.d.mts').DshContext} */ (
    /** @type {unknown} */ (ctx)
  )

  return {
    ctx: runtimeCtx,
    base,
    cookie,
    async dispose() {
      await ctx.fiber.dispose()
    },
  }
}

/**
 * 等连接代次建立（它是异步的），超时返回 undefined。
 * @param {import('./connect.d.mts').DshContext} ctx
 * @param {number} [timeoutMs]
 * @returns {Promise<{ id: number } | undefined>}
 */
export async function waitForGeneration(ctx, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const gen = ctx.connection?.generation?.getSnapshot?.()
    if (gen !== undefined) return gen
    if (Date.now() > deadline) return undefined
    await new Promise(r => setTimeout(r, 200))
  }
}
