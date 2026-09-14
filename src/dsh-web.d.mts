// `dsh-web.mjs` 的类型声明。理由见 src/connect.d.mts 顶部。

/** 让系统分配一个空闲端口。 */
export function findFreePort(): Promise<number>

export interface DshWebServer {
  /** 形如 http://127.0.0.1:7799 */
  base: string
  token: string | null
  url: string
  port: number
  /** 收掉 dsh web 及其子进程树（Windows 上走 taskkill /T）。可重复调用。 */
  stop(): Promise<void>
}

/**
 * 启动 dsh web 并等它打印出带 token 的 URL。
 */
export function startDshWeb(options?: {
  port?: number
  timeoutMs?: number
}): Promise<DshWebServer>
