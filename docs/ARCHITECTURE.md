# 架构

> 本文讲**技术怎么搭**。为什么要做、做什么，见 [PLAN.md](PLAN.md)；证据和调研过程见 [RESEARCH.md](RESEARCH.md)。

---

## 一、整体形状

dsht 是一个**独立的 Node 程序**，运行在终端里，通过官方 API 连接到一个正在运行的 `dsh web`。

```
┌─────────────────────────────────┐
│  dsh web（独立进程）             │
│   agent / 工具 / 会话 / 审批      │
│   API Gateway                    │
└────────────┬────────────────────┘
             │  HTTP POST（一元调用）
             │  WebSocket /api/remote.mux（流）
             ▼
┌─────────────────────────────────┐
│  dsht（独立进程）                │
│                                  │
│  ① 传输层  __DSH_TRANSPORT__     │
│  ② 官方客户端库（数据）           │
│  ③ Ink 渲染（界面）               │
└─────────────────────────────────┘
             │
             ▼
        Windows Terminal
```

**两个进程互不干扰。** dsht 挂了，dsh web 照常跑；反之亦然。

---

## 二、三层各自负责什么

### 第 ① 层：传输层（我们写，很小）

官方预留的钩子：

```ts
globalThis.__DSH_TRANSPORT__ = {
  fetch:      (input, init) => ...,      // 一元调用怎么发
  openStream: (endpoint, payload, signal) => ...,  // 流怎么开
  loadBundle: url => ...,                // 可选：插件 bundle 怎么取
  ownsHost:   true,                      // 可选：声明"后端由我独占"
}
```

**为什么需要它**：官方的客户端库默认假设自己在浏览器里（用页面的 `fetch` 和 `WebSocket`，还有 `location.origin` 当基址）。我们给一个自己的实现，把请求指向 `http://127.0.0.1:<端口>` 并带上认证 cookie。

官方 Electron 桌面版和 web worker 预览运行时都这么干，我们照抄。

**参考实现（官方 Electron，`apps/desktop-host/src/index.ts:99`）**：

```js
globalThis.__DSH_TRANSPORT__ = {
  ownsHost: true,
  async *openStream(endpoint, payload, signal) {
    const response = await fetch('/.dsh/remote-stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint, payload }),
      signal,
    })
    // ...按行切成 JSON 吐出来
  }
}
```

### 第 ② 层：官方客户端库（我们一行不写）

```
@deepseek-ai/dsh-api-gateway
@deepseek-ai/dsh-api-remotes
@deepseek-ai/dsh-api-session-controller     ← 会话生命周期 / 历史 / 模型目录 / 技能 / 文件引用
@deepseek-ai/dsh-api-settings-controller
```

调用形式是生成的具名函数（不是手写协议）：

```ts
await ctx.remote.session.create(...)
await ctx.remote.session.prompt(...)
await ctx.remote.session.list(...)
```

**流**：`session.follow`（会话日志）和 `session.control`（队列 / 后台任务 / 状态投影）。

**审批与提问**走 Remote Event 瀑布，不是 Remote 方法：

```ts
ctx.remote.$on('approval/request', function (request, next) {
  // 返回决定 = 答复；调用 next() = 交给别人处理
})
```

详见 RESEARCH.md 第四节。

### 第 ③ 层：界面（我们写）

- **渲染**：Ink（把 React 组件渲染成终端字符画）
  - ⚠️ Ink 和官方客户端库的 React 必须**是同一个实例**，否则 hook 会报错。这点要小心。
- **主屏**：聊天记录（流式）+ 输入框
- **菜单**：Esc 触发，分类 → 子菜单 → 返回
- **按键**：自己处理（终端里键盘完全归我们管，没有 dsh-TUI 那种 ctrl/alt 限制）

---

## 三、怎么连上 dsh web

### 方式 A：自己起一个（推荐，第一版就做这个）

```
dsht 启动
  → 子进程：dsh web --no-open --port <空闲端口>
  → 从它的 stdout 抓到 "dsh web: http://127.0.0.1:<port>/?token=..."
  → 用 token 换 cookie
  → 连上
```

好处：**自包含**，不依赖外面有没有在跑 dsh。退出时把子进程一起收掉。

### 方式 B：连已有的（以后再说）

连你已经在跑的 `dsh web`（比如 dsh-wv2 起的那个）。需要一个入口把 URL + token 传进来。

好处：**一个后端，多个前端**——浏览器和终端看同一批会话（会话本来就存盘，两边都看得见）。

### 认证

官方流程：启动 token（URL 上的 `?token=...`）→ 换一个签名 cookie → 之后所有请求带这个 cookie。

**注意**：cookie 绑定 hostname + port，是 host-only、`Path=/`、`HttpOnly`、`SameSite=Strict`。

---

## 四、建议的模块划分

