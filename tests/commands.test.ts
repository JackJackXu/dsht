// 斜杠命令的筛选与补全
//
// 为什么要测：命令面板是用户**不用背命令名**的唯一途径（他是非程序员）。
// 筛选逻辑错一点，面板就会漏掉命令或者选错一条。
import {
  argumentsOf, commandPrefixOf, completionFor, filterCommands, syntaxOf, type SlashCommand,
} from '../src/ui/commands.ts'

let pass = 0, fail = 0
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name) }
  else { fail++; console.log('  ✗', name, detail !== undefined ? `\n      ${detail}` : '') }
}
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; console.log('  ✓', name) }
  else { fail++; console.log('  ✗', name, `\n      得到 ${g}\n      期望 ${w}`) }
}

const CMD: SlashCommand[] = [
  { name: 'compact', description: 'Compact older conversation history' },
  { name: 'export', description: 'Download this Session log as a ZIP archive' },
  { name: 'feedback', description: 'record feedback', input: { hint: '<text>' } },
  { name: 'goal', description: 'set or view the goal', input: { hint: '[<objective>|clear]' } },
  { name: 'permission', description: 'Switch the permission preset', input: { hint: '<preset>' } },
  { name: 'plan', description: 'Enter or leave plan mode', input: { hint: '[off|message]' } },
]

console.log('=== 什么时候算「正在打命令名」===')
eq('空输入不算', commandPrefixOf(''), undefined)
eq('普通文字不算', commandPrefixOf('你好'), undefined)
eq('斜杠开头算（刚敲下 /）', commandPrefixOf('/'), '')
eq('打了半截算', commandPrefixOf('/pl'), 'pl')
eq('大小写不影响', commandPrefixOf('/PL'), 'PL')
// 有空格 = 命令名已经打完了，现在在打参数，不该再弹面板
eq('有空格就不算了', commandPrefixOf('/plan '), undefined)
eq('带参数的不算', commandPrefixOf('/plan off'), undefined)

console.log('=== 按前缀筛 ===')
eq('空前缀给全部', filterCommands(CMD, '').length, 6)
eq('pl 只匹配 plan', filterCommands(CMD, 'pl').map(c => c.name), ['plan'])
eq('p 匹配 permission 和 plan', filterCommands(CMD, 'p').map(c => c.name), ['permission', 'plan'])
eq('per 只匹配 permission', filterCommands(CMD, 'per').map(c => c.name), ['permission'])
eq('大写也能筛（不区分大小写）', filterCommands(CMD, 'PL').map(c => c.name), ['plan'])
eq('筛不到就是空', filterCommands(CMD, 'zzz').length, 0)
eq('结果按名字排序', filterCommands(CMD, '').map(c => c.name), ['compact', 'export', 'feedback', 'goal', 'permission', 'plan'])

console.log('=== 选中之后输入框该变成什么 ===')
{
  const compact = CMD.find(c => c.name === 'compact')!
  const permission = CMD.find(c => c.name === 'permission')!
  // 不需要参数 → null，表示「直接执行，不用落回输入框」
  eq('无参数命令返回 null', completionFor(compact), null)
  // 需要参数 → 填进输入框，末尾那个空格很关键
  eq('有参数命令补成 /name 加空格', completionFor(permission), '/permission ')
  eq('补全之后就不算「还在打命令名」了', commandPrefixOf(completionFor(permission)!), undefined)
}

console.log('=== 面板里显示的那一行 ===')
{
  eq('无参数只显示命令名', syntaxOf(CMD[0]!), '/compact')
  eq('有参数带上占位说明', syntaxOf(CMD.find(c => c.name === 'plan')!), '/plan [off|message]')
}

console.log('=== 边界：命令清单为空时不能崩 ===')
{
  eq('空清单筛出来是空', filterCommands([], '').length, 0)
  eq('空清单 + 前缀也是空', filterCommands([], 'p').length, 0)
}

console.log('=== 参数变成选项（用户要求：不要命令，只要选项）===')
{
  // 不需要参数的命令 → 空数组（调用方直接执行）
  eq('compact 不需要参数', argumentsOf(CMD.find(c => c.name === 'compact')!).length, 0)
  eq('export 不需要参数', argumentsOf(CMD.find(c => c.name === 'export')!).length, 0)

  // /permission 的预设**从投影来**，不硬编码
  const perm = CMD.find(c => c.name === 'permission')!
  eq('没给预设时不给选项（不硬编码）', argumentsOf(perm).length, 0)
  const presets = [
    { value: 'read-only', name: 'read-only' },
    { value: 'workspace-write', name: 'workspace-write', description: '可以在工作区里写' },
    { value: 'danger-full-access', name: 'danger-full-access' },
  ]
  const args = argumentsOf(perm, presets)
  eq('给了预设就变成三个选项', args.length, 3)
  eq('第一个选项直接执行整条命令', args[0]!.action === 'execute' ? args[0]!.command : undefined, '/permission read-only')
  eq('说明带过来了', args[1]!.description, '可以在工作区里写')
  ok('每个选项都是「选完就能跑」，不需要用户打参数',
     args.every(a => a.action === 'execute'), JSON.stringify(args))

  // 自由文本类的参数：没法变成选项，就老实填进输入框
  const fb = argumentsOf(CMD.find(c => c.name === 'feedback')!)
  eq('feedback 只有一个「写一段反馈」选项', fb.length, 1)
  eq('它是 fill 而不是 execute', fb[0]!.action === 'fill' ? fb[0]!.prefix : undefined, '/feedback ')
  eq('它没有 execute（因为内容得用户自己写）', fb[0]!.action, 'fill')

  // /plan 和 /goal 的选项是写死的（协议只给占位文字、不给可选值）
  const plan = argumentsOf(CMD.find(c => c.name === 'plan')!)
  ok('plan 给了「进入/关闭」两个选项', plan.length === 2 && plan.every(a => a.action === 'execute'),
     JSON.stringify(plan))
  const goal = argumentsOf(CMD.find(c => c.name === 'goal')!)
  ok('goal 里有 暂停/继续/清除', ['pause', 'resume', 'clear'].every(
    k => goal.some(a => a.action === 'execute' && a.command === `/goal ${k}`)), JSON.stringify(goal))

  // 不认识的命令（dsh 以后加了新命令）→ 不猜，交给调用方退化
  eq('不认识的需要参数命令 → 空（调用方会退化成让用户手打）',
     argumentsOf({ name: 'brandnew', description: 'x', input: { hint: '<what>' } }).length, 0)
}

console.log('')
console.log(`通过 ${pass} / ${pass + fail}`)
if (fail > 0) process.exitCode = 1
