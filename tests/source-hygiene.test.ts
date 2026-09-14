// 源码卫生检查
//
// 为什么要单独测这个：这个项目已经反复栽在同一件事上 ——
// 想在源码里写**两个字符** `\n`（反斜杠 + n），结果写进去的是**一个换行符**。
//
// 根源是「中间隔了一层解释器」：用 Python 的字符串去生成 TypeScript 源码时，
// Python 会先把自己的转义语法解释一遍，反斜杠就被吃掉了。
// 于是源码变成：
//   - 正则里 `/\s+/` 变成语法错误，或者 `/s+/`（按字母 s 切分）
//   - 注释里的 `\r` 变成真回车，把文件搞成「二进制文件」
//   - 字符串里 `\u0000` 变成真 NUL 字节
//   - `write('……\n')` 变成字符串里嵌一个真换行，直接语法错误
//
// 全是同一个病。而且这些错**都不会在别处被发现** —— 它们只是看起来「有点怪」，
// 或者干脆要到运行时才炸。所以这里直接按字节扫一遍：源码里不允许出现裸的控制字符。
//
// 修法是方法层面的，不是「下次小心点」：
//   1. 写源码只用字面量通道（编辑工具直接写、或 bash 的 `cat <<'EOF'`，引号保证原样传递），
//      不要经过 Python/JS 之类的字符串字面量
//   2. 万一还是发生了 —— 这个测试会立刻挡住，并告诉你哪个文件第几行第几列
//
// 跑法：npm test（已包含）
import * as fs from 'node:fs'
import * as path from 'node:path'

let pass = 0, fail = 0
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name) }
  else { fail++; console.log('  ✗', name, detail !== undefined ? `\n${detail}` : '') }
}

/** 要扫的目录（相对项目根） */
const ROOTS = ['src', 'tests', 'probe']
/** 只看这些后缀 —— 别的（比如 .txt、.png）不适用同一套规则 */
const EXTS = ['.ts', '.tsx', '.mjs', '.js', '.py', '.md', '.json']

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..')

function collect(dir: string): string[] {
  const abs = path.join(PROJECT_ROOT, dir)
  if (!fs.existsSync(abs)) return []
  const out: string[] = []
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      out.push(...collect(rel))
    } else if (EXTS.includes(path.extname(entry.name))) {
      out.push(rel)
    }
  }
  return out
}

interface Problem {
  file: string
  line: number
  column: number
  what: string
  hex: string
}

/** 逐字节扫一个文件，找出不该出现的控制字符。 */
function scan(rel: string): Problem[] {
  const bytes = fs.readFileSync(path.join(PROJECT_ROOT, rel))
  const problems: Problem[] = []
  let line = 1
  let column = 1

  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!

    if (b === 0x0a) {                       // LF：正常换行
      line++; column = 1
      continue
    }
    if (b === 0x0d) {                       // CR：只有在 CRLF 里才合法
      if (bytes[i + 1] === 0x0a) { column++; continue }
      problems.push({ file: rel, line, column, what: '裸 CR（单独的回车符）', hex: '0x0D' })
      column++
      continue
    }
    if (b >= 0x20) {                        // 可打印字符（含 UTF-8 的多字节）
      column++
      continue
    }

    // 剩下都是不该出现在源码里的 C0 控制符
    const what = b === 0x09 ? '裸制表符'
      : b === 0x00 ? 'NUL 字节'
        : `控制字符 U+${b.toString(16).toUpperCase().padStart(4, '0')}`
    problems.push({ file: rel, line, column, what, hex: `0x${b.toString(16).toUpperCase().padStart(2, '0')}` })
    column++
  }
  return problems
}

const files = ROOTS.flatMap(collect).sort()

console.log('=== 源码里不允许有裸控制字符 ===')
console.log(`  （扫了 ${files.length} 个文件：${ROOTS.join(' / ')}）`)

const all: Problem[] = []
for (const f of files) all.push(...scan(f))

if (all.length === 0) {
  ok('没有发现裸控制字符', true)
} else {
  for (const p of all.slice(0, 40)) {
    console.log(`       ${p.file}:${p.line}:${p.column}  ${p.what}（${p.hex}）`)
  }
  if (all.length > 40) console.log(`       …… 还有 ${all.length - 40} 处`)
  ok('没有发现裸控制字符', false,
    '\n  上面这些位置有不该出现的控制字符。最常见的成因是「用某种脚本语言的字符串去生成源码」，\n' +
    '  结果想写 `\\n` 却写成了真换行。改法是让写源码的通道变成字面量的（编辑工具 / 引号 heredoc），\n' +
    '  而不是在字符串里再加一层反斜杠。')
}

console.log('=== 顺带：不许出现 BOM（会让第一行的解析结果不一致）===')
{
  const withBom = files.filter(f => {
    const b = fs.readFileSync(path.join(PROJECT_ROOT, f))
    return b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf
  })
  ok('没有文件带 BOM', withBom.length === 0, `带 BOM 的：${withBom.join(', ')}`)
}

console.log('')
console.log(`通过 ${pass} / ${pass + fail}`)
if (fail > 0) process.exitCode = 1
