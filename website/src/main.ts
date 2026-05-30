import './style.css'
import { EditorView, crosshairCursor, drawSelection, dropCursor, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers, rectangularSelection } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { indentWithTab, history, historyKeymap, defaultKeymap } from '@codemirror/commands'
import { bracketMatching, indentOnInput } from '@codemirror/language'
import { parse } from '@funky/parser'
import { transpile } from '@funky/transpile'
import * as ts from 'typescript'

// Initial code example
const initialCode = `$Point is { x = $Int y = $Int };

/* Built-in function declaration */
log msg: $String > $Unit is #console_log;

main > $Unit is
  do {
    log "Hello from Funky!";
    log msg
  } where {
    p = Point { x = 10 y = 20 }
    msg = "Point is here"
  };
`

// Minimal setup without syntax highlighting
const minimalSetup = [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightSpecialChars(),
  history(),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  bracketMatching(),
  rectangularSelection(),
  crosshairCursor(),
  highlightActiveLine(),
  keymap.of([
    ...defaultKeymap,
    ...historyKeymap,
    indentWithTab,
  ]),
]

const editor = new EditorView({
  doc: initialCode,
  extensions: minimalSetup,
  parent: document.querySelector('#editor')!
})

const outputElement = document.querySelector('#output')!
const generatedCodeElement = document.querySelector('#generated-code')!
const runBtn = document.querySelector('#run-btn')!
const tabBtns = document.querySelectorAll('.tab-btn')

// Tab switching logic
tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const targetId = btn.getAttribute('data-tab')!

    // Update active button
    tabBtns.forEach(b => b.classList.remove('active'))
    btn.classList.add('active')

    // Update visible content
    outputElement.classList.add('hidden')
    generatedCodeElement.classList.add('hidden')
    document.querySelector(`#${targetId}`)!.classList.remove('hidden')
  })
})

function switchToTab(tabId: 'output' | 'generated-code') {
  tabBtns.forEach(btn => {
    if (btn.getAttribute('data-tab') === tabId) {
      btn.classList.add('active')
    } else {
      btn.classList.remove('active')
    }
  })

  if (tabId === 'output') {
    outputElement.classList.remove('hidden')
    generatedCodeElement.classList.add('hidden')
  } else {
    outputElement.classList.add('hidden')
    generatedCodeElement.classList.remove('hidden')
  }
}

runBtn.addEventListener('click', async () => {
  const code = editor.state.doc.toString()
  outputElement.textContent = 'Running...'
  generatedCodeElement.textContent = ''

  switchToTab('output')

  try {
    // 1. Funky -> TypeScript
    const ast = parse(code)
    const tsCode = transpile(ast)
    generatedCodeElement.textContent = tsCode

    // 2. TypeScript -> JavaScript (with type checking)
    const compilation = compileTypeScript(tsCode)

    if (compilation.errors.length > 0) {
      outputElement.textContent = 'Type Check Errors:\n' + compilation.errors.join('\n')
      return
    }

    // 3. Run JavaScript
    outputElement.textContent = ''
    const logs: string[] = []

    // Setup environment for builtins
    const env: any = {
      console_log: (...args: any[]) => {
        const message = args.map(arg => {
          if (typeof arg === 'object' && arg !== null) {
            return JSON.stringify(arg)
          }
          return String(arg)
        }).join(' ')
        logs.push(message)
        console.log(...args)
      }
    }

    // Expose env to global for the script to pick up "declare const"
    Object.assign(window, env)

    try {
      // Use a blob to run as a module so 'export' works
      const jsToRun = compilation.jsCode;
      const blob = new Blob([jsToRun], { type: 'application/javascript' })
      const url = URL.createObjectURL(blob)

      // Import the module.
      const module = await import(/* @vite-ignore */ url)

      // Execute main if it exists as an export
      if (module.main) {
        if (typeof module.main === 'function') {
          module.main();
        } else {
          env.console_log(module.main);
        }
      }

      URL.revokeObjectURL(url)

      if (logs.length > 0) {
        outputElement.textContent = logs.join('\n')
      } else {
        outputElement.textContent = '(Success - no output)'
      }
    } catch (e: any) {
      outputElement.textContent += '\nRuntime Error:\n' + e.message
    }

  } catch (e: any) {
    outputElement.textContent = 'Error:\n' + e.message
  }
})

function compileTypeScript(tsCode: string): { jsCode: string, errors: string[] } {
  // We use transpileModule for quick JS generation.
  // Full type checking in the browser is heavy and requires lib.d.ts.
  // While transpileModule doesn't do full semantic check, it does check syntax and some simple things.
  // For a pure client-side playground, this is the most common approach unless using a worker with full TS.

  const result = ts.transpileModule(tsCode, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ESNext,
      strict: true,
      alwaysStrict: true
    },
    reportDiagnostics: true
  })

  const errors = result.diagnostics ? result.diagnostics.map(d => {
    if (d.file) {
      const { line, character } = ts.getLineAndCharacterOfPosition(d.file, d.start!)
      return `(${line + 1},${character + 1}): ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`
    }
    return ts.flattenDiagnosticMessageText(d.messageText, '\n')
  }) : []

  return {
    jsCode: result.outputText,
    errors
  }
}
