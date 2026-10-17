import * as ts from 'typescript'
import { parse as parseFunky } from 'virtual:funky-parser'
import type { Program } from '../../mock/ast.ts'
import { transpile, typecheckInMemory } from '../../mock/transpile.ts'
import standardLibraries from 'virtual:typescript-libs'

export interface BrowserCompilation {
  typescript: string
  javascript?: string
  diagnostics: string[]
}

function parse(source: string): Program {
  try {
    return parseFunky(source) as Program
  } catch (error) {
    const failure = error as {
      message?: string
      location?: { start?: { line?: number; column?: number } }
    }
    const line = failure.location?.start?.line
    const column = failure.location?.start?.column
    const location = line === undefined ? '' : ` at ${line}:${(column ?? 0) + 1}`
    throw new Error(`${failure.message ?? String(error)}${location}`)
  }
}

export function compileInBrowser(source: string): BrowserCompilation {
  const ast = parse(source)
  const typescript = transpile(ast)
  const diagnostics = typecheckInMemory(typescript, standardLibraries)
  if (diagnostics.length) return { typescript, diagnostics }

  const output = ts.transpileModule(typescript, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      strict: true,
      alwaysStrict: true,
    },
    reportDiagnostics: true,
  })
  const syntaxErrors = (output.diagnostics ?? []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
  if (syntaxErrors.length) {
    return {
      typescript,
      diagnostics: syntaxErrors.map(diagnostic => `TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`),
    }
  }
  return { typescript, javascript: output.outputText, diagnostics: [] }
}

export interface BrowserRunResult {
  logs: string[]
  result: string
}

export function runInBrowserWorker(
  javascript: string,
  files: Record<string, string>,
  timeoutMs = 2500,
): Promise<BrowserRunResult> {
  return new Promise((resolve, reject) => {
    const workerSource = `
      const __files = new Map(Object.entries(${JSON.stringify(files)}));
      const __host = {
        args: [],
        printLine: (text) => postMessage({ kind: 'log', value: String(text) }),
        readText: (path) => {
          if (!__files.has(path)) throw new Error('virtual file not found: ' + path);
          return __files.get(path);
        },
        writeText: (path, text) => { __files.set(path, String(text)); },
        natives: Object.create(null),
      };
      ${javascript}
      try {
        if (typeof globalThis.__funkyMain !== 'function') throw new Error('main entry was not generated');
        const value = globalThis.__funkyMain();
        const result = typeof value === 'bigint' ? value.toString() : value === undefined ? '()' : String(value);
        postMessage({ kind: 'done', result });
      } catch (error) {
        postMessage({ kind: 'error', error: error instanceof Error ? error.message : String(error) });
      }
    `
    const url = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }))
    const worker = new Worker(url)
    const logs: string[] = []
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      worker.terminate()
      URL.revokeObjectURL(url)
      callback()
    }
    const timer = window.setTimeout(() => {
      finish(() => reject(new Error(`実行が ${timeoutMs}ms でタイムアウトしました。無限ループの可能性があります。`)))
    }, timeoutMs)

    worker.onmessage = event => {
      const message = event.data as { kind: string; value?: string; result?: string; error?: string }
      if (message.kind === 'log') {
        logs.push(message.value ?? '')
      } else if (message.kind === 'done') {
        finish(() => resolve({ logs, result: message.result ?? '()' }))
      } else if (message.kind === 'error') {
        finish(() => reject(new Error(message.error ?? 'Unknown runtime error')))
      }
    }
    worker.onerror = event => {
      event.preventDefault()
      finish(() => reject(new Error(event.message || 'Worker runtime error')))
    }
  })
}
