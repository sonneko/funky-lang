import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { createServer } from 'vite'

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
try {
  const { compileInBrowser, runInBrowserWorker } = await server.ssrLoadModule('/src/compiler.ts')
  const valid = compileInBrowser('using printLine from "std/io"; main >! $Unit is printLine "browser check";')
  assert.equal(valid.diagnostics.length, 0, valid.diagnostics.join('\n'))
  assert.ok(valid.javascript?.includes('__funkyMain'))

  const invalid = compileInBrowser('wrongArgumentType > ($Int > $Int) is fn value: $Never > $Int is 0;')
  assert.ok(invalid.diagnostics.some(message => message.includes('not assignable')), invalid.diagnostics.join('\n'))

  const blobs = new Map()
  let blobSequence = 0
  const originalWorker = globalThis.Worker
  const originalWindow = globalThis.window
  const originalCreateObjectURL = URL.createObjectURL
  const originalRevokeObjectURL = URL.revokeObjectURL
  URL.createObjectURL = blob => {
    const id = `blob:smoke-${++blobSequence}`
    blobs.set(id, blob)
    return id
  }
  URL.revokeObjectURL = id => blobs.delete(id)
  globalThis.window = globalThis
  globalThis.Worker = class SmokeWorker {
    constructor(id) {
      this.terminated = false
      queueMicrotask(async () => {
        try {
          const code = await blobs.get(id).text()
          runInNewContext(code, {
            postMessage: data => setTimeout(() => { if (!this.terminated) this.onmessage?.({ data }) }, 0),
          }, { timeout: 1000 })
        } catch (error) {
          setTimeout(() => { if (!this.terminated) this.onerror?.({ message: error.message, preventDefault() {} }) }, 0)
        }
      })
    }
    terminate() { this.terminated = true }
  }
  try {
    const execution = await runInBrowserWorker(valid.javascript, {})
    assert.deepEqual(execution.logs, ['browser check'])
    assert.equal(execution.result, '()')
  } finally {
    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevokeObjectURL
    if (originalWorker === undefined) delete globalThis.Worker
    else globalThis.Worker = originalWorker
    if (originalWindow === undefined) delete globalThis.window
    else globalThis.window = originalWindow
  }

  console.log('Browser compiler smoke test passed: parse → Funky checks → TypeScript strict check → emit → Worker runtime.')
} finally {
  await server.close()
}
