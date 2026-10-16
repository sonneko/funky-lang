import './style.css'
import { EditorView, crosshairCursor, drawSelection, dropCursor, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers, rectangularSelection } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { indentWithTab, history, historyKeymap, defaultKeymap } from '@codemirror/commands'
import { bracketMatching, indentOnInput } from '@codemirror/language'
import { parse } from '@funky/parser'
import { transpile } from '@funky/transpile'
import { checkAndCompile } from './compiler'

const BUILTIN_DECLS = `
declare const console_log: (...args: any[]) => void;
`;

const prefix = `
print msg: $String > $Unit is #"console_log(msg)";
intToString n: $Int > $String is #"String(n)";
floatToString n: $Float > $String is #"String(n)";
boolToString b: $Bool > $String is #"String(b)";
stringToInt s: $String > $Int is #"parseInt(s, 10)";
stringToFloat s: $String > $Float is #"parseFloat(s)";

add x: $Int y: $Int > $Int is #"x + y";
sub x: $Int y: $Int > $Int is #"x - y";
mul x: $Int y: $Int > $Int is #"x * y";
div x: $Int y: $Int > $Int is #"x / y";
mod x: $Int y: $Int > $Int is #"x % y";

addF x: $Float y: $Float > $Float is #"x + y";
subF x: $Float y: $Float > $Float is #"x - y";
mulF x: $Float y: $Float > $Float is #"x * y";
divF x: $Float y: $Float > $Float is #"x / y";

eq x: $Int y: $Int > $Bool is #"x === y";
neq x: $Int y: $Int > $Bool is #"x !== y";
lt x: $Int y: $Int > $Bool is #"x < y";
lte x: $Int y: $Int > $Bool is #"x <= y";
gt x: $Int y: $Int > $Bool is #"x > y";
gte x: $Int y: $Int > $Bool is #"x >= y";
isDivisibleBy base: $Int n: $Int > $Bool is #"n % base === 0";

eqS x: $String y: $String > $Bool is #"x === y";
concat x: $String y: $String > $String is #"x + y";
length s: $String > $Int is #"s.length";
substring start: $Int end: $Int s: $String > $String is #"s.substring(start, end)";
contains search: $String s: $String > $Bool is #"s.includes(search)";
replace src: $String to: $String s: $String > $String is #"s.replaceAll(src, to)";
split sep: $String s: $String > $Array<$String> is #"s.split(sep)";

not b: $Bool > $Bool is #"!b";
and x: $Bool y: $Bool > $Bool is #"x && y";
or x: $Bool y: $Bool > $Bool is #"x || y";

abs n: $Number > $Number is #"Math.abs(n)";
floor n: $Number > $Number is #"Math.floor(n)";
ceil n: $Number > $Number is #"Math.ceil(n)";
round n: $Number > $Number is #"Math.round(n)";
sqrt n: $Number > $Number is #"Math.sqrt(n)";
pow base: $Number exp: $Number > $Number is #"Math.pow(base, exp)";
min x: $Number y: $Number > $Number is #"Math.min(x, y)";
max x: $Number y: $Number > $Number is #"Math.max(x, y)";
random > $Float is #"Math.random()";

arrayLength arr: $Array<$Any> > $Int is #"arr.length";
arrayGet idx: $Int arr: $Array<$Any> > $Any is #"arr[idx]";
arrayPush item: $Any arr: $Array<$Any> > $Unit is #"void arr.push(item)";
arraySlice start: $Int end: $Int arr: $Array<$Any> > $Array<$Any> is #"arr.slice(start, end)";

id x: $Any > $Any is #"x";

assertInt i: $Int > $Int is #"i";
assertFloat f: $Float > $Float is #"f";

intToFloat n: $Int > $Float is #"n";
floatToInt n: $Float > $Int is #"Math.trunc(n)";

eqF x: $Float y: $Float > $Bool is #"x === y";
neqF x: $Float y: $Float > $Bool is #"x !== y";
ltF x: $Float y: $Float > $Bool is #"x < y";
lteF x: $Float y: $Float > $Bool is #"x <= y";
gtF x: $Float y: $Float > $Bool is #"x > y";
gteF x: $Float y: $Float > $Bool is #"x >= y";

isNaN n: $Number > $Bool is #"Number.isNaN(n)";
isFinite n: $Number > $Bool is #"Number.isFinite(n)";

trim s: $String > $String is #"s.trim()";
toLowerCase s: $String > $String is #"s.toLowerCase()";
toUpperCase s: $String > $String is #"s.toUpperCase()";
indexOf search: $String s: $String > $Int is #"s.indexOf(search)";
stringRepeat count: $Int s: $String > $String is #"s.repeat(count)";
stringStartsWith prefix: $String s: $String > $Bool is #"s.startsWith(prefix)";
stringEndsWith suffix: $String s: $String > $Bool is #"s.endsWith(suffix)";

sin n: $Number > $Number is #"Math.sin(n)";
cos n: $Number > $Number is #"Math.cos(n)";
tan n: $Number > $Number is #"Math.tan(n)";
logN n: $Number > $Number is #"Math.log(n)";
expN n: $Number > $Number is #"Math.exp(n)";
pi > $Float is #"Math.PI";
e > $Float is #"Math.E";

newArray > $Array<$Any> is #"[]";
arrayJoin sep: $String arr: $Array<$String> > $String is #"arr.join(sep)";
arrayConcat a: $Array<$Any> b: $Array<$Any> > $Array<$Any> is #"a.concat(b)";
arrayReverse arr: $Array<$Any> > $Array<$Any> is #"[...arr].reverse()";
arrayIncludes item: $Any arr: $Array<$Any> > $Bool is #"arr.includes(item)";

newMap > $Map<$Any $Any> is #"new Map()";
mapSet key: $Any val: $Any m: $Map<$Any $Any> > $Unit is #"void m.set(key, val)";
mapGet key: $Any m: $Map<$Any $Any> > $Any is #"m.get(key)";
mapHas key: $Any m: $Map<$Any $Any> > $Bool is #"m.has(key)";
mapDelete key: $Any m: $Map<$Any $Any> > $Bool is #"m.delete(key)";
mapClear m: $Map<$Any $Any> > $Unit is #"void m.clear()";
mapSize m: $Map<$Any $Any> > $Int is #"m.size";

newSet > $Set<$Any> is #"new Set()";
setAdd item: $Any s: $Set<$Any> > $Unit is #"void s.add(item)";
setHas item: $Any s: $Set<$Any> > $Bool is #"s.has(item)";
setDelete item: $Any s: $Set<$Any> > $Bool is #"s.delete(item)";
setClear s: $Set<$Any> > $Unit is #"void s.clear()";
setSize s: $Set<$Any> > $Int is #"s.size";

now > $Float is #"Date.now()";
jsonStringify x: $Any > $String is #"JSON.stringify(x)";

`;

