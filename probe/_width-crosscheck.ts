// 逐码点核对宽度算法 —— 拿 Unicode 官方数据当标准答案
//
// 跑法：npm run width:check
// 前置：先跑 python probe/gen-unicode-width.py 生成 probe/.width-truth.txt
//
// 为什么要这一步：范围表是生成的，查表的代码是手写的，两者之间可能悄悄对不上
// （区间打包写错、二分写错、区间合并时吞掉一格……）。这些错都不会让测试变红，
// 只会让界面在某些罕见字符下歪一格。唯一的办法是拿 111 万个码点全比一遍。
import * as fs from 'node:fs'
import { charWidth, isAmbiguousCodePoint } from '../src/ui/width.ts'

const truthPath = new URL('./.width-truth.txt', import.meta.url)
if (!fs.existsSync(truthPath)) {
  console.error('找不到真值表。先跑：python probe/gen-unicode-width.py')
  process.exitCode = 1
} else {
  const lines = fs.readFileSync(truthPath, 'utf8').trim().split(/\r?\n/)
  let checked = 0
  let badWidth = 0
  let badAmbiguous = 0
  const samples: string[] = []

  for (const line of lines) {
    const parts = line.split(',')
    const cp = parseInt(parts[0]!, 16)
    const eaw = (parts[1] ?? '').trim()
    const want = parseInt(parts[2] ?? '', 10)
    const ch = String.fromCodePoint(cp)
    checked++

    const got = charWidth(ch)
    if (got !== want) {
      badWidth++
      if (samples.length < 10) samples.push(`U+${parts[0]!.toUpperCase()} eaw=${eaw} 算出 ${got} 列，应 ${want} 列`)
    }
    // 不定宽的判定也必须跟官方一致 —— 标记符号的安全检查全靠它
    if ((eaw === 'A') !== isAmbiguousCodePoint(cp)) {
      badAmbiguous++
      if (samples.length < 10) samples.push(`U+${parts[0]!.toUpperCase()} 的不定宽判定错了`)
    }
  }

  console.log('')
  console.log(`核对了 ${checked} 个码点`)
  console.log(`  宽度算错：${badWidth}`)
  console.log(`  不定宽判定错：${badAmbiguous}`)
  for (const s of samples) console.log('   ', s)
  console.log('')
  if (badWidth === 0 && badAmbiguous === 0) {
    console.log('✅ 全部一致：这个函数跟 Unicode 官方数据完全吻合。')
  } else {
    console.log('❌ 有偏差 —— 别忽视，界面会在特定字符下歪一格。')
    process.exitCode = 1
  }
}
