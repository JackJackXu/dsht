# 调研笔记：dsh 的前后端接口

> 日期：2026-09-13
> 目的：确认"给 dsh 做一个自己的终端界面"在架构上是否成立，以及正确做法是什么。
> 结论：**成立。官方本来就留着这个位置。**

本文记录的是**事实和证据**，不是计划。计划见 [PLAN.md](PLAN.md)。

---

## 一、核心结论

**dsh 的前后端是分开的，而且官方 API 是公开、正式、已发布的。**

官方 web UI 只是这套 API 的**一个客户端**。我们再写一个客户端（终端界面）在架构上完全成立。

```
┌──────────────────────────────┐
│ dsh web（Host 进程）          │
│  ├─ agent / 工具 / 会话       │
│  └─ API Gateway              │
│       HTTP POST + WebSocket  │
└───────────┬──────────────────┘
            │  官方 API
   ┌────────┴────────┐
   │                 │
官方 web UI      我们的终端界面
（浏览器里画）     （终端里画）
```

---

## 二、官方 API：Typert API Gateway

依据：`docs/api-gateway.zh.md`、`packages/api/`

| 项目 | 内容 |
|---|---|
| 名称 | Typert API Gateway |
| 声明方式 | 业务服务给方法打 `@Remote` / `@RemoteScope` 标记，**构建时自动生成** Host 与 Client 两端契约 |
| 客户端调用 | `ctx.remote.<namespace>.<方法>()`，生成的是**具名类型函数**，不是手写协议 |
| 一元调用 | HTTP POST |
| 流 | WebSocket `/api/remote.mux` |
| 认证 | 启动 token → 签名 cookie（host-only / Path=/ / HttpOnly / SameSite=Strict） |
| 安全 | `Host` 必须是 loopback 或 `trustedHosts` 命中；`Origin` 必须与 Host 相等 |

### 已发布的 API 包（npm，与 dsh 同一条版本线）

```
@deepseek-ai/dsh-api-gateway             0.1.5-alpha.1
@deepseek-ai/dsh-api-remotes             0.1.5-alpha.1
@deepseek-ai/dsh-api-session-controller  0.1.5-alpha.1
@deepseek-ai/dsh-api-settings-controller 0.1.5-alpha.1
```

另有 `packages/api/` 下的 `workspace-controller`、`workspace-files`。

---

## 三、会话控制器提供了什么

依据：`packages/api/session-controller/README.zh.md`

> 拥有 Host 的 `ctx.sessionController` 服务，以及生成的 Client `session`、`skills`、`fileReferences` Remote namespace。
> 提供 **Session 生命周期与历史、Host generation 模型目录、工作区路径打开、用户可调用 skill 发现、面向 Agent 的文件引用**。

### 全部 `@Remote` 方法

| 方法 | 用途 |
|---|---|
| `list` | 列出会话 |
| `search` | 搜索会话 |
| `create` | 新建会话 |
| `selectModel` | 选择模型 |
| `modelCatalog` | 模型目录 |
| `openWorkspacePath` | 打开工作区路径 |
| `rename` | 重命名会话 |
| `fork` | 分叉会话 |
| `prompt` | 发送提示 |
| `attachment` | 附件 |
| `updateQueue` | 更新队列 |
| `cancel` | 取消当前回合 |
| `page` | 分页取历史 |
| `follow`（stream） | 跟随会话日志：开屏快照 + 无间隙的持久事件帧 |
| `control`（stream） | 完整实时控制基线 + 替换帧（queues / jobs / projections） |

`control` 的基线内容是：`queues`（待处理消息队列）、`jobs`（后台任务）、`projections`（会话状态投影）。

---

## 四、审批与提问怎么走（关键发现）

**不在 Remote 方法里**，而是走 **Remote Event 瀑布（waterfall）**。

依据：`packages/client/ui-approval/src/client/index.ts`

```ts
ctx.remote.$on('approval/request', function (request, next) {
  return answerApproval(ctx, this, request, next, registerPendingInteraction)
})
```

