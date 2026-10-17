import './style.css'
import { basicSetup } from 'codemirror'
import { indentWithTab } from '@codemirror/commands'
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'

const examples: Record<string, string> = {
  collections: `using filter foldLeft map range from "std/list";
using concat intToString from "std/text";
using printLine from "std/io";

isEven value: $Int > $Bool is eq (mod_ value 2) 0;

main >! $Unit is
  do {
    values <- range 1 10;
    evens <- filter isEven values;
    doubled <- map (fn value: $Int > $Int is mul value 2) evens;
    total <- foldLeft add 0 doubled;
    printLine (concat "sum of doubled evens: " (intToString total));
    ()
  } where {};
`,
  match: `using concat from "std/text";
using printLine from "std/io";

$Notification is | Quiet = $Unit Message = $String |;

describe notification: $Notification > $String is
  match notification is {
    | Quiet => "quiet";
    | Message(text) => concat "message: " text;
  };

main >! $Unit is
  do {
    printLine (describe (Message("Funky is typed and checked")));
    printLine (describe Quiet);
    ()
  } where {};
`,
  files: `using readText printLine ioErrorMessage from "std/io";
using concat split trim from "std/text";

main >! $Unit is
  do {
    contents <- readText "notes.txt";
    match contents is {
      | Err(problem) => printLine (concat "could not read notes.txt: " (ioErrorMessage problem));
      | Ok(text) =>
          for line in split "\\n" text do
            printLine (trim line);
    };
    ()
  } where {};
`,
  json: `using printLine readText ioErrorMessage from "std/io";
using concat from "std/text";
using jsonField parseJson Text from "std/json";

main >! $Unit is
  do {
    source <- readText "settings.json";
    match source is {
      | Err(problem) => printLine (concat "could not read settings.json: " (ioErrorMessage problem));
      | Ok(text) =>
          match parseJson text is {
            | Err(_) => printLine "settings.json is not valid JSON";
            | Ok(document) =>
                match jsonField "theme" document is {
                  | None => printLine "missing theme";
                  | Some(value) =>
                      match value is {
                        | Text(theme) => printLine (concat "theme: " theme);
                        | _ => printLine "theme must be a string";
                      };
                };
          };
    };
    ()
  } where {};
`,
}

const starterFiles = JSON.stringify({
  'notes.txt': '  Functional first\n  Types all the way down\n',
  'settings.json': '{"theme":"midnight","fontSize":14}',
}, null, 2)

const funkyLanguage = StreamLanguage.define({
  startState: () => ({ blockComment: false }),
  token(stream, state) {
    if (state.blockComment) {
      if (stream.skipTo('*/')) {
        stream.next(); stream.next(); state.blockComment = false
      } else stream.skipToEnd()
      return 'blockComment'
    }
    if (stream.match('//')) { stream.skipToEnd(); return 'lineComment' }
    if (stream.match('/*')) { state.blockComment = true; return 'blockComment' }
    if (stream.match(/"(?:\\.|[^"\\])*"?/)) return 'string'
    if (stream.match(/'(?:\\.|[^'\\])*'?/)) return 'string'
    if (stream.match(/\$[A-Za-z_][A-Za-z0-9_]*/)) return 'typeName'
    if (stream.match(/\^[A-Za-z_][A-Za-z0-9_]*/)) return 'className'
    if (stream.match(/#[A-Za-z_][A-Za-z0-9_]*/)) return 'meta'
    if (stream.match(/\b(?:if|then|else|do|where|break|for|in|is|using|from|as|fn|instance|true|false)\b/)) return 'keyword'
    if (stream.match(/-?\d[\d_]*(?:\.\d[\d_]*)?/)) return 'number'
    if (stream.match(/[A-Z][A-Za-z0-9_]*/)) return 'typeName'
    if (stream.match(/[a-z_][A-Za-z0-9_]*/)) return 'variableName'
    stream.next()
    return null
  },
})

const funkyHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#c792ea' },
  { tag: tags.typeName, color: '#82aaff' },
  { tag: tags.className, color: '#89ddff' },
  { tag: tags.meta, color: '#f78c6c' },
  { tag: tags.string, color: '#c3e88d' },
  { tag: tags.number, color: '#f78c6c' },
  { tag: tags.variableName, color: '#e6edf3' },
  { tag: tags.lineComment, color: '#687482', fontStyle: 'italic' },
  { tag: tags.blockComment, color: '#687482', fontStyle: 'italic' },
])

const editorTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: '#10151b', color: '#dce4ec', fontSize: '13px' },
  '.cm-content': { caretColor: '#c3f584', fontFamily: 'ui-monospace, "SFMono-Regular", Consolas, monospace', padding: '18px 0' },
  '.cm-line': { padding: '0 20px' },
  '.cm-gutters': { backgroundColor: '#10151b', color: '#52606d', border: 'none', paddingLeft: '8px' },
  '.cm-activeLine': { backgroundColor: '#ffffff08' },
  '.cm-activeLineGutter': { backgroundColor: '#ffffff08', color: '#aab6c2' },
  '.cm-cursor': { borderLeftColor: '#c3f584' },
  '&.cm-focused': { outline: 'none' },
  '.cm-selectionBackground, ::selection': { backgroundColor: '#284d46 !important' },
  '.cm-scroller': { overflow: 'auto' },
}, { dark: true })

