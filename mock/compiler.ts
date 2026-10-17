import * as fs from "node:fs";
import * as path from "node:path";
import * as vm from "node:vm";
import * as ts from "typescript";
import { parse } from "./parser.ts";
import { FunkyCompileError, transpile, typecheck } from "./transpile.ts";

export interface HostOptions {
  args?: string[];
  cwd?: string;
  printLine?: (text: string) => void;
  readText?: (file: string) => string;
  writeText?: (file: string, text: string) => void;
  natives?: Record<string, unknown>;
  timeout?: number;
}
export interface Compilation { ast: ReturnType<typeof parse>; typescript: string; javascript: string }

function checkedInt(value: bigint): bigint {
  if (value < -(1n << 63n) || value > (1n << 63n) - 1n) throw new RangeError("Int overflow");
  return value;
}

export function compile(source: string): Compilation {
  const ast = parse(source);
  const typescript = transpile(ast);
  const diagnostics = typecheck(typescript);
  if (diagnostics.length) throw new FunkyCompileError(diagnostics.join("\n"));
  const output = ts.transpileModule(typescript, {
    compilerOptions: { strict: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true,
  });
  const syntaxErrors = output.diagnostics?.filter(x => x.category === ts.DiagnosticCategory.Error) ?? [];
  if (syntaxErrors.length) throw new FunkyCompileError(syntaxErrors.map(x => ts.flattenDiagnosticMessageText(x.messageText, "\n")).join("\n"));
  return { ast, typescript, javascript: output.outputText };
}

function defaultNatives(host: Required<Pick<HostOptions, "cwd" | "printLine" | "readText" | "writeText">>): Record<string, unknown> {
  const binary = (operation: (x: bigint, y: bigint) => bigint) => (x: bigint) => (y: bigint) => checkedInt(operation(x, y));
  return {
    nativeAdd: binary((x, y) => x + y), nativeSub: binary((x, y) => x - y), nativeMul: binary((x, y) => x * y),
    nativeDiv: (x: bigint) => (y: bigint) => { if (!y) throw new RangeError("division by zero"); return checkedInt(x / y); },
    stdPrintLine: (text: string) => { host.printLine(text); return undefined; },
    stdReadText: (file: string) => { try { return { tag: "Ok", value: host.readText(file) }; } catch (e) { return { tag: "Err", value: { message: String(e) } }; } },
    stdWriteText: (file: string) => (text: string) => { try { host.writeText(file, text); return { tag: "Ok", value: undefined }; } catch (e) { return { tag: "Err", value: { message: String(e) } }; } },
  };
}

export function run(source: string, options: HostOptions = {}): unknown {
  const compiled = compile(source);
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const printLine = options.printLine ?? ((text: string) => console.log(text));
  const readText = options.readText ?? ((file: string) => fs.readFileSync(path.resolve(cwd, file), "utf8"));
  const writeText = options.writeText ?? ((file: string, text: string) => fs.writeFileSync(path.resolve(cwd, file), text, "utf8"));
  const host = { args: options.args ?? [], cwd, printLine, readText, writeText, natives: {} as Record<string, unknown> };
  host.natives = { ...defaultNatives(host), ...options.natives };
  const context = vm.createContext({ __host: host, console, BigInt, Object, Array, String, Number, JSON, Math, Symbol, Error, RangeError, TypeError, Map, Set });
  vm.runInContext(compiled.javascript, context, { timeout: options.timeout ?? 5000 });
  if (typeof (context as any).__funkyMain !== "function") throw new FunkyCompileError("program must define a zero-parameter main value");
  return vm.runInContext("globalThis.__funkyMain()", context, { timeout: options.timeout ?? 5000 });
}

export function transpileSource(source: string): string { return compile(source).typescript; }