**要点：**

- 审批和提问是**服务端推给客户端的事件**，客户端注册监听器
- **监听器的返回值就是答复**（要答就返回决定，不答就调 `next()` 交给下一个）
- 所以官方 API 里当然搜不到 "approve" 方法——答复是**函数返回值**，不是请求
- 事件是**有作用域（scoped）**的：agent 作用域的监听器只收到那个 agent 的事件

**这意味着终端界面也能完整应答审批和提问**，网页 UI 能干的事它都能干。

---

## 五、换载体的官方钩子

依据：`packages/client/connection/src/client/index.ts`

```ts
/**
 * Carrier override installed on the page global before plugin boot.
 * The served web app leaves it unset and gets HTTP + WebSocket;
 * a shell that owns a different physical transport provides both halves
 * here instead of forking this plugin.
 */
export interface ClientTransportHooks {
  fetch: RpcFetch
  openStream?: RpcStreamOpen
  loadBundle?(url: string): Promise<void>
  ownsHost?: boolean
}
```

钩子位置：`globalThis.__DSH_TRANSPORT__`

官方原话：**"a shell that owns a different physical transport provides both halves here instead of forking this plugin"**——明确允许换实体传输层，且**不需要 fork 这个插件**。

另外 `isLoopback` 的注释里写着 `... or the context is not a browser`——**非浏览器环境官方已经考虑过了**。

### 两个官方先例（都换了载体）

**1. Electron 桌面版** —— `apps/desktop-host/src/index.ts:99`

```js
const DESKTOP_TRANSPORT_SCRIPT = `globalThis.__DSH_TRANSPORT__={
  ownsHost:true,
  async *openStream(endpoint,payload,signal){
    const response=await fetch('/.dsh/remote-stream',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({endpoint,payload}),signal
    })
    // ...把响应切成一行行 JSON 吐出来
  }
}`
```

**2. Web Worker 预览运行时** —— `packages/experimental/webworker-runtime/src/client/index.ts:152`

```ts
;(globalThis as ClientTransportGlobal).__DSH_TRANSPORT__ = {
  fetch: (input, init) => tunnel.fetch(input, init),
  openStream: (endpoint, payload, signal) => tunnel.open(endpoint, payload, signal),
  loadBundle: (url: string) => tunnel.loadBundle(url),
  ownsHost: true,
}
```

**我们要做的是第三个载体：终端载体。**

---

## 六、Node 里能不能跑（浏览器依赖排查）

依据：`packages/client/connection/src/client/`（去掉测试约 770 行）

| 依赖 | Node 24 情况 |
|---|---|
| `globalThis.fetch` | ✅ 内置 |
| `globalThis.crypto.getRandomValues` | ✅ 内置 |
| `location.origin` | ✅ 有 `INTERNAL_BASE = 'http://dsh.internal'` 兜底，没有 `location` 也能跑 |
| `new WebSocket()` | ✅ Node 22+ 内置 |
| `window.addEventListener('online'/'offline')` | ✅ 检测不到就 no-op（`watchBrowserNetwork` 里 `browser === undefined` 直接返回空函数） |

**结论：浏览器 API 依赖几乎为零，Node 24 全部具备。**

---

## 七、被排除的路线（附理由）

| 路线 | 排除理由 |
|---|---|
| **ACP 协议**（`dsh --profile acp`） | 官方文档明说"**刻意不提供 DSH 专用呈现与交互式 UI 功能**"，且**不含 elicitation（审批/提问）**。agent 一卡就废 |
| **SDK 协议**（`dsh --profile sdk`） | 协议全文只有 3 个请求（`initialize` / `session/prompt` / `shutdown`）+ 4 个通知（`session.event` / `session.status` / `subagent.started` / `subagent.finished`）。**没有任何"回答审批"的方法**，只能启动时定死策略 |
| **进程内挂官方包**（自己写 app bundle） | 能拿到全部能力，但要啃官方内部接口，且 dsh 是 0.x、内部 API 会变。留作阶段 1 的**备用方案** |
| **Fork 第三方 dsh-tui** | 用户明确不愿基于该作者的项目；且 UI 需求完全不同，fork 后要大改 |
| **改官方 web 客户端源码** | dsh 一升级就得重做 |

