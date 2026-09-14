// 斜杠命令：类型、前缀筛选、以及「按了 / 之后怎么选」的纯逻辑
//
// 命令清单来自 dsh 本身（`commands/list`），不是硬编码 ——
// 装了哪些插件、什么版本，清单就跟着变。所以这里只负责**筛选和补全**，
// 不负责「有哪些命令」。
//
// 为什么要有这个：用户是非程序员，不该被要求背下命令名和参数语法。
// 输入框空着时按 `/` 直接弹出清单，方向键选、回车确认。

/** 一条斜杠命令（形状来自 dsh 的 CommandDescriptor）。 */
export interface SlashCommand {
  /** 不带斜杠的命令名，全小写 */
  readonly name: string
  /** 英文说明（dsh 给的），用来在面板里解释这条命令干什么 */
  readonly description: string
  /** 需要额外参数时才有 */
  readonly input?: {
    /** 参数的占位说明，如 `<preset>` */
    readonly hint: string
    readonly attachments?: boolean
  }
}

/** 面板里最多列几条（列太多会把对话区挤没） */
export const PALETTE_MAX_ROWS = 6

/**
 * 输入框里正在打的、还没打完的命令前缀。
 *
 * - 不是 `/` 开头 → undefined（不是命令）
 * - 已经有空格了 → undefined（命令名打完了，现在在打参数，不该再弹面板）
 * - 否则返回斜杠后面那一段（可能是空串 = 刚敲下 `/`）
 */
export function commandPrefixOf(text: string): string | undefined {
  if (!text.startsWith('/')) return undefined
  if (text.includes(' ')) return undefined
  return text.slice(1)
}

/** 按前缀筛命令（不区分大小写）。空前缀 = 全部。 */
export function filterCommands(
  commands: readonly SlashCommand[],
  prefix: string,
): SlashCommand[] {
  const p = prefix.toLowerCase()
  const matched = p === '' ? [...commands] : commands.filter(c => c.name.toLowerCase().startsWith(p))
  return matched.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * 选中一条命令之后，输入框该变成什么。
 *
 * - 不需要参数的（如 `/compact`）→ 返回 `null`，意思是「直接执行，不用落回输入框」
 * - 需要参数的（如 `/permission <preset>`）→ 返回 `/permission `，让用户接着打参数
 *
 * 注意末尾那个空格：它同时也是「命令名已经打完了」的标记，
 * 所以补全之后面板不会再弹出来。
 */
export function completionFor(command: SlashCommand): string | null {
  if (command.input === undefined) return null
  return `/${command.name} `
}

/** 面板里显示的那一行（带参数占位）。 */
export function syntaxOf(command: SlashCommand): string {
  return command.input === undefined
    ? `/${command.name}`
    : `/${command.name} ${command.input.hint}`
}

// ── 把「参数」变成「选项」 ──────────────────────────────────────
//
// 用户的原话：「不要命令，只要选项 …… 不然写参数很麻烦」。
// 非程序员不该被要求记住 `/permission <preset>` 里的 preset 有哪几个、怎么写。

/** 权限预设（`permissions` 投影里的一个选项）。 */
export interface PermissionOption {
  readonly value: string
  readonly name: string
  readonly description?: string
}

/**
 * 子面板里的一项「参数选择」。
 *
 * 用**判别联合**而不是 `execute?` + `fill?` 两个可选字段：
 * 后者允许「两个都没有」，而那种项选中之后什么都不会发生
 * （代码会先把面板关掉，然后就没有然后了 —— 用户只看到「按了回车，面板没了」）。
 * 判别联合让 TS 直接挡住那条路。
 */
export type CommandArgument = {
  /** 显示给用户看的标签 */
  readonly label: string
  /** 一句话说明，让用户不用猜 */
  readonly description?: string
} & (
  /** 选中后**直接执行**这条完整命令行（如 `/permission read-only`） */
  | { readonly action: 'execute'; readonly command: string }
  /** 选中后把这段填进输入框，等用户补内容（如 `/feedback `） */
  | { readonly action: 'fill'; readonly prefix: string }
)

/**
 * 列出这条命令的可选参数。
 *
 * ⚠️ 这里的策略是「**能自动就自动，不能自动就老实说**」：
 *
 *   · `/permission` 的预设**从 `permissions` 投影里读**（dsh 自己给的 options），
 *     不硬编码 —— 用户改了配置，选项跟着变。
 *   · 其余几条的选项写在这张表里，因为**协议的 `input.hint` 只给占位文字、
 *     不给可选值**。比如 `/plan` 的 hint 是 `[off|message]`，
 *     `off` 是真选项，`message` 却是「此处填一段话」——从字符串上分不出来。
 *     所以只能列一张表，并在注释里写明这是权宜之计（见 docs/UI-DESIGN.md 第十一节 C-7）。
 *   · 表里没有的命令 → 返回空数组，调用方会退化成「填进输入框让用户自己打」，
 *     不会假装自己知道参数。
 */
export function argumentsOf(
  command: SlashCommand,
  permissionOptions: readonly PermissionOption[] = [],
): CommandArgument[] {
  // 需要参数的命令才用得着这张表
  if (command.input === undefined) return []

  switch (command.name) {
    case 'permission':
      return permissionOptions.map(o => ({
        label: o.name,
        ...(o.description === undefined ? {} : { description: o.description }),
        action: 'execute', command: `/permission ${o.value}`,
      }))

    case 'plan':
      return [
        { label: '进入计划模式', description: '只做规划，不改动文件', action: 'execute', command: '/plan' },
        { label: '关闭计划模式', description: '恢复为可直接改动', action: 'execute', command: '/plan off' },
      ]

    case 'goal':
      return [
        { label: '设定新目标…', description: '长期任务，将按轮次自动推进', action: 'fill', prefix: '/goal ' },
        { label: '查看当前目标', action: 'execute', command: '/goal' },
        { label: '暂停', description: '保留目标但停止推进', action: 'execute', command: '/goal pause' },
        { label: '继续', action: 'execute', command: '/goal resume' },
        { label: '清除目标', action: 'execute', command: '/goal clear' },
      ]

    case 'feedback':
      return [{ label: '填写反馈…', description: '仅记录，不发送给模型', action: 'fill', prefix: '/feedback ' }]

    default:
      // 不认识的命令（以后 dsh 加了新命令）→ 不猜，交给调用方退化处理
      return []
  }
}
