# AGENTS.md — dsht 项目规范

> 本文件只管 **dsht 这个项目**。工作区级的协作规范在上级 `..\AGENTS.md`，两份都生效。
> 越靠近被编辑的文件越优先 —— 所以本文件的规则**覆盖**上级的同名规则。

---

## 一、这个项目是什么

给 dsh 做一个终端界面：平时是聊天，按 Esc 弹出游戏式菜单。

- 计划：[docs/PLAN.md](docs/PLAN.md)
- 架构：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 调研证据：[docs/RESEARCH.md](docs/RESEARCH.md)

---

## 二、🔴 红线（违反 = 项目失败，没有例外）

1. ❌ **不修改 dsh 安装目录里的任何文件**
2. ❌ **不往任何 profile 里装插件**（`dsh plugin add` 一律不做）
3. ❌ **不动 `~/.dsh` 的配置和插件**
4. ❌ **不读写 `~/.dsh/sessions` 里的会话文件** —— 会话数据**只准**走官方 API 拿
5. ❌ **不使用任何第三方 dsh 前端（dsh-TUI 等）的代码** —— `_refs/dsh-tui-src` 只当参考书读，**不复制一行**
6. ❌ **不改 `_refs/` 和 `_archive/` 里的任何东西**（那是参考资料和存档，只读）

**唯一允许的"接触"**：启动一个 `dsh web` 子进程，通过它的官方 API 连接。这是 dsh 自带功能，不算修改。

---

## 三、工作流

### 每一步都要能验证

做完一小步 → 给出**具体怎么验证** → 用户点头 → 再往下。

不许一次性憋大招。

### 遇到不确定，先停下来问

尤其是：dsh 内部行为、API 契约、终端能力差异。**不许猜**。

### 阶段 1（探针）是分水岭

如果 1–3 天内跑不通，**立刻停**，报告卡在哪，换备用方案。不许硬拖。

---

## 四、写代码的规矩

1. **小步提交**：`feat:` / `fix:` / `chore:` / `docs:`，一个 commit 一件事
2. **改前必先 read 该文件**
3. **干净**：无调试残留、无死代码；注释写"为什么"，不写"是什么"
4. **中文注释**：本项目的注释和文档用中文（用户是非程序员，要能看懂）
5. **依赖要克制**：能不引第三方就不引。引之前说明理由
6. **版本锁死**：跟 dsh 的 API 包要用精确版本，不用 `^` 放宽
7. **类型检查是测试的一部分**：`npm test` 会先跑 `npm run typecheck`。
   类型错了不必再跑行为测试。别为了让检查通过而写 `as any` —— 那等于把注释变成谎言。

### 技术上的特别注意

1. **React 实例只能有一个** —— Ink 和官方客户端库必须共用，否则 hook 报错
2. **中文字符宽度** —— 终端里中文占 2 列，所有对齐计算都要考虑。
   一律用 `src/ui/width.ts` 的 `displayWidth`，不许用 `.length`
3. **传输层是核心** —— `globalThis.__DSH_TRANSPORT__`，改它之前先读 RESEARCH.md 第五节
4. **盒子的高度必须等于它实际渲染的行数** —— 这是本界面最容易出、最难查的 bug。

   Ink 的 `overflow="hidden"` **不是裁剪，是挤压**：内容超出固定高度时它会丢行或叠字，
   而且**总行数看起来还是对的**。表现出来只是「有点歪」，几乎不可能一眼定位。

   所以：
   - 一行内容占几行，必须由**产生它的那个盒子**说了算（`composerHeight` / `panelHeight` /
     `scrollLayout`），调用方只做加法，**不许在别处重算**（别写 `columns - 6` 这种魔法数）
   - 会换行的内容（错误消息、长标题）要么按真实折行数记账，要么主动裁成固定行数
   - 改动布局后跑 `npm test`，`tests/frame.test.tsx` 会断言**帧行数 == 终端行数**，
     而且会检查关键的行（比如滚动提示）确实完整出现了

---

## 五、环境边界

- **别清空 `%LOCALAPPDATA%\Temp`**（会毁沙箱后端）
- 出网类操作（`git push`、`npm publish`、访问 GitHub）在沙箱里经常不通，**交给用户在自己终端跑**
- 沙箱里 `github.com` 的 git 访问不稳，但 `codeload.github.com`、`registry.npmjs.org` 可用

---

## 六、工具环境的已知噪音（不影响结果，但要知道）

### pwsh 在只读沙箱下会先报两行 stderr

```
无法创建类型。在语言模式下不支持创建核心类型。
[System.Text.UTF8Encoding]::new($false)  ← 失败
```

这是 harness 自己的编码前置命令，在只读沙箱的 ConstrainedLanguage 下被挡了，
**不是命令本身出错**，也不影响结果。

**副作用**：pwsh 里的中文输出会变成乱码（GBK 码页）。
要看清中文，走 `read` 工具读文件，或改用 `bash`。

> 对 dsht 这种中文终端 UI 项目，这点要记着 —— 排查中文问题时别被这个误导。

### GitHub 访问不稳定

- `github.com` 的 git 操作经常 `Connection reset`
- 但 `codeload.github.com`、`registry.npmjs.org`、`cdn.jsdelivr.net` 可用

需要 clone 仓库时，优先用 `codeload` 下 tarball。