### 顺带记录的参考数据（用于估算工作量）

| 东西 | 行数 |
|---|---|
| 官方 headless（跑一句话就退出）的实现 | ~285 行（去掉测试） |
| 官方 SDK 客户端 | 1170 行 |
| SDK 协议定义全文 | 425 行 |
| 官方 `client/connection` 的 client 半边 | ~770 行（去掉测试） |

---

## 八、对 AGENTS.md 的支持（顺带确认）

依据：`packages/context/agent-instructions/src/`

- 认的文件名：`AGENTS.md` / `CLAUDE.md`
- 本地覆盖版：`AGENTS.local.md` / `CLAUDE.local.md`
- 从会话工作目录**往上走**找项目根，再**往下扫子目录**（层级加载）
- 另有一份用户全局 `~/.dsh/AGENTS.md`

**所以每个文件夹都可以有各自的 AGENTS.md，越靠近被编辑的文件越优先。**

---

## 九、npm 名字占用情况（2026-09-13 查）

| 名字 | 状态 |
|---|---|
| `dsh-term` | ❌ 被 dsh-TUI 作者抢注（占位包，README 明写 "Reserved package name"） |
| `dsh-terminal` | ❌ 被 `giiiiiithub` 占用（是"往 web UI 嵌 PTY 终端"的插件，另一个东西） |
| `dsh-console` | ❌ 被 `isanti` 占用（斜杠命令式的 web/隧道管理） |
| `dsht` | ✅ **未占用** ← 本项目采用 |

---

## 十、探针实测结果（2026-09-13 深夜）

**结论：全部跑通。** 在 Node 里用官方客户端库连上了 `dsh web`，成功列出 **240 个真实会话**（含标题、token 用量、上下文压力等投影数据）。

> **关于这一节引用的探针脚本（2026-09-14 清理）**
>
> 当初为了摸清协议，`probe/` 下写了一批一次性脚本。它们的**结论已经全部落进本文档**，
> 但脚本本身已经删掉了 —— 理由是它们已经过期（API 约定改过几轮），留着会让人
> 照着跑却发现对不上，反而误导。
>
> 被删掉的脚本，以及它们当初各自验证了什么，记在这里备查：
>
> | 脚本 | 当初验证的事 |
> |---|---|
> | `_probe-loader.mjs` | 浏览器 bundle 能不能在 Node 里自注册（`__ModuleLoader__` 那套） |
> | `_probe-connect.mjs` | 五步连接流程能不能走通（token→cookie、location、WebSocket、transport） |
> | `_probe-ws.mjs` | WebSocket `/api/remote.mux` 多路复用的握手与帧格式 |
> | `_probe-sessions.mjs` | `sessions.refresh()` / `create()` / `list` 的形状 |
> | `_probe-read.mjs` | 读一个会话的历史事件窗口（`events.open` 只拉最近 50 条） |
> | `_probe-chat.mjs` | **分水岭**：发一条消息、拿流式回复 |
> | `_probe-command.mjs` | `session.command()` 派发斜杠命令、`matched` 语义 |
> | `_probe-diag.mjs` | 连诊断：看一眼当前连接代次、服务是否就绪 |
> | `_read-recent.mjs` / `_scan-user.mjs` / `_user-msgs.mjs` | 从本地存储里翻最近的会话/消息（只读排查用） |
>
> **要重新验证怎么办**：不用去翻旧脚本，用现在这套 ——
> `npm run commands`（列命令，复用会话不新建）、
> `probe/_probe-commands-try.mjs`（真跑一遍看每个命令返回什么）、
> `npm run selftest`（端到端：起服务→连接→渲染→退出）。
> 需要新的检查时再写一个，写完挂到 `package.json` 的 scripts 里 ——
> **没挂 scripts 的探针 = 没人会跑 = 迟早过期**，这正是当初那批脚本的下场。