```
src/
├─ main.ts              入口：起 dsh web、建连接、启动界面
├─ transport/
│   ├─ index.ts         __DSH_TRANSPORT__ 的实现
│   ├─ fetch.ts         一元调用（HTTP POST）
│   ├─ stream.ts        流（WebSocket /api/remote.mux）
│   └─ auth.ts          token → cookie
├─ backend/
│   ├─ connect.ts       装载官方客户端库
│   └─ session.ts       会话相关的调用封装
├─ ui/
│   ├─ App.tsx          顶层：主屏 or 菜单
│   ├─ Transcript.tsx   聊天记录（流式渲染）
│   ├─ Prompt.tsx       输入框
│   ├─ Approval.tsx     审批面板
│   ├─ Question.tsx     提问面板
│   └─ menu/
│       ├─ Menu.tsx     菜单框架（分类 / 子菜单 / 返回）
│       ├─ Sessions.tsx
│       ├─ Models.tsx
│       ├─ Settings.tsx
│       └─ Exit.tsx
└─ state/
    └─ store.ts         会话状态（订阅官方的流，投影成界面要的形状）
```

**阶段 1 只需要 `main.ts` + `transport/` + `backend/connect.ts`。**

### 实际长成了什么样（本节是事实，上面那份是当初的计划）

写下来是因为两者已经明显不同 —— 读代码前先看这份，别照着计划去找不存在的文件。

```
src/
├─ index.tsx            入口：起 dsh web → 连接 → 建会话 → 渲染；退出收尾也在这里
├─ connect.mjs          传输层：token→cookie、补 location、包装 WebSocket、装 fetch
├─ connect.d.mts        ↑ 的手写类型声明（官方没有导出客户端侧的类型，见文件头说明）
├─ client-loader.mjs    在 Node 里跑官方浏览器 bundle 的最小模块加载器
├─ dsh-web.mjs          起 / 收 dsh web 子进程（Windows 上走 taskkill /T 收进程树）
├─ dsh-web.d.mts        ↑ 的手写类型声明
└─ ui/
    ├─ App.tsx          顶层：布局 + 状态 + 键盘路由
    ├─ PanelBox.tsx     面板外框，以及它自己占几行（panelHeight）
    ├─ ComposerBox.tsx  输入框外框，以及它自己占几行（composerHeight）
    ├─ layout.ts        逻辑行 → 物理行；行首标记；滚动区排布（scrollLayout）
    ├─ width.ts         显示宽度（查表）、折行、截断、控制字符归一化
    ├─ unicode-width.ts 东亚宽度范围表（**自动生成**，别手改）
    ├─ theme.ts         语义色令牌
    ├─ transcript.ts    事件流 → 逻辑行
    ├─ editor.ts        纯函数文本编辑器（按码点增删移动）
    ├─ input.ts         输入框折行 + 光标定位
    ├─ question-flow.ts 提问流程的纯 reducer
    ├─ panels.ts        面板的「行数组」构造
    ├─ cursor.ts        终端度量（高度、宽度）+ 光标补偿；两个 .mjs 的类型也在这里
    ├─ keys.ts          按键判定
    └─ types.ts         事件形状的宽松声明
```

计划里没落地的：`transport/` 目录（并成了一个 `connect.mjs`）、
`backend/session.ts` 和 `state/store.ts`（会话状态直接订阅官方 store，没有再包一层）、
`ui/menu/`（Esc 菜单还没做）。
`ui/` 里多出来的：`width.ts`、`unicode-width.ts`、`cursor.ts`、`keys.ts`、
`ComposerBox.tsx`、`question-flow.ts` —— 都是写的过程中发现「必须自己管」的东西
（中文列宽、Ink 的光标坐标、按键的终端差异）。

---

## 五、已知的坑（提前记下）

| 坑 | 说明 |
|---|---|
| React 实例冲突 | Ink 和官方客户端库必须共用同一个 React，否则 hook 报错 |
| 中文字符宽度 | 终端里中文占 2 列，对齐要专门算 |
| cookie 绑定端口 | 换端口要重新取 cookie |
| 授权 | `Host` 必须是 loopback 或 `trustedHosts` 命中；`Origin` 必须和 Host 相等 |
| `location.origin` 兜底 | 没有 `location` 时基址是 `http://dsh.internal`（假地址），必须靠传输层覆盖 |
| Windows 终端能力差异 | 真彩色、鼠标、备用屏幕缓冲区在不同终端表现不同 |

---

## 六、和 dsh 版本的关系

- 依赖的是**生成的 API 契约**，比内部实现稳定
- 但 dsh 是 `0.1.5-rc.x`，**0.x 版本语义化程度低**，仍有变动可能
- 应对：把版本要求写进 `package.json`，dsh 升级后先跑阶段 1 的探针脚本验证

---

## 七、附：被否决的方案及原因

见 [RESEARCH.md](RESEARCH.md) 第七节。
