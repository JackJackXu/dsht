# -*- coding: utf-8 -*-
"""从 Python 自带的 Unicode 数据库生成「东亚宽度」范围表。

跑法：python probe/gen-unicode-width.py
输出：src/ui/unicode-width.ts

为什么要生成而不是手写：手写范围必然漏（我们之前那份就漏掉了整个
0x2000-0x2E7F 段，※、…、→、“” 全在里面，而这段正是符号最密集的地方）。
Python 的 unicodedata 跟 Unicode 官方数据同步，不依赖网络。
"""
import unicodedata as ud
import io, sys

NL = chr(10)   # 显式换行，免得 Windows 文本模式写出 \r\n

MAX = 0x110000

def ranges(pred):
    """把满足 pred 的码点压成 [起, 止] 区间列表（连续或仅差 1 格的合并）。"""
    out = []
    start = None
    prev = None
    for cp in range(MAX):
        ok = pred(cp)
        if ok:
            if start is None:
                start = cp
            prev = cp
        else:
            if start is not None:
                out.append((start, prev))
                start = None
    if start is not None:
        out.append((start, prev))
    # 合并只差 1 格的相邻区间（省体积，不影响正确性）
    merged = []
    for a, b in out:
        if merged and a - merged[-1][1] <= 1:
            merged[-1] = (merged[-1][0], b)
        else:
            merged.append((a, b))
    return merged

def eaw(cp):
    try:
        return ud.east_asian_width(chr(cp))
    except ValueError:
        return 'N'

wide = ranges(lambda cp: eaw(cp) in ('W', 'F'))
narrow0 = ranges(lambda cp: ud.category(chr(cp)) in ('Mn', 'Me') or cp == 0x200B or cp == 0x200D or cp == 0xFEFF)
amb = ranges(lambda cp: eaw(cp) == 'A')

def fmt(name, rs, comment):
    lines = [f'/** {comment} */', f'export const {name}: ReadonlyArray<readonly [number, number]> = [']
    row = []
    for a, b in rs:
        row.append(f'[0x{a:04x}, 0x{b:04x}]')
        if len(row) == 4:
            lines.append('  ' + ', '.join(row) + ',')
            row = []
    if row:
        lines.append('  ' + ', '.join(row) + ',')
    lines.append(']')
    return '\n'.join(lines)

body = [fmt('WIDE', wide, '东亚宽度 W/F：一定是 2 列。'),
        '',
        fmt('ZERO', narrow0, '不占位（组合符号、零宽字符）。'),
        '',
        fmt('AMBIGUOUS', amb, '东亚宽度 A（不定宽）：字体说了算，1 列还是 2 列无法预测。')]

header = f'''// 东亚宽度范围表 —— **自动生成，不要手改**
//
// 生成：python probe/gen-unicode-width.py
// 数据源：Python 自带的 unicodedata（跟 Unicode 官方数据同步，不需要联网）
//
// 用途：终端里对齐/换行/截断都要按「显示宽度」算，不能按字符个数算。
// 手写范围必然漏 —— 本项目第一版就漏掉了整个 0x2000-0x2E7F 段，
// 而 ※ … → “” 这些符号全在里面。
//
// 统计：宽 {len(wide)} 段 · 零宽 {len(narrow0)} 段 · 不定宽 {len(amb)} 段

'''

io.open('src/ui/unicode-width.ts', 'w', encoding='utf-8').write(header + '\n'.join(body) + '\n')
print(f'宽 {len(wide)} 段 / 零宽 {len(narrow0)} 段 / 不定宽 {len(amb)} 段')

# 顺带导出「真值表」，给 probe/_width-crosscheck.ts 逐码点核对用。
# 这是防止「生成的表和查表的代码之间悄悄对不上」的唯一办法 ——
# 两边各写一遍，然后逐点比 111 万个码点。
rows = []
for cp in range(MAX):
    ch = chr(cp)
    try:
        e = ud.east_asian_width(ch)
        cat = ud.category(ch)
    except ValueError:
        continue
    if cat in ('Mn', 'Me') or cp in (0x200b, 0x200d, 0xfeff):
        want = 0
    elif e in ('W', 'F'):
        want = 2
    else:
        want = 1          # 含不定宽 A（默认按 1 列）
    rows.append('%x,%s,%d' % (cp, e, want))
io.open('probe/.width-truth.txt', 'w', encoding='utf-8', newline=NL).write(NL.join(rows))
print('真值表 %d 个码点 → probe/.width-truth.txt' % len(rows))