### 10.0 附带记下：dsh 的会话文件长什么样（只作知识，代码不碰它）

摸协议的过程中顺带把 `~/.dsh/sessions/` 下的文件格式搞清楚了。
**本项目不读写它们**（红线之一），但下面这些坑值得记下来 ——
以后真要写排查工具时会再撞上：

- 文件名有**两种**：`session.jsonl.zstd`（旧格式，version 0，占多数）
  和 `session.v3.jsonl.zstd`（新格式，version 3）。只认后者会漏掉一大半会话。
- 内容是**逐帧追加的 zstd**（一个事件一帧）。实测那个 9.5MB 的会话里有 **3558 个帧头**。
- **Node 的公开 API 只能解第一帧**：`zlib.zstdDecompressSync(buf)` 和
  `zlib.createZstdDecompress()` 都只给第一帧（一行头信息）。
  dsh 自己是靠一个 `zstd-private-decoder`（帧索引 + Node 私有流句柄）解决的。
- 所以想「用文件大小判断会话有没有内容」是可行的（实测两极分化：
  空会话 ~320-410 字节、真实对话 18KB 以上），但想读内容就得自己实现多帧解码。
- dsh **没有删除会话的接口**（`dsh-session-persistence-jsonl` 的文档原话：
  「不删除会话文件……seam 无删除接口」），设计上交给外部清理。

### 10.1 安装

`npm` 可用。API 包有 **`0.1.5-rc.2`**，与已安装的 dsh 版本完全一致。

```sh
npm install --save-exact --legacy-peer-deps \
  @deepseek-ai/cordis \
  @deepseek-ai/dsh-client-connection@0.1.5-rc.2 \
  @deepseek-ai/dsh-typert-registry@0.1.5-rc.2 \
  @deepseek-ai/dsh-api-gateway@0.1.5-rc.2 \
  @deepseek-ai/dsh-api-remotes@0.1.5-rc.2 \
  @deepseek-ai/dsh-api-session-controller@0.1.5-rc.2
# 上游漏声明的运行时依赖，得手动补：
npm install --save-exact zustand immer react@^19
```

**上游打包缺陷**：`@deepseek-ai/dsh-client-store` 的 `package.json` 里**没有声明任何 dependencies**，但代码里 `import` 了 `zustand` 和 `immer`。`zustand` 又需要 `react`。这是它的漏打包，我们只能手动补。

### 10.2 客户端模块格式（关键发现）

官方的 `lib/client.js` **不是普通 npm 模块**，而是「客户端模块 bundle」：

```js
window.__ModuleLoader__.load({
  id: "@deepseek-ai/dsh-client-connection",
  factory: (require) => { ...; return module.exports }
})
```

- `factory` 返回的导出是一个 **Cordis 插件**（带 `apply` / `inject`）
- `require()` 的目标可能是另一个客户端模块（如 `@deepseek-ai/dsh-api-gateway/client`），也可能是真正的 npm 包（如 `@deepseek-ai/cordis`）

**Node 里用一个约 40 行的加载器就能模拟**（实现见 [`src/client-loader.mjs`](../src/client-loader.mjs)）。三个要点：

1. 先补一个最小的 `globalThis.window` 和 `window.__ModuleLoader__`
2. id 解析要处理**注册名与 require 名不一致**：gateway 注册为 `@deepseek-ai/dsh-api-gateway`，但别人 require 的是 `.../client` → 需要去掉 `/client` 后缀再试
3. 解析不到就回退给真正的 `node:module` require

### 10.3 插件挂载顺序

顺序由各自的 `inject` 决定，但实测必须**都挂上**才能拿到 `ctx.remote`：