const input = document.querySelector<HTMLTextAreaElement>('#virtual-files')!
input.value = starterFiles
const editor = new EditorView({
  state: EditorState.create({
    doc: examples.collections,
    extensions: [
      basicSetup,
      funkyLanguage,
      syntaxHighlighting(funkyHighlight),
      editorTheme,
      EditorView.lineWrapping,
      keymap.of([indentWithTab]),
      EditorView.updateListener.of(update => {
        if (update.docChanged) document.querySelector<HTMLElement>('#dirty-indicator')!.hidden = false
        const head = update.state.selection.main.head
        const line = update.state.doc.lineAt(head)
        document.querySelector<HTMLElement>('#cursor-position')!.textContent = `Ln ${line.number}, Col ${head - line.from + 1}`
      }),
    ],
  }),
  parent: document.querySelector<HTMLElement>('#editor')!,
})

const runButton = document.querySelector<HTMLButtonElement>('#run-btn')!
const outputElement = document.querySelector<HTMLElement>('#output')!
const diagnosticsElement = document.querySelector<HTMLElement>('#diagnostics')!
const typescriptElement = document.querySelector<HTMLElement>('#typescript')!
const statusChip = document.querySelector<HTMLElement>('#compile-status')!
const statusText = document.querySelector<HTMLElement>('#status-text')!
const outputCount = document.querySelector<HTMLElement>('#output-count')!
const diagnosticsCount = document.querySelector<HTMLElement>('#diagnostics-count')!
const runTime = document.querySelector<HTMLElement>('#run-time')!
const toast = document.querySelector<HTMLElement>('#toast')!
let toastTimer = 0

function showToast(message: string) {
  toast.textContent = message
  toast.classList.add('visible')
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 1800)
}

function setStatus(kind: 'idle' | 'busy' | 'success' | 'error', label: string) {
  statusChip.className = `status-chip status-${kind}`
  statusText.textContent = label
}

function selectPanel(panelId: string) {
  document.querySelectorAll<HTMLButtonElement>('.result-tab').forEach(button => {
    const active = button.dataset.tab === panelId
    button.classList.toggle('active', active)
    button.setAttribute('aria-selected', String(active))
  })
  document.querySelectorAll<HTMLElement>('.result-view').forEach(panel => {
    const active = panel.id === panelId
    panel.hidden = !active
    panel.classList.toggle('active', active)
  })
}

function getVirtualFiles(): Record<string, string> {
  const parsed: unknown = JSON.parse(input.value)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('仮想ファイルは JSON object で指定してください。')
  const files: Record<string, string> = {}
  for (const [name, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') throw new Error(`仮想ファイル ${name} の内容は文字列にしてください。`)
    files[name] = value
  }
  return files
}

async function runProgram() {
  const startedAt = performance.now()
  const source = editor.state.doc.toString()
  runButton.disabled = true
  runButton.classList.add('is-running')
  setStatus('busy', '型チェック中')
  outputElement.textContent = 'Funky を解析して TypeScript strict check を実行しています…'
  diagnosticsElement.textContent = 'Checking…'
  outputCount.textContent = ''
  diagnosticsCount.textContent = ''
  typescriptElement.textContent = '// TypeScript を生成しています…'
  runTime.textContent = ''
  selectPanel('output-panel')

  try {
    const { compileInBrowser, runInBrowserWorker } = await import('./compiler.ts')
    const compiled = compileInBrowser(source)
    typescriptElement.textContent = compiled.typescript
    if (compiled.diagnostics.length) {
      diagnosticsElement.textContent = compiled.diagnostics.join('\n')
      diagnosticsCount.textContent = String(compiled.diagnostics.length)
      outputElement.textContent = `TypeScript の型チェックに失敗しました（${compiled.diagnostics.length}件）。`
      setStatus('error', '型エラー')
      selectPanel('diagnostics-panel')
      return
    }
    diagnosticsElement.textContent = 'エラーはありません。TypeScript strict check に成功しました。'
    diagnosticsCount.textContent = ''
    setStatus('busy', '実行中')

    const files = getVirtualFiles()
    const result = await runInBrowserWorker(compiled.javascript!, files)
    const lines = [...result.logs]
    lines.push(`\n✓ Finished · main returned ${result.result}`)
    outputElement.textContent = lines.join('\n')
    outputCount.textContent = result.logs.length ? String(result.logs.length) : ''
    runTime.textContent = `${Math.round(performance.now() - startedAt)} ms`
    setStatus('success', '型チェック済み')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    outputElement.textContent = message
    diagnosticsElement.textContent = message
    diagnosticsCount.textContent = '1'
    setStatus('error', 'エラー')
    selectPanel('diagnostics-panel')
  } finally {
    runButton.disabled = false
    runButton.classList.remove('is-running')
    document.querySelector<HTMLElement>('#dirty-indicator')!.hidden = true
  }
}

runButton.addEventListener('click', () => void runProgram())
document.querySelector<HTMLSelectElement>('#example-select')!.addEventListener('change', event => {
  const key = (event.currentTarget as HTMLSelectElement).value
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: examples[key] ?? examples.collections } })
  void runProgram()
})
document.querySelectorAll<HTMLButtonElement>('.result-tab').forEach(button => {
  button.addEventListener('click', () => selectPanel(button.dataset.tab!))
})
document.querySelector<HTMLButtonElement>('#copy-btn')!.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(editor.state.doc.toString()); showToast('Funky ソースをコピーしました') }
  catch { showToast('クリップボードにアクセスできませんでした') }
})
document.querySelector<HTMLButtonElement>('#copy-ts-btn')!.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(typescriptElement.textContent ?? ''); showToast('TypeScript をコピーしました') }
  catch { showToast('クリップボードにアクセスできませんでした') }
})
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault()
    void runProgram()
  }
})

void runProgram()
