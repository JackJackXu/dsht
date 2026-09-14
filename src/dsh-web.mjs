// 起一个临时的 dsh web，拿到连接入口，用完能干净收掉
//
// 这是 dsht 自包含的基础：用户不用先自己开 dsh web。

import { spawn } from 'node:child_process'
import { createServer } from 'node:net'

/**
 * 让系统分配一个空闲端口。
 * @returns {Promise<number>}
 */
export function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address()
      // address() 在绑 Unix socket 时返回字符串；我们绑的是 127.0.0.1:0，
      // 所以一定是对象。但这个判断不能省 —— 否则拿到的就是 undefined。
      if (address === null || typeof address === 'string') {
        srv.close()
        reject(new Error('拿不到系统分配的端口号'))
        return
      }
      srv.close(() => resolve(address.port))
    })
  })
}

/** 启动 URL 长这样：`dsh web: http://127.0.0.1:7799/?token=…` */
const URL_PATTERN = /dsh web: (\S+)/

/**
 * 启动 dsh web 并等它打印出带 token 的 URL。
 *
 * @param {{ port?: number, timeoutMs?: number }} [options]
 *   port 指定端口；不给就自动找空闲的。timeoutMs 是等 URL 的超时。
 * @returns {Promise<{ base: string, token: string | null, url: string, port: number, stop: () => Promise<void> }>}
 */
export async function startDshWeb({ port, timeoutMs = 60_000 } = {}) {
  const chosen = port ?? (await findFreePort())
  const child = spawn(`dsh web --no-open --port ${chosen}`, {
    shell: true,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  /**
   * 只留最近一小段输出，用于「等不到 URL」时给用户看现场。
   *
   * ⚠️ 不要在这里无上限地 `output += chunk` —— dsh web 是长期进程，
   * 日志可能很啰嗦，那样跑几个小时就是无上限的内存增长，
   * 而且每次 `+=` 都要复制整串（O(n²)）。
   *
   * URL 是**在数据到达时就地识别**的（下面 feed 里直接 match），
   * 不依赖这个缓冲区，所以它留多小都不影响功能。
   */
  const TAIL_LIMIT = 2000
  let tail = ''
  /** @type {string | null} */
  let foundUrl = null

  const feed = chunk => {
    const text = chunk.toString()
    tail = (tail + text).slice(-TAIL_LIMIT)
    // 在 tail 上匹配而不是在 text 上 —— URL 可能被切成两个 chunk，
    // tail 保留了接缝，所以跨包的情况也能认出来。
    if (foundUrl === null) {
      const m = URL_PATTERN.exec(tail)
      if (m) foundUrl = m[1]
    }
  }
  child.stdout.on('data', feed)
  child.stderr.on('data', feed)

  /** URL 已经拿到，进程输出不再需要 —— 停掉监听，别让长跑的应用白占资源。 */
  const stopCapturing = () => {
    tail = ''
    child.stdout.off('data', feed)
    child.stderr.off('data', feed)
  }

  let stopped = false
  /** @returns {Promise<void>} */
  const stop = () =>
    new Promise(resolve => {
      if (stopped || child.exitCode !== null || child.signalCode !== null) return resolve()
      stopped = true
      if (process.platform === 'win32') {
        // Windows 上 dsh web 会拉起子进程树，用 taskkill /T 一次收干净
        const k = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        })
        k.on('close', resolve)
        k.on('error', resolve)
      } else {
        child.on('close', resolve)
        child.kill('SIGTERM')
      }
    })

  const url = await new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    const iv = setInterval(() => {
      if (foundUrl !== null) {
        clearInterval(iv)
        stopCapturing()
        resolve(foundUrl)
      } else if (Date.now() > deadline) {
        clearInterval(iv)
        void stop()
        reject(new Error(`等不到 dsh web 的启动 URL。\n它的输出：\n${tail}`))
      }
    }, 200)

    child.on('exit', code => {
      // 进程提前退出，而且始终没打印过 URL
      if (foundUrl === null && code !== null) {
        clearInterval(iv)
        reject(new Error(`dsh web 退出了（code ${code}）。\n输出：\n${tail}`))
      }
    })
  })

  const parsed = new URL(url)
  return { base: parsed.origin, token: parsed.searchParams.get('token'), url, port: chosen, stop }
}