| 插件 | inject | 提供 |
|---|---|---|
| `dsh-typert-registry` | `[]` | `ctx.typert` |
| `dsh-client-connection` | `[]` | `ctx.connection` |
| `dsh-api-gateway` | `["typert","connection"]` | **`ctx.remote`**（`ClientRemoteService` → `super(ctx,'remote')`） |
| `dsh-api-remotes` | `["remote"]` | 装配包：`ctx.remote.$mount(...)` 挂各命名空间 |
| `dsh-api-session-controller` | `["connection","fileUpload","typert","remote","remote.commands","remote.session","remote.subagents"]` | `ctx.sessions` |

**易错点**：`dsh-api-remotes` 自己 **不提供** `remote`，它只是装配包。根服务是 **gateway** 提供的。少挂 typert 或 gateway，`ctx.remote` 就是 `undefined`（而且 Cordis 的挂载是懒的，不满足依赖时**不报错**，静默 pending）。

### 10.4 认证流程（实测）

```
GET /?token=<token>
  → 303 See Other
  → set-cookie: dsh-auth-<hash>=v1.<payload>.<sig>
     HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000 (30 天)
GET /  带 cookie  → 200 OK
```

`<hash>` 绑定 authority（`127.0.0.1:<port>`），**换端口要重新走一遍**。

### 10.5 传输层：一元调用只靠 `fetch`

`__DSH_TRANSPORT__.fetch` 拿到的是形如 `http://dsh.internal/<channel>/<endpoint>` 的 URL（`location` 不存在时的兜底基址），我们要做的是：

1. 把 path 重挂到真实服务器
2. 带上 cookie（和 `origin`）

实测：**只实现 `fetch` 就能调用一元 Remote 方法**，成功拿到 `remote.session.list()` 的结果。

### 10.6 实测成功的调用

```js
ctx.remote.session.list({})
// → { ok: true, value: { items: [ { sessionId, updatedAt, running, blank, cwd, projections } ] } }
```

`projections.values` 里带着：`title`、`goal`、`tokenUsage`、`contextPressure`、`contextBreakdown`、`sessionStats`、`turnOutline` —— **界面要显示的数据基本都在这里**。

### 10.7 流通道（WebSocket）—— 已打通

**结论：不用自己实现 `openStream`。** 让官方的 mux 客户端自己跑就行，只需给它三个条件。

官方 gateway 的代码里有一句关键判断：

```ts
if (connection.rpc.open === undefined) this.streams.start()
```

也就是说：**我们只要不提供 `openStream`，gateway 就会用自带的 `RemoteStreamMuxClient` 去 `new WebSocket(...)`**。而这个客户端用的是标准 WHATWG WebSocket API，Node 24 有内置实现。

于是只补三件事：

| # | 补什么 | 为什么 |
|---|---|---|
| 1 | `globalThis.location = new URL(base + '/')` | 官方用 `location.origin` 拼 `ws://` 地址；没有 `location` 就退回假地址 `http://dsh.internal` |
| 2 | 给 `globalThis.WebSocket` 套一层子类，自动带 cookie | 官方是 `new WebSocket(url)`（一个参数）；Node 内置 WebSocket **支持把 `{ headers }` 作为第二个参数**（undici 扩展） |
| 3 | （`fetch` 传输层照旧） | 一元调用用 |

```js
const NativeWebSocket = globalThis.WebSocket
class CookieWebSocket extends NativeWebSocket {
  constructor(url, protocols) {
    super(url, protocols ?? { headers: { cookie } })
  }
}
globalThis.WebSocket = CookieWebSocket
```

**实测结果**：`connection lost, retry #N` **归零**，连接代次建立：

```
connection generation: {"id":1,"host":{"home":"<用户主目录>"}}
```

### 10.8 会话事件流实测

```js
const stream = await ctx.remote.session.follow(
  { address: { kind: 'session', sessionId }, maxMessages: 5 },
  signal,   // 可选的最后一个参数，用于取消
)
for await (const frame of stream) { ... }
```

实测收到：

```
snapshot  历史记录 25 条，投影 有，hasMore=true
```

`follow` 的帧类型有三种：

