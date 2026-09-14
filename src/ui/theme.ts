// 配色：语义令牌层
//
// 架构借鉴了 Google Gemini CLI（Apache-2.0）——
// 它把配色分成两层：调色板（AccentBlue/Gray/…）和语义令牌（text.primary/…），
// 组件只读语义令牌，永不出现具体颜色名。换配色只改映射表。
//
// 但**令牌的划分方式是我们自己的**，不照抄它：
// 它按「文字重要性」分（primary/secondary/comment），
// 那是因为在它的界面里，用户输入在底部独立输入框、不在滚动区，
// 所以不需要靠颜色区分"谁说的"。
//
// 我们（像 Claude Code 一样）把用户和智能体放在**同一条滚动记录**里，
// 那"谁说的"就是最重要的信息 —— 所以令牌按**对象**划分。
//
// 设计原则（用户提出，比原来的方案好）：
//   **颜色只用来标识「这是什么」，不用来铺满内容。**
//   所以工具/思考这些行，只有开头的标签是彩色的，后面的具体内容是灰的。
//
// 颜色一律用 16 基础色（终端主题说了算），不用真彩色。

/** 语义令牌。组件只认这些名字，不认具体颜色。 */
export interface Palette {
  /** 你说的话 */
  user: string
  /** 智能体说的话 */
  agent: string
  /** 工具标签 */
  tool: string
  /** 思考标签 */
  thinking: string
  /** 斜杠命令本身（如 `/plan off`） */
  command: string
  /** 错误 */
  error: string
  /** 正文细节 / 提示（退灰，不抢注意力） */
  dim: string
  /** 普通边框 */
  border: string
  /**
   * 需要你注意的东西：审批/提问面板、等你回应、选中项。
   * 这个令牌存在的意义就是「突然变醒目」—— 平时用不到。
   */
  attention: string
}

/**
 * 深色底（默认）。
 *
 * 全部用**普通档**不用 bright —— 用户实测 bright 太花眼。
 * 对比度按 Windows Terminal 默认主题（Campbell）算过，见 probe/_contrast.mjs。
 */
export const DARK_PALETTE: Palette = {
  user: 'cyan',        // 6.14:1
  agent: 'white',      // 12.18:1 —— 正文用中性色
  tool: 'green',       // 5.71:1
  // DeepSeek 的品牌蓝，也是「思维链」的致敬 —— 但用亮版：
  // 普通蓝只有 2.38:1（太暗），亮蓝 4.95:1 达标，而且不丑。
  // （注意：magenta 更差，只有 2.44:1，别被"换个亮色相"的建议带偏。）
  thinking: 'blueBright',
  // 斜杠命令用蓝色。为什么也是亮蓝：普通蓝在这套底上是 2.38:1，几乎看不见；
  // 亮蓝 4.95:1 才达标。代价是跟「思考」同色 —— 两者靠标记区分
  // （`- /plan` vs `∗ 思考`），而且命令行很少出现。真觉得撞了再说。
  command: 'blueBright',
  // 错误也升级到亮档：普通红只有 3.23:1（勉强），亮红 5.09:1 达标。
  // 依据跟 thinking 一样 —— 错误是**必须看清**的东西（非程序员尤其），
  // 3.23:1 是这里最低的正文对比度之一。
  error: 'redBright',
  // 浅色底上亮红反而糊，所以那边维持普通红（见 LIGHT_PALETTE）
  dim: 'gray',         // 4.31:1
  border: 'gray',
  attention: 'yellow', // 7.47:1 —— 最醒目，留给"要你动手"的时刻
}

/**
 * 浅色底。
 *
 * 白底上普通档的青/黄几乎看不见，所以挑更深的色相。
 * 用 `DSHT_THEME=light` 切换。
 */
export const LIGHT_PALETTE: Palette = {
  user: 'blue',
  agent: 'black',
  tool: 'green',
  // 思考永远是「蓝色家族」——深色底上用亮蓝，白底上用深蓝。
  // 白色底上「亮」是坏事（越亮越看不清），所以这里必须反过来选深档。
  thinking: 'blue',
  command: 'blue',
  error: 'red',
  dim: 'gray',
  border: 'gray',
  attention: 'red',
}

/**
 * 选哪套。`DSHT_THEME=light|dark` 覆盖，默认深色。
 * 以后可以改成自动探测终端背景色（OSC 11），先不做。
 */
export function activePalette(): Palette {
  return process.env.DSHT_THEME === 'light' ? LIGHT_PALETTE : DARK_PALETTE
}
