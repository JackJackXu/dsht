# 终端按键上报实测

> 用 `npm run keydebug` 在真实终端里测出来的原始数据。
> 这类问题**不能猜**——同一个键在不同终端、不同版本上发的东西完全不一样。

## 怎么自己复现

```
npm run keydebug
```

然后直接按键，状态栏会实时显示原始信息：

```
input="\n" flags=[return ctrl]
```

- `input` 是按键送的字符（`JSON.stringify` 过，所以 `\r` 是回车、`\n` 是换行）
- `flags` 是 Ink 解析出来的修饰键

---

## 实测结果（Windows 11 + Windows Terminal 系终端，Ink 7.x）

### 回车类

| 按键 | 实际收到的 | 能否区分 |
|---|---|---|
| `Enter` | `input="\r"` `flags=[return]` | 基准 |
| **`Shift+Enter`** | `input="\r"` `flags=[return]` | ❌ **与 Enter 完全相同** |
| **`Ctrl+Enter`** | `input="\n"` `flags=[]` | ✅ **可用** |
| **`Ctrl+J`** | `input="\n"` `flags=[]` | ✅ **可用**（与 Ctrl+Enter 同义） |
| `Alt+Enter` | （没送到程序） | ❌ 被终端自己吃掉，切成全屏 |

### 结论

**`Shift+Enter` 在这个终端里根本不可能实现。**

终端发过来的字节与普通回车**一模一样**，程序侧没有任何信息可以区分它们。这不是实现问题，是终端协议的限制。

想换行，用 **`Ctrl+Enter`**（或同义的 `Ctrl+J`）。

### 为什么 Ctrl+Enter 和 Ctrl+J 一样

它们送的都是 **LF（换行符 0x0A）**，而 Enter 送的是 **CR（回车符 0x0D）**。

所以判断逻辑很简单：**收到 LF 就当换行**。

少数终端（能上报修饰键的）可能送 `CR` 但带 `shift`/`meta`/`ctrl` 标志，那些也一并认。

代码见 [`src/ui/keys.ts`](../src/ui/keys.ts)，回归用例见 [`tests/keys.test.ts`](../tests/keys.test.ts)。

---

## 另一类坑：Ctrl+字母 的两种上报方式

| 终端行为 | `input` | `flags` |
|---|---|---|
| 方式一 | `"a"` | `[ctrl]` |
| 方式二 | `"\u0001"`（控制字符本身） | `[]` 或 `[ctrl]` |

所以判断 Ctrl 组合键时**两种都要认**，不能只看 `key.ctrl`。`isCtrlChar()` 就是干这个的。

---

## 修 scrollback / 鼠标之前也要先测

同类的还有：

| 东西 | 风险 |
|---|---|
| `Ctrl+↑` / `Ctrl+↓` | 很多终端不上报 Ctrl 修饰键（与 Shift+Enter 同一个坑）|
| `Home` / `End` | 经常被终端拦截，或上报成 `\u001b[H` 这类序列，Ink 未必解析 |
| `Alt+<字母>` | 有些终端直接吃掉 |
| 鼠标 | 要终端开启鼠标上报，且会与"拖选复制"冲突 |

**结论：涉及按键的设计，先 `--keydebug` 测一遍，再决定绑什么。**

---

## 终端光标与中文输入法（IME）

### 现象

TUI 里如果不告诉终端"光标在哪"，会出现两个问题：

1. **右下角一直有个野光标**（终端默认把光标停在最后输出的位置）
2. **中文输入法的拼音跑到光标那里去**，而不是出现在输入框里

这两个其实是同一个原因。终端不知道我们的"输入框"在哪，只知道最后输出的位置。

### 解法：把终端光标搬到输入框

Ink 的 `useCursor()` 就是为这个设计的。它的文档原话：

> Setting a cursor position makes the cursor visible at the specified coordinates
> (relative to the Ink output origin). **This is useful for IME (Input Method Editor)
> support, where the composing character is displayed at the cursor location.**
> Pass `undefined` to hide the cursor.

