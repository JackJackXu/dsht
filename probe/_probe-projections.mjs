// 探针：状态行要的那几个数字，能不能从会话投影里读到
//
// 用法：npm run projections
import { startDshWeb } from '../src/dsh-web.mjs'
import { connect, waitForGeneration } from '../src/connect.mjs'
import { acquireProbeSession } from './_probe-session.mjs'

const KEYS = ['sessionStats', 'tokenUsage', 'costUsage', 'contextPressure', 'modelSelection', 'permissions']

const server = await startDshWeb({})
try {
  const { ctx, dispose } = await connect({ base: server.base, token: server.token })
  try {
    await waitForGeneration(ctx)
    const { binding } = await acquireProbeSession(ctx)
    const session = binding.session

    console.log('session.projections 存在?', typeof session.projections)
    console.log('')
    for (const key of KEYS) {
      const face = session.projections.faceOf(key)
      const value = face.getSnapshot()
      const text = JSON.stringify(value)
      console.log(`· ${key}`)
      console.log('   ', text === undefined ? '(undefined)' : (text.length > 260 ? text.slice(0, 260) + ' …' : text))
    }

    // 顺便验证「暂停 agent」的接口在不在
    console.log('')
    console.log('session.cancel 存在?', typeof session.cancel)
  } finally {
    await dispose()
  }
} finally {
  await server.stop()
}
