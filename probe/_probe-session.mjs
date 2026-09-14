// 探针专用会话的获取方式 —— 所有探针共用这一份
//
// 为什么需要它（四条都是踩出来的）：
//
//  1. **不能每次新建**：初始版本每个探针都 `sessions.create()`，跑了十几次之后
//     用户的会话列表里多了十几个空会话，而且没法区分哪个是垃圾。
//
//  2. **不能随便挑一个已有会话**：试过「复用列表里第一个」，结果挑中了用户的
//     真实会话（可能正在他自己的 dsh web 里活跃），一 open 就报 `gateway/internal`；
//     子代理留下的 `agent-busy` 会话更是直接卡住。
//
//  3. **不能靠改名来标记**：`ctx.remote.session.rename()` 在同一个进程里有效，
//     但**换一个 dsh web 进程就丢了** —— 实测会话文件里根本没有 rename 事件。
//     所以「按标题找自己的会话」这条路是死的（探针每次都要起一个新进程）。
//
//  4. **失败不能静默**：改名曾经写成 `ctx.remote?.['session/rename']?.(...)`，
//     两个可选链把「方法根本不存在」吞成了 undefined，于是改名一直没生效、
//     复用一直找不到自己的会话，每次都新建 —— 而且全程没有任何报错。
//
// 现在的做法：**把探针会话的 id 记在一个文件里**（probe/.probe-session-id，已 gitignore）。
// 跨进程靠这个 id 找到它，永远只占一个。用户删掉了也不要紧，下次自动重建。

import * as fs from 'node:fs'
import * as path from 'node:path'

/** 探针会话 id 的存放位置（相对本文件）。 */
const ID_FILE = new URL('./.probe-session-id', import.meta.url)

/**
 * 在探针会话里写一句人话。
 *
 * 为什么不靠改名：见上面第 3 条，改名不落盘。
 * 而 `/feedback` 是走正规事件流的，落盘、且不花 token（不走模型）。
 * 这样用户万一打开这个会话，一眼就知道它是干什么的、能不能删。
 */
const MARKER = '[探针] 这是 dsht 的探针专用会话，可以随时删除。'

function readId() {
  try {
    const id = fs.readFileSync(ID_FILE, 'utf8').trim()
    return id === '' ? undefined : id
  } catch {
    return undefined
  }
}

function writeId(id) {
  try {
    fs.writeFileSync(ID_FILE, id + String.fromCharCode(10), 'utf8')
  } catch {
    // 写不进去不影响这次运行，只是下次会再建一个 —— 不值得让探针失败
  }
}

/**
 * 拿一个探针专用会话来用（复用文件里记着的那个，没有才建）。
 *
 * @param {import('../src/connect.d.mts').DshContext} ctx 已连接的上下文
 * @returns {Promise<{ id: string, binding: any, reused: boolean }>}
 */
export async function acquireProbeSession(ctx) {
  await ctx.sessions.refresh()
  const list = ctx.sessions.list.getSnapshot()

  // ① 文件里记着的那个还在不在？（用户可能已经删了）
  let id = readId()
  if (id !== undefined && !list.ids.includes(id)) {
    id = undefined
  }

  // ② 还在就先打开看看；打不开也当它不可用
  if (id !== undefined) {
    ctx.sessions.open(id)
    const probe = ctx.sessions.binding(id)
    if (probe !== undefined) {
      for (let i = 0; i < 50; i++) {
        const st = probe.session.getSnapshot().openState
        if (st !== 'loading') break
        await new Promise(r => setTimeout(r, 200))
      }
      if (probe.session.getSnapshot().openState === 'open') {
        return { id, binding: probe, reused: true }
      }
    }
    // 打不开 → 放弃它，下面重建（不删，留给用户自己处理）
    id = undefined
  }

  // ③ 重建一个，并在里面留一句人话
  const fresh = await ctx.sessions.create({ cwd: process.cwd() })
  writeId(fresh)

  ctx.sessions.open(fresh)
  const binding = ctx.sessions.binding(fresh)
  if (binding === undefined) throw new Error('拿不到 session binding')

  for (let i = 0; i < 50; i++) {
    if (binding.session.getSnapshot().openState !== 'loading') break
    await new Promise(r => setTimeout(r, 200))
  }
  if (binding.session.getSnapshot().openState !== 'open') {
    throw new Error(`新探针会话打不开（openState=${binding.session.getSnapshot().openState}）`)
  }

  // 留个标记。失败不致命（只是用户可能认不出这个会话），但要出声。
  try {
    await binding.session.command(`/feedback ${MARKER}`)
  } catch (error) {
    console.error(`（提示：探针会话没能写上标记，它会在列表里显示成普通会话 —— ${error.message}）`)
  }

  return { id: fresh, binding, reused: false }
}

/** 探针会话 id 文件的位置，方便脚本告诉用户「那个会话在哪」。 */
export const PROBE_ID_FILE = path.relative(process.cwd(), ID_FILE.pathname.replace(/^\//, ''))