// Initial code example
const initialCode = `fizzBuzzOf n: $Int > $String is
    if (isDivisibleBy 15 n) then "FizzBuzz"
    else if (isDivisibleBy 3 n) then "Fizz"
    else if (isDivisibleBy 5 n) then "Buzz"
    else (intToString n);

fizzBuzzLoop current: $Int max: $Int > $Int is
    if gt current max then 0
    else do {
        print (fizzBuzzOf current);
        fizzBuzzLoop (add current 1) max
    };

main > $Int is fizzBuzzLoop 1 100;
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
  const code = prefix + editor.state.doc.toString()
  outputElement.textContent = 'Compiling and Type Checking...'
  generatedCodeElement.textContent = ''

  switchToTab('output')

  try {
    // 1. Funky -> TypeScript
    const ast = parse(code)
    const tsCode = transpile(ast)
    generatedCodeElement.textContent = tsCode

    // 2. TypeScript -> JavaScript (with type checking)
    // Prepend built-in declarations so TS knows about them
    const lineOffset = BUILTIN_DECLS.split('\n').length - 1;
    const compilation = await checkAndCompile(BUILTIN_DECLS + tsCode, lineOffset)

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
    outputElement.textContent = 'Error:\n' + e.message + "\n@" + ( e.pos - prefix.length);
  }
})