| 类型 | 内容 |
|---|---|
| `snapshot` | 开屏快照：`header` / `cursor` / `records` / `hasMore` / `projections` |
| `event` | 一条持久会话事件（`SessionEventEntry`） |
| `assistant-stream` | 助手输出的增量帧（要传 `assistantStream: true`） |

**注意**：这是**长期流**，会话空闲时它会一直挂着等新事件。要优雅退出得传 `AbortSignal`。

### 10.9 还差的部分（下一步）

| 缺什么 | 影响 | 怎么补 |
|---|---|---|
| `fileUpload`、`commands`、`subagents` 命名空间 | `ctx.sessions` 还是 `undefined`（它的 inject 需要这几个） | 装对应的客户端包并挂上 |

`ctx.remote.session.*` 的 16 个方法**已经全部可用**，所以这一条不是拦路虎。

### 10.10 认证与传输的完整清单（给实现用）

一个能工作的最小客户端需要：

1. 起 `dsh web --no-open --port <p>`，正则 `dsh web: (\S+)` 抓 URL
2. `GET /?token=<t>`（`redirect: 'manual'`）→ 从 `set-cookie` 取 cookie
3. `globalThis.location = new URL(base + '/')`
4. 包装 `globalThis.WebSocket`（注入 cookie header）
5. `globalThis.__DSH_TRANSPORT__ = { fetch }`（把请求重挂到真实服务器 + 带 cookie）
6. 补 `window.__ModuleLoader__` 加载器
7. 按序挂插件：`typert → connection → gateway → remotes → session-controller`


### 10.8 环境记录

- Node v24.19.0，npm 11.17.0
- `dsh` 0.1.5-rc.2，路径 `%APPDATA%\npm\dsh.cmd`
- 测试端口用 7799（避让常用端口）
- `dsh web --no-open --port <p>` 会在 stdout 打印 `dsh web: http://127.0.0.1:<p>/?token=...`（前面可能混有别的插件的日志，用正则抓）

---

## 十一、另一轮实测补充（另一个 dsh 会话报告）

### 11.1 提问接口的返回形状（踩过的坑）

`ask_user_question` 工具在 `dsh-tool-ask-user/lib/index.js:107` 会执行：

```js
(await answerer(request)).answers.map(...)
```

**所以回答器必须返回 `{ answers: [...] }`，不能返回裸数组。**

返回裸数组时的报错是：

```
Error: Cannot read properties of undefined (reading 'map')
```

这个报错**看起来像 dsh 自己的 bug**，实际上是回答器的形状写错了。判断依据：
「只要是真问题就必失败，但空数组能过参数校验」—— 说明参数没问题，是回执形状的问题。

### 11.2 斜杠命令必须走 `session.command()`

`ISession.command(line)` 是官方给的命令派发入口：

```ts
command(line: string): Promise<RemoteResult<{ matched: boolean }>>
```

实测（脚本已删，见本节开头的清理说明；现在用 `probe/_probe-commands-try.mjs` 重跑）：

| 输入 | 返回 | 会话里产生的事件 |
|---|---|---|
| `/plan` | `{ matched: true }` | `command/run` → `plan/mode {active:true}` → `command/done` |
| `/plan off` | `{ matched: true }` | `plan/mode {active:false}` |
| `/不存在的命令` | `{ matched: false }` | （什么都不产生） |

**如果把 `/xxx` 当普通提示词发给模型**，就会看到模型困惑地回复
「`exit_plan_mode` is only available in plan mode」这类话 —— 因为命令根本没执行。

官方设计明确要求：**命令行绝不能静默降级成普通提示词**。所以 `matched: false`
时要明确告诉用户，而不是照发。

命令的输出在 `command/done` 事件的 `text` 字段里（`kind: 'success' | ...`）。

### 11.3 计划评审卡片的目标形态

实测时看到 dsh Web 客户端的计划评审卡片提供三个动作：

- `Chat about it`（继续讨论）
- `Refuse`（拒绝）
- `Approve`（批准）

它们**就是提问的 `options`**，由插件那边定义。我们只要按协议渲染即可，
另外用 `intent.approve` 把「批准」那个选项标出来。