```tsx
const { setCursorPosition } = useCursor()

useEffect(() => {
  setCursorPosition({ x, y })   // 坐标是相对 Ink 输出原点的
}, [x, y])
```

**我们的坐标计算**（布局是固定高度的，所以能算准）：

```
x = 左边框(1) + 内边距(1) + 行首前缀(2) + 光标前的显示宽度
y = 标题(1) + 对话区高度 + 提示行高度 + 输入框上边框(1) + 光标所在行
```

**注意**：`x` 里"光标前的显示宽度"必须用 CJK 感知的宽度算（见 `src/ui/width.ts`），
否则中文一多，光标就会跑偏。

### 光标样式

默认是方块（block），有点重。可以用 DECSCUSR 改成下划线：

```
\u001b[4 q   稳定下划线
\u001b[0 q   还原成终端默认
```

进入时发第一条，退出时发第二条还原。Windows Terminal 支持。

### 教训

**"自己画一个假光标"是错的方向。** 自己画方块看着能用，但输入法不认——
IME 只认终端真光标的位置。所以正确做法是搬真光标，而不是仿造一个。

---

## 官方 Ink 的光标"慢一帧"问题

### 现象

用 `useCursor` 定位光标时，光标总要**等下一次渲染才到位** —— 打字时光标慢半拍。

### 原因：`onRender` 的时机

React 提交阶段的大致顺序：

```
useInsertionEffect
   ↓
resetAfterCommit  ← Ink 在这里同步调用 onRender（渲染并定位光标）
   ↓
useLayoutEffect   ← 我们在这里设置光标位置，已经晚了
```

官方 Ink 的 `reconciler.js`：

```js
resetAfterCommit(rootNode) {
  ...
  if (typeof rootNode.onRender === 'function') rootNode.onRender()   // 同步！
}
```

**所以「用 effect 改状态，再靠重渲染」会让光标慢一帧。**

`dsh-tui` 的 fork 版 Ink 就是专门改了这个 —— 把 `onRender` 改成 microtask 延迟，
让 `useLayoutEffect` 先跑完。它的注释原话：

> `scheduleRender` defers `onRender` via `queueMicrotask`, so `onRender` runs
> AFTER layout effects commit and reads the fresh declaration on the first frame
> (**no one-keystroke lag**).

### 官方 Ink 下的解法

**在渲染期（而不是 effect 里）调用 `setCursorPosition`。**

`useCursor` 的实现只是往 ref 里写值，渲染期调用是安全的：

```js
const setCursorPosition = useCallback((position) => {
  positionRef.current = position     // 纯赋值，渲染期调用没问题
}, [])
```

具体做法：

1. 用 `useLayoutEffect` + `measureElement` 量出真实坐标，**存进 ref**（不是 state）
2. **渲染期**读这个 ref，调用 `setCursorPosition`
3. 测量值变了才 `forceUpdate()` 补一帧；**没变就不动**

这样打字期间布局不变 → 每次都当帧生效 → **零延迟**。

### 顺带一提：坐标不要手推

手推「边框 1 + 内边距 1 + 前缀 2 = 4」在简单情况下对，
但只要换行、溢出、内边距一变就全错。

**用 `measureElement(ref)` 量出元素真实坐标，再往上加偏移。**
它返回 `{ x, y, width, height }`，是元素在输出区域里的位置。

---

## 还有个大坑：`overflow="hidden"` 不是裁剪

Ink 的 `<Box height={3} overflow="hidden">` 里塞 6 行，**不是裁掉下面 3 行**，
而是把中间的行"挤掉"，实测渲染出 `2、4、6` —— 花屏。

**所以必须自己保证：渲染出去的行数 ≤ 盒子高度。**
我们在 `layout.ts` 里自己折行、自己算行数、自己做视口切片，就是为了这个。
