import * as ts from 'typescript';

const libCache = new Map<string, string>();
const sourceFileCache = new Map<string, ts.SourceFile>();

async function fetchLib(name: string): Promise<string> {
  if (libCache.has(name)) return libCache.get(name)!;

  const url = `https://unpkg.com/typescript@latest/lib/${name}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    libCache.set(name, text);

    // Scan for triple-slash references to load dependencies recursively
    const refRegex = /\/\/\/\s*<reference\s+lib="([^"]+)"\s*\/>/g;
    let match;
    const deps: string[] = [];
    while ((match = refRegex.exec(text)) !== null) {
      deps.push(`lib.${match[1]}.d.ts`);
    }
    await Promise.all(deps.map(fetchLib));

    return text;
  } catch (e) {
    console.error(`Failed to fetch lib ${name}:`, e);
    return '';
  }
}

export interface CompilationResult {
  jsCode: string;
  errors: string[];
}

export async function checkAndCompile(tsCode: string, lineOffset: number = 0): Promise<CompilationResult> {
  const fileName = 'input.ts';

  // Pre-fetch the entry point libs
  await Promise.all(['lib.esnext.d.ts', 'lib.dom.d.ts'].map(fetchLib));

  const outputFiles: Record<string, string> = {};

  const host: ts.CompilerHost = {
    getSourceFile: (name) => {
      if (name === fileName) return ts.createSourceFile(name, tsCode, ts.ScriptTarget.Latest);

      if (sourceFileCache.has(name)) return sourceFileCache.get(name)!;

      if (libCache.has(name)) {
        const sf = ts.createSourceFile(name, libCache.get(name)!, ts.ScriptTarget.Latest);
        sourceFileCache.set(name, sf);
        return sf;
      }
      return undefined;
    },
    writeFile: (name, data) => { outputFiles[name] = data; },
    getDefaultLibFileName: () => 'lib.esnext.d.ts',
    useCaseSensitiveFileNames: () => true,
    getCanonicalFileName: (f) => f,
    getCurrentDirectory: () => '/',
    getNewLine: () => '\n',
    fileExists: (f) => f === fileName || libCache.has(f),
    readFile: (f) => f === fileName ? tsCode : libCache.get(f),
  };

  const program = ts.createProgram([fileName], {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    strict: true,
    alwaysStrict: true,
    noImplicitAny: true,
    lib: ['lib.esnext.d.ts', 'lib.dom.d.ts'],
  }, host);

  const diagnostics = ts.getPreEmitDiagnostics(program);
  const errors = diagnostics.map(d => {
    if (d.file && d.file.fileName === fileName) {
      const { line, character } = ts.getLineAndCharacterOfPosition(d.file, d.start!);
      return `(${line + 1 - lineOffset},${character + 1}): ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`;
    }
    return ts.flattenDiagnosticMessageText(d.messageText, '\n');
  });

  let jsCode = '';
  if (errors.length === 0) {
    program.emit();
    jsCode = outputFiles['input.js'] || '';
  }

  return { jsCode, errors };
}
