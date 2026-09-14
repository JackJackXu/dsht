// 官方「客户端模块」加载器 —— 让 dsh 的浏览器端插件能在 Node 里跑
//
// 背景
// ----
// 官方的 `lib/client.js` 不是普通 npm 模块，而是「客户端模块 bundle」。
// 它们执行：
//
//     window.__ModuleLoader__.load({ id, factory })
//
// 把自己注册进一张模块表；`factory(require)` 返回该模块的导出，而导出
// 是一个 Cordis 插件（带 `apply` / `inject`）。
//
// `require()` 的目标可能是另一个客户端模块，也可能是真正的 npm 包
// （例如 `@deepseek-ai/cordis`），所以要两种都支持。
//
// 注意：官方没有承诺这个格式稳定。如果哪天跑不起来，先看这里。

import { createRequire } from 'node:module'

const realRequire = createRequire(import.meta.url)

const registry = new Map() // id -> factory
const instances = new Map() // id -> exports
const loading = new Set()

/** 给 Node 补一个最小的 window + 模块表。重复调用无害。 */
export function installModuleLoaderShim() {
  if (globalThis.window?.__ModuleLoader__ !== undefined && registry.size > 0) return
  globalThis.window ??= globalThis
  globalThis.window.__ModuleLoader__ = {
    load({ id, factory }) {
      if (typeof id !== 'string' || typeof factory !== 'function') {
        throw new TypeError('__ModuleLoader__.load: 需要 { id: string, factory: function }')
      }
      if (registry.has(id)) throw new Error(`重复注册的客户端模块 id: ${id}`)
      registry.set(id, factory)
    },
  }
}

/**
 * 解析一个 id：
 *   1. 已注册的客户端模块 → 用我们自己的实例表
 *   2. 注册名不带 `/client` 而 require 名带 → 去掉后缀再试
 *      （`@deepseek-ai/dsh-api-gateway` 就是这样）
 *   3. 都不是 → 回退给真正的 node require
 */
function clientRequire(id) {
  if (registry.has(id)) return instantiate(id)
  const base = id.replace(/\/client$/, '')
  if (registry.has(base)) return instantiate(base)
  return realRequire(id)
}

function instantiate(id) {
  if (instances.has(id)) return instances.get(id)
  if (loading.has(id)) throw new Error(`客户端模块循环依赖: ${id}`)
  loading.add(id)
  try {
    const mod = { exports: {} }
    const out = registry.get(id)(clientRequire) ?? mod.exports
    instances.set(id, out)
    return out
  } finally {
    loading.delete(id)
  }
}

/**
 * 加载一个客户端 bundle（执行它顶层的 `load()` 注册）。
 * @param id 包名
 * @param subpath 默认 `client`
 */
export async function importClientBundle(id, subpath = 'client') {
  await import(`${id}/${subpath}`)
}

/** 取一个已注册的客户端模块的导出（一个 Cordis 插件）。 */
export function getClientModule(id) {
  return clientRequire(id)
}

