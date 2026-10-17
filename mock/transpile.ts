import * as ts from "typescript";
import type {
  DoStatement, Expr, FunctionDecl, InstanceDecl, MatchArm, Pattern, Program,
  ProtocolDecl, TopLevel, TypeDecl, TypeNode, TypeParameter,
} from "./ast.ts";

export class FunkyCompileError extends Error {
  constructor(message: string) { super(message); this.name = "FunkyCompileError"; }
}

type Ty =
  | { kind: "var"; id: string; label: string }
  | { kind: "name"; name: string; args: Ty[] }
  | { kind: "fn"; from: Ty; to: Ty; effect: boolean };
type Subst = Map<string, Ty>;
type FnInfo = { name: string; typeParams: TypeParameter[]; params: { name: string; type: TypeNode }[]; returnType: TypeNode; effect: boolean; decl?: FunctionDecl; native?: string };
type VariantInfo = { name: string; owner: string; ownerParams: string[]; payload: TypeNode; unit: boolean };
type RecordInfo = { decl: TypeDecl; definition: Extract<TypeNode,{kind:"record"}>; sourceParams: string[]; targetArgs: TypeNode[] };
type InstanceInfo = { decl: InstanceDecl; index: number; id: string };
type Context = {
  values: Map<string, Ty>;
  emitted: Map<string, string>;
  vars: Map<string, Ty>;
  dictionaries: Map<string, Map<string, string>>;
  methods: Map<string, { protocol: string; dictionary: string; self: Ty }[]>;
  selfInstances: Map<string, string>;
};

const n = (name: string, ...args: Ty[]): Ty => ({ kind: "name", name, args });
const v = (name: string): TypeNode => ({ kind: "name", name, args: [] });
const fn = (from: Ty, to: Ty, effect = false): Ty => ({ kind: "fn", from, to, effect });
let nextVar = 0;
const fresh = (label = "T"): Ty => ({ kind: "var", id: `v${nextVar++}`, label });
const key = (protocol: string, type: Ty): string => `${protocol}|${tyKey(type)}`;
const tyKey = (type: Ty): string => type.kind === "var" ? `?${type.id}` : type.kind === "fn" ? `(${tyKey(type.from)}>${type.effect ? "!" : ""}${tyKey(type.to)})` : `${type.name}${type.args.length ? `<${type.args.map(tyKey).join(",")}>` : ""}`;
const id = (name: string): string => `__f_${name.replace(/[^A-Za-z0-9_$]/g, "_")}`;
const typeId = (name: string): string => name.replace(/[^A-Za-z0-9_$]/g, "_");
const deepFreeze = "Object.freeze";

const builtinTypes = new Set(["Int", "Float", "Bool", "String", "Unit", "Never"]);
const reservedTypes = new Set(["Option", "Result", "List", "IoError", "Json", "JsonEntry", "JsonError", "Eq"]);
const typeScriptBuiltin: Record<string, string> = { Int: "bigint", Float: "number", Bool: "boolean", String: "string", Unit: "undefined", Never: "never" };

function apply(type: Ty, subst: Subst, seen = new Set<string>()): Ty {
  if (type.kind === "var") {
    const found = subst.get(type.id);
    if (!found || seen.has(type.id)) return type;
    seen.add(type.id);
    return apply(found, subst, seen);
  }
  if (type.kind === "name") return { ...type, args: type.args.map(x => apply(x, subst)) };
  return { ...type, from: apply(type.from, subst), to: apply(type.to, subst) };
}
function occurs(id: string, type: Ty, subst: Subst): boolean {
  const t = apply(type, subst);
  return t.kind === "var" ? t.id === id : t.kind === "fn" ? occurs(id, t.from, subst) || occurs(id, t.to, subst) : t.args.some(x => occurs(id, x, subst));
}
function unify(a0: Ty, b0: Ty, subst: Subst): void {
  const a = apply(a0, subst), b = apply(b0, subst);
  if (a.kind === "var") {
    if (b.kind === "var" && a.id === b.id) return;
    if (occurs(a.id, b, subst)) throw new FunkyCompileError(`infinite type: ${a.label} occurs in ${tyKey(b)}`);
    subst.set(a.id, b); return;
  }
  if (b.kind === "var") { unify(b, a, subst); return; }
  if (a.kind === "name" && a.name === "Never" && a.args.length === 0) return;
  if (b.kind === "name" && b.name === "Never" && b.args.length === 0) return;
  if (a.kind !== b.kind) throw new FunkyCompileError(`type mismatch: ${tyKey(a)} and ${tyKey(b)}`);
  if (a.kind === "name" && b.kind === "name") {
    if (a.name !== b.name || a.args.length !== b.args.length) throw new FunkyCompileError(`type mismatch: ${tyKey(a)} and ${tyKey(b)}`);
    a.args.forEach((x, i) => unify(x, b.args[i], subst)); return;
  }
  if (a.kind === "fn" && b.kind === "fn") {
    if (a.effect !== b.effect) throw new FunkyCompileError(`effect mismatch: ${tyKey(a)} and ${tyKey(b)}`);
    unify(a.from, b.from, subst); unify(a.to, b.to, subst); return;
  }
}
function formatType(node: TypeNode, vars = new Map<string, string>(), self = "Self"): string {
  if (node.kind === "name") {
    if (node.name === "Self") return self;
    const mapped = vars.get(node.name);
    if (mapped) return mapped;
    const primitive = typeScriptBuiltin[node.name];
    if (primitive) return primitive;
    const name = typeId(node.name);
    if (node.name === "List") return `ReadonlyArray<${node.args[0] ? formatType(node.args[0], vars, self) : "unknown"}>`;
    return `${name}${node.args.length ? `<${node.args.map(x => formatType(x, vars, self)).join(", ")}>` : ""}`;
  }
  if (node.kind === "function") return `(arg: ${formatType(node.from, vars, self)}) => ${formatType(node.to, vars, self)}`;
  throw new FunkyCompileError("inline record/enum type is not valid here");
}
function typeFromTy(type: Ty, vars = new Map<string, string>()): string {
  if (type.kind === "var") return vars.get(type.id) ?? typeId(type.label);
  if (type.kind === "name") {
    const primitive = typeScriptBuiltin[type.name];
    if (primitive) return primitive;
    if (type.name === "List") return `ReadonlyArray<${type.args[0] ? typeFromTy(type.args[0], vars) : "unknown"}>`;
    return `${typeId(type.name)}${type.args.length ? `<${type.args.map(x => typeFromTy(x, vars)).join(", ")}>` : ""}`;
  }
  return `(arg: ${typeFromTy(type.from, vars)}) => ${typeFromTy(type.to, vars)}`;
}
function flatten(expr: Expr): { head: Expr; args: Expr[] } {
  const args: Expr[] = [];
  let head = expr;
  while (head.kind === "call") { args.unshift(head.arg); head = head.callee; }
  return { head, args };
}
function quote(value: string): string { return JSON.stringify(value); }
function intCode(raw: string): string {
  const value = BigInt(raw.replaceAll("_", ""));
  if (value < -(1n << 63n) || value > (1n << 63n) - 1n) throw new FunkyCompileError(`Int literal is outside the signed 64-bit range: ${raw}`);
  return `${value}n`;
}
function floatCode(raw: string): string {
  const value = Number(raw.replaceAll("_", ""));
  if (!Number.isFinite(value)) throw new FunkyCompileError(`Float literal is outside the finite binary64 range: ${raw}`);
  return Object.is(value, -0) ? "-0" : String(value);
}
function literalCode(value: string | boolean | null, kind: string): string {
  if (kind === "unit") return "undefined";
  if (kind === "int") return intCode(String(value));
  if (kind === "float") return floatCode(String(value));
  return typeof value === "string" ? quote(value) : String(value);
}

function typeParamNode(name: string): TypeNode { return { kind: "name", name, args: [] }; }
const tparam = (name: string, constraints: string[] = []): TypeParameter => ({ name, constraints });
const p = (name: string, type: TypeNode) => ({ name, type });
const listOf = (x: TypeNode): TypeNode => ({ kind: "name", name: "List", args: [x] });
const genericType = (name: string, ...args: TypeNode[]): TypeNode => ({ kind: "name", name, args });
const effectType = (from: TypeNode, to: TypeNode): TypeNode => ({ kind: "function", from, to, effect: true });
const pureType = (from: TypeNode, to: TypeNode): TypeNode => ({ kind: "function", from, to, effect: false });
const curried = (params: TypeNode[], result: TypeNode, effect = false): TypeNode => params.reduceRight((to, from, i) => ({ kind: "function", from, to, effect: effect && i === params.length - 1 }), result);
const strT = v("String"), intT = v("Int"), floatT = v("Float"), boolT = v("Bool"), unitT = v("Unit");
const tvA = typeParamNode("A"), tvB = typeParamNode("B");

const builtinFunctions: FnInfo[] = [
  { name: "add", typeParams: [], params: [p("x", intT), p("y", intT)], returnType: intT, effect: false, native: "add" },
  { name: "sub", typeParams: [], params: [p("x", intT), p("y", intT)], returnType: intT, effect: false, native: "sub" },
  { name: "mul", typeParams: [], params: [p("x", intT), p("y", intT)], returnType: intT, effect: false, native: "mul" },
  { name: "div", typeParams: [], params: [p("x", intT), p("y", intT)], returnType: intT, effect: false, native: "div" },
  { name: "mod_", typeParams: [], params: [p("x", intT), p("y", intT)], returnType: intT, effect: false, native: "mod_" },
  ...[["lt", "Int"], ["le", "Int"], ["gt", "Int"], ["ge", "Int"]].map(([name]) => ({ name, typeParams: [], params: [p("x", intT), p("y", intT)], returnType: boolT, effect: false, native: name })),
  { name: "eq", typeParams: [tparam("T", ["Eq"])], params: [p("x", typeParamNode("T")), p("y", typeParamNode("T"))], returnType: boolT, effect: false, native: "eq" },
  { name: "ne", typeParams: [tparam("T", ["Eq"])], params: [p("x", typeParamNode("T")), p("y", typeParamNode("T"))], returnType: boolT, effect: false, native: "ne" },
  ...[["addF", "Float", "Float"], ["subF", "Float", "Float"], ["mulF", "Float", "Float"], ["divF", "Float", "Float"], ["ltF", "Float", "Bool"], ["leF", "Float", "Bool"], ["gtF", "Float", "Bool"], ["geF", "Float", "Bool"]].map(([name, arg, result]) => ({ name, typeParams: [], params: [p("x", v(arg)), p("y", v(arg))], returnType: v(result), effect: false, native: name })),
  { name: "and", typeParams: [], params: [p("x", boolT), p("y", boolT)], returnType: boolT, effect: false, native: "and" },
  { name: "or", typeParams: [], params: [p("x", boolT), p("y", boolT)], returnType: boolT, effect: false, native: "or" },
  { name: "not", typeParams: [], params: [p("x", boolT)], returnType: boolT, effect: false, native: "not" },
  { name: "concat", typeParams: [], params: [p("x", strT), p("y", strT)], returnType: strT, effect: false, native: "concat" },
  { name: "stringLength", typeParams: [], params: [p("text", strT)], returnType: intT, effect: false, native: "stringLength" },
  { name: "intToString", typeParams: [], params: [p("n", intT)], returnType: strT, effect: false, native: "intToString" },
  { name: "floatToString", typeParams: [], params: [p("n", floatT)], returnType: strT, effect: false, native: "floatToString" },
  { name: "trim", typeParams: [], params: [p("text", strT)], returnType: strT, effect: false, native: "trim" },
  { name: "split", typeParams: [], params: [p("separator", strT), p("text", strT)], returnType: listOf(strT), effect: false, native: "split" },
  { name: "join", typeParams: [], params: [p("separator", strT), p("parts", listOf(strT))], returnType: strT, effect: false, native: "join" },
  { name: "length", typeParams: [tparam("T")], params: [p("values", listOf(typeParamNode("T")))], returnType: intT, effect: false, native: "length" },
  { name: "map", typeParams: [tparam("A"), tparam("B")], params: [p("transform", pureType(tvA, tvB)), p("values", listOf(tvA))], returnType: listOf(tvB), effect: false, native: "map" },
  { name: "filter", typeParams: [tparam("T")], params: [p("predicate", pureType(typeParamNode("T"), boolT)), p("values", listOf(typeParamNode("T")))], returnType: listOf(typeParamNode("T")), effect: false, native: "filter" },
  { name: "foldLeft", typeParams: [tparam("A"), tparam("B")], params: [p("step", pureType(tvB, pureType(tvA, tvB))), p("initial", tvB), p("values", listOf(tvA))], returnType: tvB, effect: false, native: "foldLeft" },
  { name: "at", typeParams: [tparam("T")], params: [p("index", intT), p("values", listOf(typeParamNode("T")))], returnType: genericType("Option", typeParamNode("T")), effect: false, native: "at" },
  { name: "range", typeParams: [], params: [p("start", intT), p("end", intT)], returnType: listOf(intT), effect: false, native: "range" },
  { name: "printLine", typeParams: [], params: [p("text", strT)], returnType: unitT, effect: true, native: "printLine" },
  { name: "readText", typeParams: [], params: [p("path", strT)], returnType: genericType("Result", strT, v("IoError")), effect: true, native: "readText" },
  { name: "writeText", typeParams: [], params: [p("path", strT), p("content", strT)], returnType: genericType("Result", unitT, v("IoError")), effect: true, native: "writeText" },
  { name: "ioErrorMessage", typeParams: [], params: [p("error", v("IoError"))], returnType: strT, effect: false, native: "ioErrorMessage" },
  { name: "arguments", typeParams: [], params: [], returnType: listOf(strT), effect: true, native: "arguments" },
  { name: "parseJson", typeParams: [], params: [p("text", strT)], returnType: genericType("Result", v("Json"), v("JsonError")), effect: false, native: "parseJson" },
  { name: "stringify", typeParams: [], params: [p("value", v("Json"))], returnType: strT, effect: false, native: "stringify" },
  { name: "jsonField", typeParams: [], params: [p("key", strT), p("object", v("Json"))], returnType: genericType("Option", v("Json")), effect: false, native: "jsonField" },
];

const stdExports: Record<string, Set<string>> = {
  "std/io": new Set(["IoError", "arguments", "printLine", "readText", "writeText", "ioErrorMessage"]),
  "std/text": new Set(["concat", "stringLength", "intToString", "floatToString", "trim", "split", "join"]),
  "std/list": new Set(["length", "map", "filter", "foldLeft", "at", "range"]),
  "std/json": new Set(["Json", "JsonEntry", "JsonError", "parseJson", "stringify", "jsonField", "Null", "Boolean", "Number", "Text", "Array", "Object"]),
};
const stdFunctionModule = new Map<string, string>([
  ...["arguments", "printLine", "readText", "writeText", "ioErrorMessage"].map(x => [x, "std/io"] as [string, string]),
  ...["concat", "stringLength", "intToString", "floatToString", "trim", "split", "join"].map(x => [x, "std/text"] as [string, string]),
  ...["length", "map", "filter", "foldLeft", "at", "range"].map(x => [x, "std/list"] as [string, string]),
  ...["parseJson", "stringify", "jsonField"].map(x => [x, "std/json"] as [string, string]),
]);
const preludeFunctions = new Set(["add", "sub", "mul", "div", "mod_", "lt", "le", "gt", "ge", "eq", "ne", "addF", "subF", "mulF", "divF", "ltF", "leF", "gtF", "geF", "and", "or", "not"]);
const effectfulNatives = new Set(["stdPrintLine", "stdReadText", "stdWriteText", "stdArguments"]);

class Transpiler {
  private readonly types = new Map<string, TypeDecl>();
  private readonly protocols = new Map<string, ProtocolDecl>();
  private readonly functions = new Map<string, FnInfo>();
  private readonly aliases = new Map<string, string>();
  private readonly variants = new Map<string, VariantInfo>();
  private readonly instances: InstanceInfo[] = [];
  private readonly methodOwners = new Map<string, string[]>();
  private readonly lines: string[] = [];
  private readonly importedNames = new Set<string>();
  private readonly program: Program;

  constructor(program: Program) {
    this.program = program;
    this.collect();
  }

  private canonicalName(name: string): string {
    let current = name;
    const seen = new Set<string>();
    while (this.aliases.has(current) && !seen.has(current)) {
      seen.add(current);
      current = this.aliases.get(current)!;
    }
    return current;
  }

  private typeOf(node: TypeNode, vars = new Map<string, Ty>()): Ty {
    if (node.kind === "name") {
      if (vars.has(node.name)) return vars.get(node.name)!;
      const name = this.canonicalName(node.name);
      return n(name, ...node.args.map(x => this.typeOf(x, vars)));
    }
    if (node.kind === "function") return fn(this.typeOf(node.from, vars), this.typeOf(node.to, vars), node.effect);
    throw new FunkyCompileError("inline record/enum types are only valid in type declarations");
  }

  private normalizeType(node: TypeNode, bound = new Set<string>()): TypeNode {
    if (node.kind === "name") {
      return { ...node, name: bound.has(node.name) ? node.name : this.canonicalName(node.name), args: node.args.map(x => this.normalizeType(x, bound)) };
    }
    if (node.kind === "function") return { ...node, from: this.normalizeType(node.from, bound), to: this.normalizeType(node.to, bound) };
    if (node.kind === "record") return { ...node, fields: node.fields.map(x => ({ ...x, type: this.normalizeType(x.type, bound) })) };
    return { ...node, variants: node.variants.map(x => ({ ...x, type: this.normalizeType(x.type, bound) })) };
  }

  private typeText(node: TypeNode, vars = new Map<string, string>(), self = "Self"): string {
    return formatType(this.normalizeType(node, new Set(vars.keys())), vars, self);
  }

  private variantInfo(name: string): VariantInfo | undefined { return this.variants.get(this.canonicalName(name)); }

  private requireFunctionVisible(localName: string, canonical: string): void {
    const declaredHere = this.program.body.some(x => x.kind === "function" && x.name === canonical);
    if (declaredHere || preludeFunctions.has(canonical)) return;
    const module = stdFunctionModule.get(canonical);
    if (module && this.importedNames.has(localName)) return;
    if (module) throw new FunkyCompileError(`${localName} must be imported from ${module}`);
  }

  private requireVariantVisible(localName: string, variant: VariantInfo): void {
    if (variant.owner !== "Json" || this.importedNames.has(localName)) return;
    throw new FunkyCompileError(`${localName} must be imported from std/json`);
  }

  run(): string {
    this.validate();
    this.emitRuntime();
    for (const decl of this.program.body) if (decl.kind === "type") this.emitType(decl);
    for (const decl of this.program.body) if (decl.kind === "protocol") this.emitProtocol(decl);
    for (const decl of this.program.body) if (decl.kind === "type" && decl.definition.kind === "record") this.emitRecordFactory(decl);
    this.emitVariantConstructors();
    for (const instance of this.instances) this.emitInstance(instance);
    for (const decl of this.program.body) if (decl.kind === "function") this.emitFunction(decl);
    if (this.program.body.some(x => x.kind === "function" && x.name === "main")) this.lines.push(`(globalThis as any).__funkyMain = ${id("main")};`);
    this.lines.push(`(globalThis as any).__funkyExports = { ${this.program.body.filter((x): x is FunctionDecl => x.kind === "function").map(x => `${quote(x.name)}: ${id(x.name)}`).join(", ")} };`);
    return this.lines.join("\n");
  }

  private collect(): void {
    for (const d of this.program.body) {
      if (d.kind === "using") {
        const exports = stdExports[d.from];
        if (!exports) throw new FunkyCompileError(`external using is not supported yet: ${d.from}`);
        for (const item of d.imports) {
          if (!exports.has(item.name)) throw new FunkyCompileError(`${item.name} is not exported by ${d.from}`);
          const local = item.alias ?? item.name;
          if (this.aliases.has(local)) throw new FunkyCompileError(`duplicate import name: ${local}`);
          this.aliases.set(local, item.name);
          this.importedNames.add(local);
        }
      } else if (d.kind === "type") {
        if (this.types.has(d.name) || builtinTypes.has(d.name) || reservedTypes.has(d.name)) throw new FunkyCompileError(`type already defined: $${d.name}`);
        this.types.set(d.name, d);
      } else if (d.kind === "protocol") {
        if (this.protocols.has(d.name) || d.name === "Eq") throw new FunkyCompileError(`protocol already defined: ^${d.name}`);
        this.protocols.set(d.name, d);
      } else if (d.kind === "function") {
        if (this.functions.has(d.name)) throw new FunkyCompileError(`function already defined: ${d.name}`);
        this.functions.set(d.name, { ...d, decl: d });
      } else if (d.kind === "instance") {
        this.instances.push({ decl: d, index: this.instances.length, id: `__instance_${this.instances.length}` });
      }
    }
    const declaredNames = new Set(this.program.body.flatMap(x => x.kind === "function" || x.kind === "type" || x.kind === "protocol" ? [x.name] : []));
    for (const local of this.importedNames) if (declaredNames.has(local)) throw new FunkyCompileError(`import name conflicts with a local declaration: ${local}`);
    for (const info of builtinFunctions) if (!this.functions.has(info.name)) this.functions.set(info.name, info);
    for (const d of this.program.body) {
      if (d.kind === "type" && d.definition.kind === "enum") {
        for (const variant of d.definition.variants) this.addVariant(variant.name, { name: variant.name, owner: d.name, ownerParams: d.params, payload: variant.type, unit: variant.type.kind === "name" && variant.type.name === "Unit" });
      }
    }
    this.addVariant("Some", { name: "Some", owner: "Option", ownerParams: ["T"], payload: typeParamNode("T"), unit: false });
    this.addVariant("None", { name: "None", owner: "Option", ownerParams: ["T"], payload: unitT, unit: true });
    this.addVariant("Ok", { name: "Ok", owner: "Result", ownerParams: ["Ok", "Err"], payload: typeParamNode("Ok"), unit: false });
    this.addVariant("Err", { name: "Err", owner: "Result", ownerParams: ["Ok", "Err"], payload: typeParamNode("Err"), unit: false });
    for (const [name, payload] of [["Null", unitT], ["Boolean", boolT], ["Number", floatT], ["Text", strT], ["Array", listOf(v("Json"))], ["Object", listOf(v("JsonEntry"))]] as [string, TypeNode][]) {
      this.addVariant(name, { name, owner: "Json", ownerParams: [], payload, unit: payload.kind === "name" && payload.name === "Unit" });
    }
    this.protocols.set("Eq", { kind: "protocol", name: "Eq", body: { kind: "methods", methods: [{ name: "equal", type: curried([typeParamNode("Self"), typeParamNode("Self")], boolT) }] } });
    for (const protocol of this.protocols.values()) for (const method of this.protocolMethods(protocol.name)) {
      const owners = this.methodOwners.get(method.name) ?? [];
      if (!owners.includes(protocol.name)) owners.push(protocol.name);
      this.methodOwners.set(method.name, owners);
    }
  }

  private addVariant(name: string, info: VariantInfo): void {
    if (this.variants.has(name)) throw new FunkyCompileError(`enum variant already defined: ${name}`);
    this.variants.set(name, info);
  }

  private validateProtocols(): void {
    for (const protocol of this.protocols.values()) {
      if (protocol.body.kind === "composition") {
        for (const name of protocol.body.names) if (!this.protocols.has(name)) throw new FunkyCompileError(`unknown protocol ^${name} in ^${protocol.name}`);
      } else {
        const methods = new Set<string>();
        for (const method of protocol.body.methods) {
          if (methods.has(method.name)) throw new FunkyCompileError(`duplicate method ${method.name} in ^${protocol.name}`);
          methods.add(method.name);
          if (method.type.kind !== "function" || method.type.from.kind !== "name" || method.type.from.name !== "Self") throw new FunkyCompileError(`the first parameter of ^${protocol.name}.${method.name} must be $Self`);
        }
      }
    }
    const visit = (name: string, path: Set<string>): void => {
      if (path.has(name)) throw new FunkyCompileError(`cyclic protocol composition involving ^${name}`);
      const protocol = this.protocols.get(name);
      if (!protocol || protocol.body.kind !== "composition") return;
      const next = new Set(path); next.add(name);
      for (const child of protocol.body.names) visit(child, next);
    };
    for (const name of this.protocols.keys()) visit(name, new Set());
  }

  private validateTypeParameters(params: TypeParameter[], owner: string): void {
    const names = new Set<string>();
    for (const parameter of params) {
      if (names.has(parameter.name)) throw new FunkyCompileError(`duplicate type parameter $${parameter.name} in ${owner}`);
      names.add(parameter.name);
      const constraints = new Set<string>();
      for (const protocol of parameter.constraints) {
        if (!this.protocols.has(protocol)) throw new FunkyCompileError(`unknown protocol ^${protocol} in ${owner}`);
        if (constraints.has(protocol)) throw new FunkyCompileError(`duplicate constraint ^${protocol} on $${parameter.name}`);
        constraints.add(protocol);
      }
    }
  }

  private validate(): void {
    this.validateProtocols();
    const entry = this.program.body.find((x): x is FunctionDecl => x.kind === "function" && x.name === "main");
    if (entry) {
      if (entry.params.length || entry.typeParams.length) throw new FunkyCompileError("main must be a zero-parameter non-generic value");
      const result = this.canonicalTy(this.typeOf(entry.returnType));
      if (result.kind !== "name" || !["Int", "Unit"].includes(result.name)) throw new FunkyCompileError("main must return $Unit or $Int");
    }
    for (const decl of this.program.body) {
      if (decl.kind === "type") {
        if (new Set(decl.params).size !== decl.params.length) throw new FunkyCompileError(`duplicate type parameter in $${decl.name}`);
      } else if (decl.kind === "function") {
        this.validateTypeParameters(decl.typeParams, `function ${decl.name}`);
        const params = decl.params.map(x => x.name);
        if (new Set(params).size !== params.length) throw new FunkyCompileError(`duplicate parameter in function ${decl.name}`);
      } else if (decl.kind === "instance") {
        this.validateTypeParameters(decl.params, `instance ^${decl.protocol}`);
        for (const parameter of decl.params) if (!this.containsTypeVar(decl.target, parameter.name)) throw new FunkyCompileError(`instance type parameter $${parameter.name} is not used by its target`);
        const methodNames = decl.methods.map(x => x.name);
        if (new Set(methodNames).size !== methodNames.length) throw new FunkyCompileError(`duplicate method implementation in instance ^${decl.protocol}`);
        for (const method of decl.methods) if (new Set(method.params).size !== method.params.length) throw new FunkyCompileError(`duplicate parameter in instance method ${method.name}`);
      }
    }
    for (const decl of this.program.body) {
      if (decl.kind === "function") {
        if (decl.body.kind === "native") {
          if (!decl.effect && effectfulNatives.has(decl.body.name)) throw new FunkyCompileError(`native ${decl.body.name} is effectful; ${decl.name} must use >!`);
        } else {
          const effect = this.hasEffect(decl.body, this.functionContext(decl));
          if (!decl.effect && effect) throw new FunkyCompileError(`pure function ${decl.name} calls an effectful expression; declare it with >!`);
        }
      }
      if (decl.kind === "instance") this.validateInstance(decl);
    }
    const seen = new Set<string>();
    for (const instance of this.instances) {
      const target = this.canonicalTy(this.typeOf(instance.decl.target, this.instanceTypeVars(instance.decl)));
      const key = `${instance.decl.protocol}|${tyKey(target)}`;
      if (seen.has(key)) throw new FunkyCompileError(`duplicate instance for ^${instance.decl.protocol} and ${tyKey(target)}`);
      seen.add(key);
      const targetOwner = target.kind === "name" && this.types.has(target.name);
      const protocolOwner = this.program.body.some(x => x.kind === "protocol" && x.name === instance.decl.protocol);
      if (!targetOwner && !protocolOwner) throw new FunkyCompileError(`orphan instance: define ^${instance.decl.protocol} or its target type in this module`);
    }
  }

  private validateInstance(decl: InstanceDecl): void {
    if (!this.protocols.has(decl.protocol)) throw new FunkyCompileError(`unknown protocol ^${decl.protocol}`);
    const expected = this.protocolMethods(decl.protocol);
    const actual = new Map(decl.methods.map(m => [m.name, m]));
    for (const method of expected) {
      const implementation = actual.get(method.name);
      if (!implementation) throw new FunkyCompileError(`instance ^${decl.protocol} is missing method ${method.name}`);
      const arity = this.functionArity(method.type);
      if (implementation.params.length !== arity) throw new FunkyCompileError(`${method.name} expects ${arity} parameter(s), got ${implementation.params.length}`);
      actual.delete(method.name);
    }
    if (actual.size) throw new FunkyCompileError(`unknown instance method(s): ${[...actual.keys()].join(", ")}`);
    const vars = this.instanceTypeVars(decl);
    const target = this.canonicalTy(this.typeOf(decl.target, vars));
    for (const method of decl.methods) {
      const signature = expected.find(x => x.name === method.name)!;
      const params = this.functionParams(signature.type).map(x => this.replaceSelf(this.typeOf(x, new Map([["Self", target]])), target));
      const env = new Map<string, Ty>();
      method.params.forEach((name, i) => env.set(name, params[i]));
      const context = this.baseContext(env, new Map(), vars);
      for (const tp of decl.params) for (const protocol of tp.constraints) {
        const type = vars.get(tp.name)!;
        const dict = `__dict_${protocol}_${tp.name}`;
        this.addDictionary(context, type, protocol, dict);
      }
      const selfKey = key(decl.protocol, target);
      context.selfInstances.set(selfKey, `__instance_${this.instances.find(x => x.decl === decl)?.index ?? 0}`);
      const inferred = this.infer(method.body, context);
      const resultType = this.functionResult(signature.type);
      try { this.unify(inferred, this.replaceSelf(this.typeOf(resultType, new Map([["Self", target]])), target), new Map()); }
      catch (e) { throw new FunkyCompileError(`invalid body for ${method.name}: ${(e as Error).message}`); }
      if (!this.functionEffect(signature.type) && this.hasEffect(method.body, context)) throw new FunkyCompileError(`pure protocol method ${method.name} calls an effectful expression`);
    }
  }

  private hasEffect(expr: Expr, context: Context): boolean {
    if (expr.kind === "name") {
      if (context.values.has(expr.name)) return false;
      const info = this.functions.get(this.canonicalName(expr.name));
      return !!info?.effect && info.params.length === 0;
    }
    if (expr.kind === "lambda") {
      if (!expr.effect) {
        const nested = this.lambdaContext(expr, context);
        if (this.hasEffect(expr.body, nested)) throw new FunkyCompileError("pure lambda calls an effectful expression; use >!");
      }
      return false;
    }
    if (expr.kind === "call") {
      const { head, args } = flatten(expr);
      const children = args.some(x => this.hasEffect(x, context)) || (head.kind !== "name" && this.hasEffect(head, context));
      return children || this.callEffect(head, args, context);
    }
    if (expr.kind === "if") return this.hasEffect(expr.condition, context) || this.hasEffect(expr.then, context) || this.hasEffect(expr.else, context);
    if (expr.kind === "match") {
      if (this.hasEffect(expr.value, context)) return true;
      const valueType = this.infer(expr.value, context);
      return expr.arms.some(arm => this.hasEffect(arm.body, this.patternContext(arm.pattern, valueType, context)));
    }
    if (expr.kind === "for") {
      const values = this.infer(expr.values, context);
      const item = values.kind === "name" && values.name === "List" ? values.args[0] : fresh("Item");
      const nested = this.cloneContext(context); nested.values.set(expr.name, item); nested.emitted.set(expr.name, id(expr.name));
      return this.hasEffect(expr.values, context) || this.hasEffect(expr.body, nested);
    }
    if (expr.kind === "do") {
      const nested = this.cloneContext(context);
      const whereTypes = new Map<string, Ty>();
      for (const binding of expr.where) {
        if (whereTypes.has(binding.name)) throw new FunkyCompileError(`duplicate where binding ${binding.name}`);
        const type = binding.type ? this.typeOf(binding.type, nested.vars) : fresh(binding.name);
        whereTypes.set(binding.name, type);
        nested.values.set(binding.name, type); nested.emitted.set(binding.name, `__where_${typeId(binding.name)}()`);
      }
      const groupSubst: Subst = new Map();
      for (const binding of expr.where) this.unify(whereTypes.get(binding.name)!, this.infer(binding.value, nested), groupSubst);
      for (const [name, type] of whereTypes) nested.values.set(name, apply(type, groupSubst));
      for (const binding of expr.where) if (this.hasEffect(binding.value, nested)) throw new FunkyCompileError(`where binding ${binding.name} must be pure`);
      let effect = false;
      for (const statement of expr.statements) {
        if (this.hasEffect(statement.value, nested)) effect = true;
        if (statement.kind === "bind") {
          const value = this.infer(statement.value, nested);
          const type = statement.type ? this.typeOf(statement.type, nested.vars) : value;
          this.unify(type, value, new Map());
          nested.values.set(statement.name, type); nested.emitted.set(statement.name, id(statement.name));
        }
      }
      return effect || this.hasEffect(expr.final, nested);
    }
    if (expr.kind === "record") return expr.fields.some(x => this.hasEffect(x.value, context));
    if (expr.kind === "list") return expr.items.some(x => this.hasEffect(x, context));
    if (expr.kind === "field") return this.hasEffect(expr.object, context);
    if (expr.kind === "variant") return !!expr.payload && this.hasEffect(expr.payload, context);
    return false;
  }

  private callEffect(head: Expr, args: Expr[], context: Context): boolean {
    let type: Ty;
    try {
      const name = head.kind === "name" ? this.canonicalName(head.name) : "";
      type = head.kind === "name" && !context.values.has(head.name) && !this.functions.has(name) && this.methodOwners.has(name)
        ? this.methodType(name, args, context)
        : this.infer(head, context);
    } catch { return false; }
    const subst: Subst = new Map();
    let effect = false;
    for (const _arg of args) {
      type = apply(type, subst);
      if (type.kind !== "fn") return effect;
      if (type.effect) effect = true;
      type = type.to;
    }
    return effect;
  }

  private baseContext(values = new Map<string, Ty>(), emitted = new Map<string, string>(), vars = new Map<string, Ty>()): Context {
    return { values, emitted, vars, dictionaries: new Map(), methods: new Map(), selfInstances: new Map() };
  }
  private functionContext(decl: FunctionDecl): Context {
    const vars = new Map<string, Ty>();
    for (const tp of decl.typeParams) vars.set(tp.name, fresh(tp.name));
    const values = new Map<string, Ty>();
    const emitted = new Map<string, string>();
    decl.params.forEach(param => { values.set(param.name, this.typeOf(param.type, vars)); emitted.set(param.name, id(param.name)); });
    const context = this.baseContext(values, emitted, vars);
    for (const tp of decl.typeParams) for (const protocol of tp.constraints) {
      const type = vars.get(tp.name)!; const dict = `__dict_${protocol}_${tp.name}`;
      this.addDictionary(context, type, protocol, dict);
    }
    return context;
  }
  private lambdaContext(expr: Extract<Expr, { kind: "lambda" }>, parent: Context): Context {
    this.validateTypeParameters(expr.typeParams, "lambda");
    if (new Set(expr.params.map(x => x.name)).size !== expr.params.length) throw new FunkyCompileError("duplicate lambda parameter");
    const vars = new Map(parent.vars);
    for (const tp of expr.typeParams) vars.set(tp.name, fresh(tp.name));
    const values = new Map(parent.values), emitted = new Map(parent.emitted);
    expr.params.forEach(param => { values.set(param.name, this.typeOf(param.type, vars)); emitted.set(param.name, id(param.name)); });
    const ctx = this.baseContext(values, emitted, vars);
    ctx.dictionaries = new Map([...parent.dictionaries].map(([k, v]) => [k, new Map(v)]));
    ctx.methods = new Map([...parent.methods].map(([k, v]) => [k, [...v]]));
    ctx.selfInstances = new Map(parent.selfInstances);
    for (const tp of expr.typeParams) for (const protocol of tp.constraints) this.addDictionary(ctx, vars.get(tp.name)!, protocol, `__dict_${protocol}_${tp.name}`);
    return ctx;
  }
  private addDictionary(ctx: Context, type: Ty, protocol: string, expr: string): void {
    const resolved = type.kind === "var" ? type.id : tyKey(type);
    const map = ctx.dictionaries.get(resolved) ?? new Map<string, string>();
    map.set(protocol, expr); ctx.dictionaries.set(resolved, map);
    for (const method of this.protocolMethods(protocol)) {
      const list = ctx.methods.get(method.name) ?? [];
      list.push({ protocol, dictionary: expr, self: type }); ctx.methods.set(method.name, list);
    }
  }
  private instanceTypeVars(decl: InstanceDecl): Map<string, Ty> {
    const vars = new Map<string, Ty>();
    for (const p of decl.params) vars.set(p.name, fresh(p.name));
    return vars;
  }

  private infer(expr: Expr, context: Context): Ty {
    switch (expr.kind) {
      case "int": return n("Int");
      case "float": return n("Float");
      case "string": return n("String");
      case "bool": return n("Bool");
      case "unit": return n("Unit");
      case "name": {
        if (context.values.has(expr.name)) return context.values.get(expr.name)!;
        const canonical = this.canonicalName(expr.name);
        const info = this.functions.get(canonical);
        if (info) { this.requireFunctionVisible(expr.name, canonical); return this.signature(info).type; }
        const variant = this.variantInfo(canonical);
        if (variant) { this.requireVariantVisible(expr.name, variant); return this.variantType(variant); }
        return fresh(expr.name);
      }
      case "field": return this.fieldType(this.infer(expr.object, context), expr.name);
      case "call": return this.inferCall(expr, context);
      case "list": {
        const element = fresh("Element"); const subst: Subst = new Map();
        for (const item of expr.items) this.unify(element, this.infer(item, context), subst);
        return n("List", apply(element, subst));
      }
      case "record": {
        const info = this.recordInfo(expr.name);
        if (!info) return n(expr.name);
        const sourceVars = new Map<string, Ty>(); for (const name of info.sourceParams) sourceVars.set(name, fresh(name));
        const targetArgs = info.targetArgs.map(x => this.typeOf(x, sourceVars));
        const vars = new Map<string, Ty>(); info.decl.params.forEach((name, i) => vars.set(name, targetArgs[i] ?? fresh(name)));
        const subst: Subst = new Map();
        for (const field of expr.fields) {
          const def = info.definition.fields.find(x => x.name === field.name);
          if (def) this.unify(this.typeOf(def.type, vars), this.infer(field.value, context), subst);
        }
        return n(info.decl.name, ...info.decl.params.map(name => apply(vars.get(name)!, subst)));
      }
      case "variant": {
        const info = this.variantInfo(expr.name);
        if (!info) return fresh("Enum");
        this.requireVariantVisible(expr.name, info);
        const vars = new Map<string, Ty>(); for (const name of info.ownerParams) vars.set(name, fresh(name));
        const subst: Subst = new Map();
        if (expr.payload) this.unify(this.typeOf(info.payload, vars), this.infer(expr.payload, context), subst);
        return n(info.owner, ...info.ownerParams.map(name => apply(vars.get(name)!, subst)));
      }
      case "if": {
        this.unify(this.infer(expr.condition, context), n("Bool"), new Map());
        const a = this.infer(expr.then, context), b = this.infer(expr.else, context), subst: Subst = new Map(); this.unify(a, b, subst); return apply(a, subst);
      }
      case "lambda": {
        const nested = this.lambdaContext(expr, context);
        let out = this.typeOf(expr.returnType, nested.vars);
        for (let i = expr.params.length - 1; i >= 0; i--) out = fn(this.typeOf(expr.params[i].type, nested.vars), out, expr.effect && i === expr.params.length - 1);
        return out;
      }
      case "match": {
        const valueType = this.infer(expr.value, context);
        this.checkMatch(expr, valueType, context);
        const results: Ty[] = [];
        for (const arm of expr.arms) { const armCtx = this.patternContext(arm.pattern, valueType, context); results.push(this.infer(arm.body, armCtx)); }
        const first = results[0] ?? fresh("Match"); const subst: Subst = new Map(); for (const other of results.slice(1)) this.unify(first, other, subst); return apply(first, subst);
      }
      case "for": {
        const values = this.canonicalTy(this.infer(expr.values, context));
        if (values.kind !== "name" || values.name !== "List") throw new FunkyCompileError("for expects a List value");
        const item = values.args[0] ?? fresh("Item");
        const nested = this.cloneContext(context); nested.values.set(expr.name, item); nested.emitted.set(expr.name, id(expr.name));
        this.unify(this.infer(expr.body, nested), n("Unit"), new Map()); return n("Unit");
      }
      case "do": {
        const nested = this.cloneContext(context);
        const whereVars = new Map<string, Ty>();
        for (const binding of expr.where) {
          if (whereVars.has(binding.name)) throw new FunkyCompileError(`duplicate where binding ${binding.name}`);
          whereVars.set(binding.name, binding.type ? this.typeOf(binding.type, nested.vars) : fresh(binding.name));
        }
        for (const [name, type] of whereVars) { nested.values.set(name, type); nested.emitted.set(name, `__where_${typeId(name)}`); }
        const subst: Subst = new Map();
        for (const binding of expr.where) this.unify(whereVars.get(binding.name)!, this.infer(binding.value, nested), subst);
        for (const [name, type] of whereVars) nested.values.set(name, apply(type, subst));
        for (const statement of expr.statements) {
          if (statement.kind === "bind") {
            const value = this.infer(statement.value, nested);
            const type = statement.type ? this.typeOf(statement.type, nested.vars) : value;
            this.unify(type, value, subst);
            nested.values.set(statement.name, apply(type, subst)); nested.emitted.set(statement.name, id(statement.name));
            for (const [boundName, boundType] of nested.values) nested.values.set(boundName, apply(boundType, subst));
          } else if (statement.kind === "expression") this.infer(statement.value, nested);
        }
        const result = this.infer(expr.final, nested);
        for (const statement of expr.statements) if (statement.kind === "break") this.unify(result, this.infer(statement.value, nested), subst);
        return apply(result, subst);
      }
    }
  }

  private inferCall(expr: Expr, context: Context): Ty {
    const { head, args } = flatten(expr);
    if (head.kind === "name" && !context.values.has(head.name)) {
      const name = this.canonicalName(head.name);
      const info = this.functions.get(name);
      if (info) { this.requireFunctionVisible(head.name, name); return this.applyFunction(info, args, context).result; }
      if (this.methodOwners.has(name)) {
        const methodType = this.methodType(name, args, context);
        let result = methodType;
        const subst: Subst = new Map();
        for (const arg of args) { if (result.kind !== "fn") throw new FunkyCompileError(`too many arguments for method ${name}`); this.unify(result.from, this.infer(arg, context), subst); result = result.to; }
        return apply(result, subst);
      }
    }
    let result = this.infer(head, context); const subst: Subst = new Map();
    for (const arg of args) { result = apply(result, subst); if (result.kind !== "fn") throw new FunkyCompileError(`attempted to call non-function ${tyKey(result)}`); this.unify(result.from, this.infer(arg, context), subst); result = result.to; }
    return apply(result, subst);
  }

  private applyFunction(info: FnInfo, args: Expr[], context: Context): { result: Ty; vars: Map<string, Ty>; subst: Subst; params: Ty[] } {
    const signature = this.signature(info);
    const subst: Subst = new Map(); let result = signature.type; const params: Ty[] = [];
    for (const arg of args) {
      result = apply(result, subst);
      if (result.kind !== "fn") throw new FunkyCompileError(`too many arguments for ${info.name}`);
      params.push(result.from);
      this.unify(result.from, this.infer(arg, context), subst);
      result = result.to;
    }
    return { result: apply(result, subst), vars: signature.vars, subst, params: params.map(x => apply(x, subst)) };
  }

  private signature(info: FnInfo): { type: Ty; vars: Map<string, Ty> } {
    const vars = new Map<string, Ty>(); for (const tp of info.typeParams) vars.set(tp.name, fresh(tp.name));
    let result = this.typeOf(info.returnType, vars);
    for (let i = info.params.length - 1; i >= 0; i--) result = fn(this.typeOf(info.params[i].type, vars), result, info.effect && i === info.params.length - 1);
    return { type: result, vars };
  }

  private methodType(name: string, args: Expr[], context: Context): Ty {
    const candidates = context.methods.get(name);
    if (candidates?.length === 1) {
      const method = this.protocolMethods(candidates[0].protocol).find(x => x.name === name)!;
      return this.replaceSelf(this.typeOf(method.type, new Map([["Self", candidates[0].self]])), candidates[0].self);
    }
    if (candidates && candidates.length > 1) throw new FunkyCompileError(`ambiguous protocol method ${name}`);
    if (!args.length) throw new FunkyCompileError(`cannot infer receiver type for method ${name}`);
    const receiver = this.infer(args[0], context);
    const protocols = (this.methodOwners.get(name) ?? []).filter(protocol => this.canResolve(protocol, receiver, context));
    if (protocols.length !== 1) throw new FunkyCompileError(protocols.length ? `ambiguous protocol method ${name}` : `no instance provides method ${name} for ${tyKey(receiver)}`);
    const method = this.protocolMethods(protocols[0]).find(x => x.name === name)!;
    return this.replaceSelf(this.typeOf(method.type), receiver);
  }

  private checkMatch(expr: Extract<Expr, { kind: "match" }>, valueType: Ty, context: Context): void {
    const type = this.canonicalTy(valueType);
    for (const arm of expr.arms) {
      this.checkPatternBindings(arm.pattern);
      this.validatePattern(arm.pattern, valueType, context);
    }
    const previous: Pattern[] = [];
    for (const arm of expr.arms) {
      if (this.patternsExhaustive(type, previous, context) || this.patternsCover(type, previous, arm.pattern, context)) {
        throw new FunkyCompileError("duplicate or unreachable match arm");
      }
      previous.push(arm.pattern);
    }
    if (!this.patternsExhaustive(type, previous, context)) {
      if (type.kind === "name" && (this.variantsFor(type.name).length || type.name === "Bool")) throw new FunkyCompileError(`non-exhaustive match on ${tyKey(type)}`);
      throw new FunkyCompileError(`non-exhaustive match on ${tyKey(type)}; add _ or a binding pattern`);
    }
  }

  private patternsExhaustive(type0: Ty, patterns: Pattern[], context: Context): boolean {
    const type = this.canonicalTy(type0);
    if (patterns.some(x => x.kind === "wildcard" || x.kind === "bind")) return true;
    if (type.kind === "name" && type.name === "Bool") {
      const values = new Set(patterns.filter((x): x is Extract<Pattern,{kind:"literal"}> => x.kind === "literal" && x.literalType === "bool").map(x => String(x.value)));
      return values.has("true") && values.has("false");
    }
    const variants = type.kind === "name" ? this.variantsFor(type.name) : [];
    if (variants.length) return variants.every(variant => {
      const payloads = patterns.filter((x): x is Extract<Pattern,{kind:"variant"}> => x.kind === "variant" && this.canonicalName(x.name) === variant.name);
      if (!payloads.length) return false;
      if (variant.unit) return payloads.some(x => !x.payload || this.patternIsIrrefutable(x.payload, n("Unit"), context));
      return this.patternsExhaustive(this.variantPayloadType(variant, type), payloads.flatMap(x => x.payload ? [x.payload] : []), context);
    });
    return patterns.some(x => this.patternIsIrrefutable(x, type, context));
  }

  private patternsCover(type0: Ty, previous: Pattern[], candidate: Pattern, context: Context): boolean {
    const type = this.canonicalTy(type0);
    if (previous.some(pattern => this.patternCovers(type, pattern, candidate, context))) return true;
    if (candidate.kind === "wildcard" || candidate.kind === "bind") return this.patternsExhaustive(type, previous, context);
    if (candidate.kind === "variant") {
      const info = this.variantInfo(candidate.name);
      if (!info) return false;
      const matching = previous.filter((x): x is Extract<Pattern,{kind:"variant"}> => x.kind === "variant" && this.canonicalName(x.name) === info.name);
      if (info.unit) return matching.some(x => !x.payload || this.patternIsIrrefutable(x.payload, n("Unit"), context));
      if (!candidate.payload) return false;
      const payloadType = this.variantPayloadType(info, type);
      return this.patternsCover(payloadType, matching.flatMap(x => x.payload ? [x.payload] : []), candidate.payload, context);
    }
    return false;
  }

  private patternCovers(type0: Ty, previous: Pattern, candidate: Pattern, context: Context): boolean {
    const type = this.canonicalTy(type0);
    if (previous.kind === "wildcard" || previous.kind === "bind") return true;
    if (candidate.kind === "wildcard" || candidate.kind === "bind") return this.patternIsIrrefutable(previous, type, context);
    if (previous.kind === "literal" && candidate.kind === "literal") {
      if (previous.literalType !== candidate.literalType) return false;
      if (previous.literalType === "int") return BigInt(String(previous.value).replaceAll("_", "")) === BigInt(String(candidate.value).replaceAll("_", ""));
      if (previous.literalType === "float") return Number(String(previous.value).replaceAll("_", "")) === Number(String(candidate.value).replaceAll("_", ""));
      return previous.value === candidate.value;
    }
    if (previous.kind === "variant" && candidate.kind === "variant" && this.canonicalName(previous.name) === this.canonicalName(candidate.name)) {
      const info = this.variantInfo(previous.name);
      if (!info) return false;
      if (info.unit) return !previous.payload || this.patternIsIrrefutable(previous.payload, n("Unit"), context);
      if (!previous.payload || !candidate.payload) return false;
      return this.patternCovers(this.variantPayloadType(info, type), previous.payload, candidate.payload, context);
    }
    if (previous.kind === "record" && candidate.kind === "record" && this.canonicalName(previous.name) === this.canonicalName(candidate.name)) {
      for (const field of previous.fields) {
        const candidateField = candidate.fields.find(x => x.name === field.name);
        const fieldType = this.fieldType(type, field.name);
        if (!candidateField) {
          if (!this.patternIsIrrefutable(field.pattern, fieldType, context)) return false;
        } else if (!this.patternCovers(fieldType, field.pattern, candidateField.pattern, context)) return false;
      }
      return true;
    }
    if (previous.kind === "literal" && previous.literalType === "unit" && candidate.kind === "literal" && candidate.literalType === "unit") return true;
    return false;
  }

  private checkPatternBindings(pattern: Pattern, names = new Set<string>()): void {
    if (pattern.kind === "bind") {
      if (names.has(pattern.name)) throw new FunkyCompileError(`duplicate pattern binding ${pattern.name}`);
      names.add(pattern.name);
    } else if (pattern.kind === "variant" && pattern.payload) this.checkPatternBindings(pattern.payload, names);
    else if (pattern.kind === "record") for (const field of pattern.fields) this.checkPatternBindings(field.pattern, names);
  }

  private validatePattern(pattern: Pattern, type0: Ty, context: Context): void {
    const type = this.canonicalTy(type0);
    if (pattern.kind === "variant") {
      const variant = this.variantInfo(pattern.name);
      if (!variant) throw new FunkyCompileError(`unknown variant ${pattern.name}`);
      this.requireVariantVisible(pattern.name, variant);
      if (type.kind !== "name" || this.canonicalTy(n(variant.owner)).kind !== "name" || type.name !== variant.owner) throw new FunkyCompileError(`${pattern.name} does not belong to ${tyKey(type)}`);
      const payload = this.variantPayloadType(variant, type);
      if (pattern.payload) this.validatePattern(pattern.payload, payload, context);
      else if (!variant.unit) throw new FunkyCompileError(`${pattern.name} requires a payload pattern`);
    } else if (pattern.kind === "record") {
      const info = this.recordInfo(pattern.name);
      if (!info || type.kind !== "name" || this.canonicalTy(n(info.decl.name)).kind !== "name" || type.name !== info.decl.name) throw new FunkyCompileError(`${pattern.name} record pattern does not match ${tyKey(type)}`);
      const used = new Set<string>();
      for (const field of pattern.fields) {
        if (used.has(field.name)) throw new FunkyCompileError(`duplicate record pattern field ${field.name}`);
        used.add(field.name);
        const def = info.definition.fields.find(x => x.name === field.name);
        if (!def) throw new FunkyCompileError(`unknown field ${pattern.name}.${field.name}`);
        const vars = new Map<string, Ty>(); info.decl.params.forEach((p, i) => vars.set(p, type.args[i] ?? fresh(p)));
        this.validatePattern(field.pattern, this.typeOf(def.type, vars), context);
      }
    } else if (pattern.kind === "literal") {
      const expected = pattern.literalType === "bool" ? "Bool" : pattern.literalType === "int" ? "Int" : pattern.literalType === "float" ? "Float" : pattern.literalType === "string" ? "String" : "Unit";
      if (type.kind === "name" && type.name !== expected) throw new FunkyCompileError(`literal pattern ${expected} does not match ${tyKey(type)}`);
    }
  }

  private patternIsIrrefutable(pattern: Pattern, type0: Ty, context: Context): boolean {
    const type = this.canonicalTy(type0);
    if (pattern.kind === "wildcard" || pattern.kind === "bind") return true;
    if (pattern.kind === "variant") {
      const info = this.variantInfo(pattern.name);
      if (!info || type.kind !== "name" || info.owner !== type.name || this.variantsFor(type.name).length !== 1) return false;
      if (!info.unit && !pattern.payload) return false;
      return !pattern.payload || this.patternIsIrrefutable(pattern.payload, this.variantPayloadType(info, type), context);
    }
    if (pattern.kind === "record") {
      const info = this.recordInfo(pattern.name);
      if (!info || type.kind !== "name" || type.name !== info.decl.name) return false;
      return pattern.fields.every(field => {
        const def = info.definition.fields.find(x => x.name === field.name);
        if (!def) return false;
        const vars = new Map<string, Ty>(); info.decl.params.forEach((p, i) => vars.set(p, type.args[i] ?? fresh(p)));
        return this.patternIsIrrefutable(field.pattern, this.typeOf(def.type, vars), context);
      });
    }
    return pattern.kind === "literal" && pattern.literalType === "unit" && type.kind === "name" && type.name === "Unit";
  }

  private patternContext(pattern: Pattern, type0: Ty, parent: Context): Context {
    const ctx = this.cloneContext(parent);
    const bind = (pat: Pattern, type: Ty): void => {
      const t = this.canonicalTy(type);
      if (pat.kind === "bind") { ctx.values.set(pat.name, type); ctx.emitted.set(pat.name, id(pat.name)); }
      else if (pat.kind === "variant" && pat.payload) {
        const info = this.variantInfo(pat.name); if (info) bind(pat.payload, this.variantPayloadType(info, t));
      } else if (pat.kind === "record") {
        const info = this.recordInfo(pat.name);
        if (info && t.kind === "name") {
          const vars = new Map<string, Ty>(); info.decl.params.forEach((p, i) => vars.set(p, t.args[i] ?? fresh(p)));
          for (const f of pat.fields) { const field = info.definition.fields.find(x => x.name === f.name); if (field) bind(f.pattern, this.typeOf(field.type, vars)); }
        }
      }
    };
    bind(pattern, type0); return ctx;
  }

  private cloneContext(context: Context): Context {
    return { values: new Map(context.values), emitted: new Map(context.emitted), vars: new Map(context.vars), dictionaries: new Map([...context.dictionaries].map(([k, v]) => [k, new Map(v)])), methods: new Map([...context.methods].map(([k, v]) => [k, [...v]])), selfInstances: new Map(context.selfInstances) };
  }

  private variantsFor(name: string): VariantInfo[] {
    return [...this.variants.values()].filter(x => x.owner === name);
  }

  private variantType(info: VariantInfo): Ty { return n(info.owner, ...info.ownerParams.map(x => fresh(x))); }
  private variantPayloadType(info: VariantInfo, ownerType: Ty): Ty {
    const vars = new Map<string, Ty>(); info.ownerParams.forEach((x, i) => vars.set(x, ownerType.kind === "name" ? ownerType.args[i] ?? fresh(x) : fresh(x)));
    return this.typeOf(info.payload, vars);
  }

  private unify(a: Ty, b: Ty, subst: Subst): void { unify(this.canonicalTy(a), this.canonicalTy(b), subst); }
  private canonicalTy(type0: Ty, seen = new Set<string>()): Ty {
    if (type0.kind === "var") return type0;
    if (type0.kind === "fn") return { ...type0, from: this.canonicalTy(type0.from, new Set(seen)), to: this.canonicalTy(type0.to, new Set(seen)) };
    const normalized = { ...type0, args: type0.args.map(x => this.canonicalTy(x, new Set(seen))) };
    const decl = this.types.get(normalized.name);
    if (!decl || decl.definition.kind !== "name" || seen.has(normalized.name)) return normalized;
    const vars = new Map<string, Ty>(); decl.params.forEach((p, i) => vars.set(p, normalized.args[i] ?? fresh(p)));
    const path = new Set(seen); path.add(normalized.name);
    return this.canonicalTy(this.typeOf(decl.definition, vars), path);
  }
  private substituteType(node: TypeNode, vars: Map<string, TypeNode>): TypeNode {
    if (node.kind === "name") {
      const replacement = vars.get(node.name);
      if (replacement && node.args.length === 0) return replacement;
      return { ...node, args: node.args.map(x => this.substituteType(x, vars)) };
    }
    if (node.kind === "function") return { ...node, from: this.substituteType(node.from, vars), to: this.substituteType(node.to, vars) };
    if (node.kind === "record") return { ...node, fields: node.fields.map(x => ({ ...x, type: this.substituteType(x.type, vars) })) };
    return { ...node, variants: node.variants.map(x => ({ ...x, type: this.substituteType(x.type, vars) })) };
  }

  private recordInfo(name: string): RecordInfo | undefined {
    name = this.canonicalName(name);
    const first = this.types.get(name);
    const sourceParams = first?.params ?? [];
    let current: TypeNode = { kind: "name", name, args: sourceParams.map(typeParamNode) };
    const seen = new Set<string>();
    while (current.kind === "name" && !seen.has(current.name)) {
      if (current.name === "JsonEntry") {
        const definition: Extract<TypeNode,{kind:"record"}> = { kind: "record", fields: [{ name: "key", type: v("String") }, { name: "value", type: v("Json") }] };
        return { decl: { kind: "type", name: "JsonEntry", params: [], definition }, definition, sourceParams, targetArgs: [] };
      }
      seen.add(current.name);
      const decl = this.types.get(current.name);
      if (!decl) return undefined;
      if (decl.definition.kind === "record") return { decl, definition: decl.definition, sourceParams, targetArgs: current.args };
      if (decl.definition.kind !== "name") return undefined;
      const vars = new Map<string, TypeNode>();
      decl.params.forEach((param, i) => vars.set(param, current.kind === "name" ? current.args[i] ?? typeParamNode(param) : typeParamNode(param)));
      current = this.substituteType(decl.definition, vars);
    }
    return undefined;
  }
  private fieldType(type0: Ty, field: string): Ty {
    const type = this.canonicalTy(type0);
    if (type.kind === "name") {
      const info = this.recordInfo(type.name);
      const def = info?.definition.fields.find(x => x.name === field);
      if (info && def) { const vars = new Map<string, Ty>(); info.decl.params.forEach((p, i) => vars.set(p, type.args[i] ?? fresh(p))); return this.typeOf(def.type, vars); }
    }
    return fresh(field);
  }

  private functionArity(type: TypeNode): number { let count = 0, t = type; while (t.kind === "function") { count++; t = t.to; } return count; }
  private functionParams(type: TypeNode): TypeNode[] { const out: TypeNode[] = []; let t = type; while (t.kind === "function") { out.push(t.from); t = t.to; } return out; }
  private functionResult(type: TypeNode): TypeNode { let t = type; while (t.kind === "function") t = t.to; return t; }
  private functionEffect(type: TypeNode): boolean { let t = type, effect = false; while (t.kind === "function") { effect ||= t.effect; t = t.to; } return effect; }
  private replaceSelf(type: Ty, self: Ty): Ty {
    if (type.kind === "name" && type.name === "Self") return self;
    if (type.kind === "name") return { ...type, args: type.args.map(x => this.replaceSelf(x, self)) };
    if (type.kind === "fn") return { ...type, from: this.replaceSelf(type.from, self), to: this.replaceSelf(type.to, self) };
    return type;
  }

  private protocolMethods(name: string, seen = new Set<string>()): { name: string; type: TypeNode }[] {
    if (seen.has(name)) return [];
    seen.add(name);
    const protocol = this.protocols.get(name);
    if (!protocol) return [];
    if (protocol.body.kind === "methods") return protocol.body.methods;
    return protocol.body.names.flatMap(x => this.protocolMethods(x, seen));
  }

  private emitRuntime(): void {
    this.lines.push(`type Option<T> = { readonly tag: "Some"; readonly value: T } | { readonly tag: "None"; readonly value: undefined };`);
    this.lines.push(`type Result<T, E> = { readonly tag: "Ok"; readonly value: T } | { readonly tag: "Err"; readonly value: E };`);
    this.lines.push(`type List<T> = ReadonlyArray<T>;`);
    this.lines.push(`declare const __funkyBrand: unique symbol;`);
    this.lines.push(`type IoError = Readonly<{ message: string; code?: string }>;`);
    this.lines.push(`type JsonError = Readonly<{ message: string }>;`);
    this.lines.push(`type JsonEntry = Readonly<{ key: string; value: Json }>;`);
    this.lines.push(`type Json = { readonly tag: "Null"; readonly value: undefined } | { readonly tag: "Boolean"; readonly value: boolean } | { readonly tag: "Number"; readonly value: number } | { readonly tag: "Text"; readonly value: string } | { readonly tag: "Array"; readonly value: List<Json> } | { readonly tag: "Object"; readonly value: List<JsonEntry> };`);
    this.lines.push(`const __make_JsonEntry = (fields: { readonly key: string; readonly value: Json }): JsonEntry => Object.freeze(fields);`);
    this.lines.push(`type Eq<Self> = { equal: (left: Self) => (right: Self) => boolean };`);
    this.lines.push(`type __Host = { args: string[]; printLine: (text: string) => void; readText: (path: string) => string; writeText: (path: string, text: string) => void; natives: Record<string, any> };`);
    this.lines.push(`declare const __host: __Host;`);
    this.lines.push(`const __lazy = <T>(thunk: () => T): (() => T) => { let state = 0, value: T; return () => { if (state === 1) throw new Error("cyclic lazy value"); if (state === 0) { state = 1; try { value = thunk(); state = 2; } catch (e) { state = 0; throw e; } } return value!; }; };`);
    this.lines.push(`const __native = (name: string): any => { const value = __host.natives[name]; if (value === undefined) throw new Error("native not registered: " + name); return value; };`);
    this.lines.push(`const __matchFail = (value: unknown): never => { throw new Error("non-exhaustive match: " + String(value)); };`);
    this.lines.push(`const __widenBool = (value: boolean): boolean => value;`);
    this.lines.push(`const __v_Some = <T>(value: T): Option<T> => Object.freeze({ tag: "Some" as const, value });`);
    this.lines.push(`const __v_None: Option<never> = Object.freeze({ tag: "None", value: undefined });`);
    this.lines.push(`const __v_Ok = <T, E = never>(value: T): Result<T, E> => Object.freeze({ tag: "Ok" as const, value });`);
    this.lines.push(`const __v_Err = <E, T = never>(value: E): Result<T, E> => Object.freeze({ tag: "Err" as const, value });`);
    this.lines.push(`const __v_Null: Json = Object.freeze({ tag: "Null", value: undefined });`);
    this.lines.push(`const __v_Boolean = (value: boolean): Json => Object.freeze({ tag: "Boolean" as const, value });`);
    this.lines.push(`const __v_Number = (value: number): Json => Object.freeze({ tag: "Number" as const, value });`);
    this.lines.push(`const __v_Text = (value: string): Json => Object.freeze({ tag: "Text" as const, value });`);
    this.lines.push(`const __v_Array = (value: List<Json>): Json => Object.freeze({ tag: "Array" as const, value });`);
    this.lines.push(`const __v_Object = (value: List<JsonEntry>): Json => Object.freeze({ tag: "Object" as const, value });`);
    this.lines.push(`const __enumUnit = <T>(value: unknown, unit: T): T => { void value; return unit; };`);
    this.lines.push(`const __minInt = -(1n << 63n), __maxInt = (1n << 63n) - 1n;`);
    this.lines.push(`const __checkedInt = (x: bigint): bigint => { if (x < __minInt || x > __maxInt) throw new RangeError("Int overflow"); return x; };`);
    this.lines.push(`const __b_add = (x: bigint) => (y: bigint): bigint => __checkedInt(x + y);`);
    this.lines.push(`const __b_sub = (x: bigint) => (y: bigint): bigint => __checkedInt(x - y);`);
    this.lines.push(`const __b_mul = (x: bigint) => (y: bigint): bigint => __checkedInt(x * y);`);
    this.lines.push(`const __b_div = (x: bigint) => (y: bigint): bigint => { if (y === 0n) throw new RangeError("division by zero"); return __checkedInt(x / y); };`);
    this.lines.push(`const __b_mod_ = (x: bigint) => (y: bigint): bigint => { if (y === 0n) throw new RangeError("division by zero"); return x % y; };`);
    for (const [name, op] of [["lt", "<"], ["le", "<="], ["gt", ">"], ["ge", ">="]] as const) this.lines.push(`const __b_${name} = (x: bigint) => (y: bigint): boolean => x ${op} y;`);
    for (const [name, op] of [["addF", "+"], ["subF", "-"], ["mulF", "*"], ["divF", "/"], ["ltF", "<"], ["leF", "<="], ["gtF", ">"], ["geF", ">="]] as const) this.lines.push(`const __b_${name} = (x: number) => (y: number): ${name.endsWith("F") && name.startsWith("l") || name.startsWith("g") ? "boolean" : "number"} => x ${op} y;`);
    this.lines.push(`const __b_and = (x: boolean) => (y: boolean): boolean => x && y;`);
    this.lines.push(`const __b_or = (x: boolean) => (y: boolean): boolean => x || y;`);
    this.lines.push(`const __b_not = (x: boolean): boolean => !x;`);
    this.lines.push(`const __b_concat = (x: string) => (y: string): string => x + y;`);
    this.lines.push(`const __b_stringLength = (text: string): bigint => BigInt(Array.from(text).length);`);
    this.lines.push(`const __b_intToString = (n: bigint): string => n.toString();`);
    this.lines.push(`const __b_floatToString = (n: number): string => String(n);`);
    this.lines.push(`const __b_trim = (text: string): string => text.trim();`);
    this.lines.push(`const __b_split = (separator: string) => (text: string): List<string> => Object.freeze(separator === "" ? Array.from(text) : text.split(separator));`);
    this.lines.push(`const __b_join = (separator: string) => (parts: List<string>): string => parts.join(separator);`);
    this.lines.push(`const __b_length = <T>(values: List<T>): bigint => BigInt(values.length);`);
    this.lines.push(`const __b_map = <A, B>(transform: (value: A) => B) => (values: List<A>): List<B> => Object.freeze(values.map(transform));`);
    this.lines.push(`const __b_filter = <T>(predicate: (value: T) => boolean) => (values: List<T>): List<T> => Object.freeze(values.filter(predicate));`);
    this.lines.push(`const __b_foldLeft = <A, B>(step: (acc: B) => (value: A) => B) => (initial: B) => (values: List<A>): B => values.reduce((acc, value) => step(acc)(value), initial);`);
    this.lines.push(`const __b_at = <T>(index: bigint) => (values: List<T>): Option<T> => index >= 0n && index < BigInt(values.length) ? __v_Some(values[Number(index)]) : __v_None;`);
    this.lines.push(`const __b_range = (start: bigint) => (end: bigint): List<bigint> => { const out: bigint[] = []; for (let x = start; x < end; x = __checkedInt(x + 1n)) out.push(x); return Object.freeze(out); };`);
    this.lines.push(`const __b_printLine = (text: string): undefined => { __host.printLine(text); return undefined; };`);
    this.lines.push(`const __b_arguments = (): List<string> => Object.freeze([...__host.args]);`);
    this.lines.push(`const __b_readText = (path: string): Result<string, IoError> => { try { return __v_Ok(__host.readText(path)); } catch (e) { return __v_Err({ message: String(e) }); } };`);
    this.lines.push(`const __b_writeText = (path: string) => (text: string): Result<undefined, IoError> => { try { __host.writeText(path, text); return __v_Ok(undefined); } catch (e) { return __v_Err({ message: String(e) }); } };`);
    this.lines.push(`const __b_ioErrorMessage = (error: IoError): string => error.message;`);
    this.lines.push(`const __jsonFromJS = (value: any): Json => value === null ? { tag: "Null", value: undefined } : typeof value === "boolean" ? { tag: "Boolean", value } : typeof value === "number" ? Number.isFinite(value) ? { tag: "Number", value } : (() => { throw new RangeError("JSON number is outside the finite Float range"); })() : typeof value === "string" ? { tag: "Text", value } : Array.isArray(value) ? { tag: "Array", value: Object.freeze(value.map(__jsonFromJS)) } : { tag: "Object", value: Object.freeze(Object.entries(value).map(([key, value]) => ({ key, value: __jsonFromJS(value) }))) };`);
    this.lines.push(`const __jsonToJS = (value: Json): any => value.tag === "Null" ? null : value.tag === "Boolean" || value.tag === "Number" || value.tag === "Text" ? value.value : value.tag === "Array" ? value.value.map(__jsonToJS) : Object.fromEntries(value.value.map(x => [x.key, __jsonToJS(x.value)]));`);
    this.lines.push(`const __b_parseJson = (text: string): Result<Json, JsonError> => { try { return __v_Ok(__jsonFromJS(JSON.parse(text))); } catch (e) { return __v_Err({ message: String(e) }); } };`);
    this.lines.push(`const __b_stringify = (value: Json): string => JSON.stringify(__jsonToJS(value));`);
    this.lines.push(`const __b_jsonField = (key: string) => (object: Json): Option<Json> => { if (object.tag !== "Object") return __v_None; const found = object.value.find(x => x.key === key); return found ? __v_Some(found.value) : __v_None; };`);
    this.lines.push(`const __b_eq = <T>(dict: Eq<T>) => (left: T) => (right: T): boolean => dict.equal(left)(right);`);
    this.lines.push(`const __b_ne = <T>(dict: Eq<T>) => (left: T) => (right: T): boolean => !dict.equal(left)(right);`);
    this.lines.push(`const __dict_Eq_Int: Eq<bigint> = { equal: x => y => x === y };`);
    this.lines.push(`const __dict_Eq_Float: Eq<number> = { equal: x => y => Object.is(x, y) };`);
    this.lines.push(`const __dict_Eq_Bool: Eq<boolean> = { equal: x => y => x === y };`);
    this.lines.push(`const __dict_Eq_String: Eq<string> = { equal: x => y => x === y };`);
    this.lines.push(`const __dict_Eq_Unit: Eq<undefined> = { equal: x => y => x === y };`);
    this.lines.push(`const __dict_Eq_List = <T>(d: Eq<T>): Eq<List<T>> => ({ equal: x => y => x.length === y.length && x.every((v, i) => d.equal(v)(y[i])) });`);
    this.lines.push(`const __dict_Eq_Option = <T>(d: Eq<T>): Eq<Option<T>> => ({ equal: x => y => x.tag === y.tag && (x.tag === "None" || y.tag === "None" || d.equal(x.value)(y.value)) });`);
    this.lines.push(`const __dict_Eq_Result = <T, E>(a: Eq<T>, b: Eq<E>): Eq<Result<T, E>> => ({ equal: x => y => x.tag === y.tag && (x.tag === "Ok" ? y.tag === "Ok" && a.equal(x.value)(y.value) : y.tag === "Err" && b.equal(x.value)(y.value)) });`);
  }

  private emitType(decl: TypeDecl): void {
    const generic = decl.params.length ? `<${decl.params.join(", ")}>` : "";
    const vars = new Map(decl.params.map(x => [x, x]));
    if (decl.definition.kind === "record") {
      const fields = decl.definition.fields.map(x => `readonly ${quote(x.name)}: ${this.typeText(x.type, vars)}`).join("; ");
      this.lines.push(`type ${typeId(decl.name)}${generic} = Readonly<{ ${fields} }> & { readonly [__funkyBrand]: ${quote(decl.name)} };`);
    } else if (decl.definition.kind === "enum") {
      const brand = `{ readonly [__funkyBrand]: ${quote(decl.name)} }`;
      const variants = decl.definition.variants.map(x => `({ readonly tag: ${quote(x.name)}; readonly value: ${this.typeText(x.type, vars)} } & ${brand})`).join(" | ");
      this.lines.push(`type ${typeId(decl.name)}${generic} = ${variants || "never"};`);
    } else {
      this.lines.push(`type ${typeId(decl.name)}${generic} = ${this.typeText(decl.definition, vars)};`);
    }
  }

  private emitProtocol(decl: ProtocolDecl): void {
    const methods = this.protocolMethods(decl.name);
    if (decl.body.kind === "composition") {
      this.lines.push(`type ${typeId(decl.name)}<Self> = ${decl.body.names.map(x => `${typeId(x)}<Self>`).join(" & ")};`);
      return;
    }
    const fields = methods.map(method => `${method.name}: ${this.typeText(method.type, new Map(), "Self")}`).join("; ");
    this.lines.push(`type ${typeId(decl.name)}<Self> = { ${fields} };`);
  }

  private emitRecordFactory(decl: TypeDecl): void {
    if (decl.definition.kind !== "record") return;
    const vars = new Map(decl.params.map(x => [x, x]));
    const generic = decl.params.length ? `<${decl.params.join(", ")}>` : "";
    const fieldsType = decl.definition.fields.map(x => `readonly ${quote(x.name)}: ${this.typeText(x.type, vars)}`).join("; ");
    const result = `${typeId(decl.name)}${generic}`;
    this.lines.push(`const __make_${typeId(decl.name)} = ${generic}(fields: { ${fieldsType} }): ${result} => Object.freeze(fields) as ${result};`);
  }

  private emitVariantConstructors(): void {
    for (const [name, variant] of this.variants) {
      if (["Some", "None", "Ok", "Err", "Null", "Boolean", "Number", "Text", "Array", "Object"].includes(name)) continue;
      const owner = this.types.get(variant.owner);
      if (!owner || owner.definition.kind !== "enum") continue;
      const params = owner.params;
      const used = params.filter(x => this.containsTypeVar(variant.payload, x));
      const unused = params.filter(x => !used.includes(x));
      const functionParams = [...used.map(x => `${x}`), ...unused.map(x => `${x} = never`)].join(", ");
      const generic = functionParams ? `<${functionParams}>` : "";
      const args = params.map(x => x).join(", ");
      const ownerType = `${typeId(owner.name)}${params.length ? `<${args}>` : ""}`;
      const unitType = `${typeId(owner.name)}${params.length ? `<${params.map(() => "never").join(", ")}>` : ""}`;
      if (variant.unit) this.lines.push(`const __v_${typeId(name)}: ${unitType} = Object.freeze({ tag: ${quote(name)}, value: undefined }) as ${unitType};`);
      else {
        const payload = this.typeText(variant.payload, new Map(params.map(x => [x, x])));
        this.lines.push(`const __v_${typeId(name)} = ${generic}(value: ${payload}): ${ownerType} => Object.freeze({ tag: ${quote(name)} as const, value }) as ${ownerType};`);
      }
    }
  }

  private emitFunction(decl: FunctionDecl): void {
    const context = this.functionContext(decl);
    const info = this.functions.get(decl.name)!;
    const genericNames = decl.typeParams.map(x => x.name);
    const generic = genericNames.length ? `<${genericNames.join(", ")}>` : "";
    const hidden: { name: string; protocol: string; typeName: string }[] = [];
    for (const tp of decl.typeParams) for (const protocol of tp.constraints) hidden.push({ name: `__dict_${protocol}_${tp.name}`, protocol, typeName: tp.name });
    const vars = new Map(genericNames.map(x => [x, x]));
    const returnType = this.typeText(decl.returnType, vars);
    if (decl.params.length === 0) {
      if (decl.typeParams.length) throw new FunkyCompileError(`generic zero-parameter value ${decl.name} cannot be inferred`);
      const body = decl.body.kind === "native" ? `__native(${quote(decl.body.name)}) as ${returnType}` : this.emitExpr(decl.body, context, this.typeOf(decl.returnType, context.vars));
      if (decl.body.kind !== "native") {
        try { this.unify(this.infer(decl.body, context), this.typeOf(decl.returnType, context.vars), new Map()); }
        catch (e) { throw new FunkyCompileError(`value ${decl.name}: ${(e as Error).message}`); }
      }
      this.lines.push(`const ${id(decl.name)} = __lazy((): ${returnType} => ${body});`);
      return;
    }
    if (decl.body.kind === "native") {
      if (genericNames.length || hidden.length) throw new FunkyCompileError(`generic native declaration ${decl.name} is not supported`);
      const nativeType = this.functionTypeText(decl.params, decl.returnType, vars);
      this.lines.push(`const ${id(decl.name)} = __native(${quote(decl.body.name)}) as ${nativeType};`);
      return;
    }
    const args = decl.params.map(x => id(x.name));
    const resultTy = this.typeOf(decl.returnType, context.vars);
    const bodyType = this.infer(decl.body, context);
    try { this.unify(bodyType, resultTy, new Map()); }
    catch (e) { throw new FunkyCompileError(`return type of ${decl.name}: ${(e as Error).message}`); }
    let expression = this.emitExpr(decl.body, context, resultTy);
    for (let i = decl.params.length - 1; i >= 0; i--) {
      const resultAnnotation = i === decl.params.length - 1 ? `: ${returnType}` : "";
      expression = `(${args[i]}: ${this.typeText(decl.params[i].type, vars)})${resultAnnotation} => ${expression}`;
    }
    const hiddenParams = hidden.map(x => `${x.name}: ${typeId(x.protocol)}<${x.typeName}>`);
    const outer = hiddenParams.length ? `(${hiddenParams.join(", ")}) => ` : "";
    this.lines.push(`const ${id(decl.name)} = ${generic}${outer}${expression};`);
  }

  private functionTypeText(params: { name: string; type: TypeNode }[], result: TypeNode, vars: Map<string, string>): string {
    let out = this.typeText(result, vars);
    for (let i = params.length - 1; i >= 0; i--) out = `(arg: ${this.typeText(params[i].type, vars)}) => ${out}`;
    return out;
  }

  private emitInstance(instance: InstanceInfo): void {
    const decl = instance.decl;
    const vars = new Map<string, Ty>(); for (const tp of decl.params) vars.set(tp.name, fresh(tp.name));
    const tsVars = new Map(decl.params.map(x => [x.name, x.name]));
    const targetTy = this.typeOf(decl.target, vars);
    const targetText = this.typeText(decl.target, tsVars);
    const params: string[] = [];
    const ctx = this.baseContext(new Map(), new Map(), vars);
    for (const tp of decl.params) for (const protocol of tp.constraints) {
      const name = `__dict_${protocol}_${tp.name}`; params.push(`${name}: ${typeId(protocol)}<${tp.name}>`); this.addDictionary(ctx, vars.get(tp.name)!, protocol, name);
    }
    const objectName = instance.id;
    const methods: string[] = [];
    const methodSigs = this.protocolMethods(decl.protocol);
    for (const implementation of decl.methods) {
      const sig = methodSigs.find(x => x.name === implementation.name)!;
      const parts = this.functionParams(sig.type);
      const methodValues = new Map<string, Ty>(), methodNames = new Map<string, string>();
      implementation.params.forEach((name, i) => { methodValues.set(name, this.replaceSelf(this.typeOf(parts[i], new Map([["Self", targetTy]])), targetTy)); methodNames.set(name, id(name)); });
      const methodCtx = this.cloneContext(ctx); methodCtx.values = methodValues; methodCtx.emitted = methodNames;
      methodCtx.selfInstances.set(key(decl.protocol, targetTy), objectName);
      for (const method of methodSigs) {
        const found = methodCtx.methods.get(method.name) ?? [];
        found.push({ protocol: decl.protocol, dictionary: objectName, self: targetTy }); methodCtx.methods.set(method.name, found);
      }
      const result = this.replaceSelf(this.typeOf(this.functionResult(sig.type), new Map([["Self", targetTy]])), targetTy);
      let body = this.emitExpr(implementation.body, methodCtx, result);
      const expected = result;
      try { this.unify(this.infer(implementation.body, methodCtx), expected, new Map()); } catch (e) { throw new FunkyCompileError(`invalid body for ${implementation.name}: ${(e as Error).message}`); }
      for (let i = implementation.params.length - 1; i >= 0; i--) body = `(${id(implementation.params[i])}: ${typeFromTy(methodValues.get(implementation.params[i])!)}) => ${body}`;
      methods.push(`${quote(implementation.name)}: ${body}`);
    }
    const methodType = `${typeId(decl.protocol)}<${targetText}>`;
    const generic = decl.params.length ? `<${decl.params.map(x => x.name).join(", ")}>` : "";
    const object = `{ ${methods.join(", ")} }`;
    const initializer = decl.params.length
      ? `const ${objectName} = ${generic}(${params.join(", ")}): ${methodType} => { const ${objectName}: ${methodType} = ${object}; return ${objectName}; };`
      : `const ${objectName}: ${methodType} = ${object};`;
    this.lines.push(initializer);
  }

  private emitExpr(expr: Expr, context: Context, expected?: Ty): string {
    switch (expr.kind) {
      case "int": return intCode(expr.raw);
      case "float": return floatCode(expr.raw);
      case "string": return quote(expr.value);
      case "bool": return String(expr.value);
      case "unit": return "undefined";
      case "name": return this.emitName(expr.name, context, expected);
      case "field": return `(${this.emitExpr(expr.object, context)})[${quote(expr.name)}]`;
      case "call": return this.emitCall(expr, context);
      case "list": return `${deepFreeze}([${expr.items.map(x => this.emitExpr(x, context)).join(", ")}])`;
      case "record": return this.emitRecord(expr, context);
      case "variant": {
        const info = this.variantInfo(expr.name);
        if (!info) throw new FunkyCompileError(`unknown enum variant ${expr.name}`);
        this.requireVariantVisible(expr.name, info);
        const ctor = `__v_${typeId(info.name)}`;
        if (expr.payload) return info.unit ? `__enumUnit(${this.emitExpr(expr.payload, context)}, ${ctor})` : `${ctor}(${this.emitExpr(expr.payload, context)})`;
        if (!info.unit) throw new FunkyCompileError(`variant ${expr.name} requires a payload`);
        return ctor;
      }
      case "if": return `((${this.emitExpr(expr.condition, context)}) ? (${this.emitExpr(expr.then, context, expected)}) : (${this.emitExpr(expr.else, context, expected)}))`;
      case "lambda": return this.emitLambda(expr, context);
      case "match": return this.emitMatch(expr, context, expected);
      case "for": return this.emitFor(expr, context);
      case "do": return this.emitDo(expr, context, expected);
    }
  }

  private emitName(name: string, context: Context, expected?: Ty): string {
    const canonical = this.canonicalName(name);
    const emitted = context.emitted.get(name);
    if (emitted) return emitted;
    if (context.values.has(name)) return id(name);
    const method = context.methods.get(canonical);
    if (method?.length === 1) return `${method[0].dictionary}[${quote(canonical)}]`;
    if (method && method.length > 1) throw new FunkyCompileError(`ambiguous protocol method ${canonical}`);
    const info = this.functions.get(canonical);
    if (info) {
      this.requireFunctionVisible(name, canonical);
      if (info.typeParams.some(x => x.constraints.length)) {
        if (!expected) throw new FunkyCompileError(`constrained function ${canonical} needs an expected function type or direct call`);
        const inst = this.specialize(info, expected, context);
        const dicts = this.constraintExpressions(info, inst.vars, inst.subst, context);
        return `${this.functionRef(canonical)}(${dicts.join(", ")})`;
      }
      if (info.params.length === 0) return info.decl ? `${id(canonical)}()` : `__b_${canonical}()`;
      return this.functionRef(canonical);
    }
    const variant = this.variantInfo(canonical);
    if (variant) { this.requireVariantVisible(name, variant); return `__v_${typeId(variant.name)}`; }
    return id(canonical);
  }

  private emitCall(expr: Extract<Expr,{kind:"call"}>, context: Context): string {
    const { head, args } = flatten(expr);
    if (head.kind === "name" && !context.values.has(head.name)) {
      const name = this.canonicalName(head.name);
      const method = context.methods.get(name);
      if (method?.length === 1) return `${method[0].dictionary}[${quote(name)}]${args.map(x => `(${this.emitExpr(x, context)})`).join("")}`;
      if (method && method.length > 1) throw new FunkyCompileError(`ambiguous protocol method ${name}`);
      if (this.methodOwners.has(name) && !this.functions.has(name)) {
        if (!args.length) throw new FunkyCompileError(`cannot infer receiver type for method ${name}`);
        const receiver = this.infer(args[0], context);
        const protocols = (this.methodOwners.get(name) ?? []).filter(protocol => this.canResolve(protocol, receiver, context));
        if (protocols.length !== 1) throw new FunkyCompileError(protocols.length ? `ambiguous protocol method ${name}` : `no instance provides ${name} for ${tyKey(receiver)}`);
        const dict = this.resolveDictionary(protocols[0], receiver, context);
        return `${dict}[${quote(name)}]${args.map(x => `(${this.emitExpr(x, context)})`).join("")}`;
      }
      const info = this.functions.get(name);
      if (info) {
        this.requireFunctionVisible(head.name, name);
        const inst = this.specialize(info, undefined, context, args);
        const dicts = this.constraintExpressions(info, inst.vars, inst.subst, context);
        let code = this.functionRef(name);
        if (info.params.length === 0) code += "()";
        if (info.typeParams.some(x => x.constraints.length)) code += `(${dicts.join(", ")})`;
        for (let i = 0; i < args.length; i++) code += `(${this.emitExpr(args[i], context, apply(inst.params[i] ?? fresh(), inst.subst))})`;
        return code;
      }
    }
    let code = this.emitExpr(head, context);
    for (const arg of args) code += `(${this.emitExpr(arg, context)})`;
    return code;
  }

  private specialize(info: FnInfo, expected?: Ty, context?: Context, args: Expr[] = []): { vars: Map<string, Ty>; subst: Subst; params: Ty[] } {
    const signature = this.signature(info); const subst: Subst = new Map(); let type = signature.type; const params: Ty[] = [];
    if (expected) {
      try { this.unify(type, expected, subst); } catch (e) { throw new FunkyCompileError(`cannot specialize ${info.name}: ${(e as Error).message}`); }
    }
    for (const arg of args) {
      type = apply(type, subst);
      if (type.kind !== "fn") throw new FunkyCompileError(`too many arguments for ${info.name}`);
      params.push(type.from);
      try { this.unify(type.from, this.infer(arg, context!), subst); } catch (e) { throw new FunkyCompileError(`argument of ${info.name}: ${(e as Error).message}`); }
      type = type.to;
    }
    return { vars: signature.vars, subst, params: params.map(x => apply(x, subst)) };
  }

  private functionRef(name: string): string {
    const info = this.functions.get(name);
    return info?.decl ? id(name) : `__b_${info?.native ?? name}`;
  }

  private constraintExpressions(info: FnInfo, vars: Map<string, Ty>, subst: Subst, context: Context): string[] {
    const out: string[] = [];
    for (const parameter of info.typeParams) {
      const type = apply(vars.get(parameter.name)!, subst);
      for (const protocol of parameter.constraints) out.push(this.resolveDictionary(protocol, type, context));
    }
    return out;
  }

  private canResolve(protocol: string, type: Ty, context: Context): boolean {
    try { this.resolveDictionary(protocol, type, context); return true; } catch { return false; }
  }

  private resolveDictionary(protocol: string, type0: Ty, context: Context, stack = new Set<string>()): string {
    const type = this.canonicalTy(apply(type0, new Map()));
    if (type.kind === "var") {
      const dicts = context.dictionaries.get(type.id);
      if (dicts) {
        if (dicts.has(protocol)) return dicts.get(protocol)!;
        const matches = [...dicts].filter(([source]) => this.protocolExtends(source, protocol));
        if (matches.length === 1) return matches[0][1];
        if (matches.length > 1) throw new FunkyCompileError(`ambiguous dictionary for ^${protocol}`);
      }
      throw new FunkyCompileError(`no dictionary for ^${protocol} ${tyKey(type)}`);
    }
    const visitKey = `${protocol}|${tyKey(type)}`;
    if (stack.has(visitKey)) throw new FunkyCompileError(`recursive instance resolution for ^${protocol} ${tyKey(type)}`);
    stack.add(visitKey);
    const self = context.selfInstances.get(visitKey);
    if (self) return self;
    if (protocol === "Eq" && type.kind === "name") {
      const primitive = new Map([["Int", "Int"], ["Float", "Float"], ["Bool", "Bool"], ["String", "String"], ["Unit", "Unit"]]).get(type.name);
      if (primitive) return `__dict_Eq_${primitive}`;
      if (type.name === "List") return `__dict_Eq_List(${this.resolveDictionary("Eq", type.args[0] ?? fresh(), context, stack)})`;
      if (type.name === "Option") return `__dict_Eq_Option(${this.resolveDictionary("Eq", type.args[0] ?? fresh(), context, stack)})`;
      if (type.name === "Result") return `__dict_Eq_Result(${this.resolveDictionary("Eq", type.args[0] ?? fresh(), context, stack)}, ${this.resolveDictionary("Eq", type.args[1] ?? fresh(), context, stack)})`;
    }
    const candidates = this.instances.map(x => this.matchInstance(x, protocol, type)).filter((x): x is { instance: InstanceInfo; subst: Subst } => !!x);
    if (candidates.length !== 1) throw new FunkyCompileError(candidates.length ? `ambiguous instances for ^${protocol} ${tyKey(type)}` : `no instance for ^${protocol} ${tyKey(type)}`);
    const { instance, subst } = candidates[0];
    const params = instance.decl.params.flatMap(tp => tp.constraints.map(p => this.resolveDictionary(p, apply(this.freshInstanceVar(instance, tp.name), subst), context, stack)));
    if (!instance.decl.params.length) return instance.id;
    const typeArgs = instance.decl.params.map(tp => typeFromTy(apply(this.freshInstanceVar(instance, tp.name), subst)));
    return `${instance.id}<${typeArgs.join(", ")}>(${params.join(", ")})`;
  }

  private freshInstanceVar(instance: InstanceInfo, name: string): Ty {
    const vars = new Map<string, Ty>(); for (const p of instance.decl.params) vars.set(p.name, { kind: "var", id: `inst${instance.index}_${p.name}`, label: p.name });
    return vars.get(name)!;
  }

  private matchInstance(instance: InstanceInfo, protocol: string, type: Ty): { instance: InstanceInfo; subst: Subst } | undefined {
    if (!this.protocolExtends(instance.decl.protocol, protocol)) return undefined;
    const vars = new Map<string, Ty>(); for (const p of instance.decl.params) vars.set(p.name, { kind: "var", id: `inst${instance.index}_${p.name}`, label: p.name });
    const subst: Subst = new Map();
    try { this.unify(this.typeOf(instance.decl.target, vars), type, subst); return { instance, subst }; } catch { return undefined; }
  }

  private protocolExtends(source: string, target: string, seen = new Set<string>()): boolean {
    if (source === target) return true;
    if (seen.has(source)) return false;
    seen.add(source);
    const decl = this.protocols.get(source);
    return decl?.body.kind === "composition" && decl.body.names.some(x => this.protocolExtends(x, target, seen));
  }

  private emitLambda(expr: Extract<Expr,{kind:"lambda"}>, parent: Context): string {
    const ctx = this.lambdaContext(expr, parent);
    const vars = new Map(expr.typeParams.map(x => [x.name, x.name]));
    const hidden: string[] = [];
    for (const tp of expr.typeParams) for (const protocol of tp.constraints) hidden.push(`__dict_${protocol}_${tp.name}: ${typeId(protocol)}<${tp.name}>`);
    const generic = expr.typeParams.length ? `<${expr.typeParams.map(x => x.name).join(", ")}>` : "";
    let body = this.emitExpr(expr.body, ctx, this.typeOf(expr.returnType, ctx.vars));
    try { this.unify(this.infer(expr.body, ctx), this.typeOf(expr.returnType, ctx.vars), new Map()); } catch (e) { throw new FunkyCompileError(`lambda return type: ${(e as Error).message}`); }
    for (let i = expr.params.length - 1; i >= 0; i--) body = `(${id(expr.params[i].name)}: ${this.typeText(expr.params[i].type, vars)})${i === expr.params.length - 1 ? `: ${this.typeText(expr.returnType, vars)}` : ""} => ${body}`;
    return `${generic}${hidden.length ? `(${hidden.join(", ")}) => ` : ""}${body}`;
  }

  private emitRecord(expr: Extract<Expr,{kind:"record"}>, context: Context): string {
    const info = this.recordInfo(expr.name);
    if (!info) throw new FunkyCompileError(`${expr.name} is not a record type`);
    const fields = expr.fields.map(x => `${quote(x.name)}: ${this.emitExpr(x.value, context)}`).join(", ");
    const alias = this.resolveRecordFactory(expr.name);
    return `__make_${typeId(alias)}({ ${fields} })`;
  }

  private resolveRecordFactory(name: string): string {
    let current = this.canonicalName(name); const seen = new Set<string>();
    while (!seen.has(current)) {
      if (current === "JsonEntry") return current;
      seen.add(current);
      const decl = this.types.get(current);
      if (!decl) return current;
      if (decl.definition.kind !== "name") return decl.name;
      current = this.canonicalName(decl.definition.name);
    }
    return current;
  }

  private emitDo(expr: Extract<Expr,{kind:"do"}>, parent: Context, expected?: Ty): string {
    const ctx = this.cloneContext(parent);
    const whereDecls: string[] = [];
    const whereVars = new Map<string, Ty>(); const whereSubst: Subst = new Map();
    for (const binding of expr.where) {
      const type = binding.type ? this.typeOf(binding.type, ctx.vars) : fresh(binding.name);
      whereVars.set(binding.name, type);
      ctx.values.set(binding.name, type); ctx.emitted.set(binding.name, `__where_${typeId(binding.name)}()`);
    }
    for (const binding of expr.where) this.unify(whereVars.get(binding.name)!, this.infer(binding.value, ctx), whereSubst);
    for (const [name, type] of whereVars) ctx.values.set(name, apply(type, whereSubst));
    for (const binding of expr.where) {
      const type = ctx.values.get(binding.name)!;
      const annotation = binding.type ? `: ${this.typeText(binding.type, new Map([...ctx.vars].map(([k, t]) => [k, t.kind === "var" ? t.label : typeFromTy(t)])))}` : "";
      whereDecls.push(`const __where_${typeId(binding.name)} = __lazy(()${annotation ? `: ${this.typeText(binding.type!, new Map())}` : ""} => ${this.emitExpr(binding.value, ctx, type)});`);
    }
    const lines = [...whereDecls];
    for (const statement of expr.statements) {
      if (statement.kind === "bind") {
        const type = statement.type ? this.typeOf(statement.type, ctx.vars) : this.infer(statement.value, ctx);
        const ann = statement.type ? `: ${this.typeText(statement.type)}` : "";
        lines.push(`const ${id(statement.name)}${ann} = ${this.emitExpr(statement.value, ctx, type)};`);
        ctx.values.set(statement.name, type); ctx.emitted.set(statement.name, id(statement.name));
      } else if (statement.kind === "expression") lines.push(`${this.emitExpr(statement.value, ctx)};`);
      else lines.push(`return ${this.emitExpr(statement.value, ctx)};`);
    }
    lines.push(`return ${this.emitExpr(expr.final, ctx, expected)};`);
    return `(() => { ${lines.join(" ")} })()`;
  }

  private emitFor(expr: Extract<Expr,{kind:"for"}>, parent: Context): string {
    const ctx = this.cloneContext(parent); const item = this.canonicalTy(this.infer(expr.values, parent));
    if (item.kind !== "name" || item.name !== "List") throw new FunkyCompileError("for expects a List value");
    const itemType = item.args[0] ?? fresh("Item");
    ctx.values.set(expr.name, itemType); ctx.emitted.set(expr.name, id(expr.name));
    return `(() => { for (const ${id(expr.name)} of ${this.emitExpr(expr.values, parent)}) { ${this.emitExpr(expr.body, ctx)}; } return undefined; })()`;
  }

  private emitMatch(expr: Extract<Expr,{kind:"match"}>, context: Context, expected?: Ty): string {
    const valueType = this.canonicalTy(this.infer(expr.value, context));
    this.checkMatch(expr, valueType, context);
    const temp = `__match_${nextVar++}`;
    if (valueType.kind === "name" && this.variantsFor(valueType.name).length) {
      const variants = this.variantsFor(valueType.name);
      const cases: string[] = [];
      for (const variant of variants) {
        const arms = expr.arms.filter(a => a.pattern.kind === "variant" && this.canonicalName(a.pattern.name) === variant.name);
        const fallback = expr.arms.find(a => a.pattern.kind === "wildcard" || a.pattern.kind === "bind");
        const body: string[] = [];
        for (const arm of arms) {
          const pat = arm.pattern as Extract<Pattern,{kind:"variant"}>;
          const payloadType = this.variantPayloadType(variant, valueType);
          const code = this.emitPatternArm(pat.payload, `${temp}.value`, payloadType, arm, context, expected);
          body.push(code);
        }
        if (fallback) body.push(this.emitPatternArm(fallback.pattern, temp, valueType, fallback, context, expected));
        else body.push(`return __matchFail(${temp});`);
        cases.push(`case ${quote(variant.name)}: { ${body.join(" ")} }`);
      }
      const defaultArm = expr.arms.find(a => a.pattern.kind === "wildcard" || a.pattern.kind === "bind");
      const defaultCode = defaultArm ? this.emitPatternArm(defaultArm.pattern, temp, valueType, defaultArm, context, expected) : `return __matchFail(${temp});`;
      return `(() => { const ${temp}: ${typeFromTy(valueType)} = ${this.emitExpr(expr.value, context)}; switch (${temp}.tag) { ${cases.join(" ")} default: { ${defaultCode} } } })()`;
    }
    if (valueType.kind === "name" && valueType.name === "Bool") {
      const cases = [true, false].map(value => {
        const arm = expr.arms.find(a => a.pattern.kind === "literal" && a.pattern.literalType === "bool" && a.pattern.value === value);
        const fallback = expr.arms.find(a => a.pattern.kind === "wildcard" || a.pattern.kind === "bind");
        return `case ${value}: { ${arm ? `return ${this.emitExpr(arm.body, this.patternContext(arm.pattern, valueType, context), expected)};` : fallback ? this.emitPatternArm(fallback.pattern, temp, valueType, fallback, context, expected) : `return __matchFail(${temp});`} }`;
      });
      return `(() => { const ${temp}: boolean = __widenBool(${this.emitExpr(expr.value, context)}); switch (${temp}) { ${cases.join(" ")} default: return __matchFail(${temp}); } })()`;
    }
    const branches: string[] = [];
    for (const arm of expr.arms) {
      const compiled = this.compilePattern(arm.pattern, temp, valueType, context);
      const body = `return ${this.emitExpr(arm.body, compiled.context, expected)};`;
      branches.push(compiled.test === "true" ? `{ ${compiled.bindings.join(" ")} ${body} }` : `if (${compiled.test}) { ${compiled.bindings.join(" ")} ${body} }`);
    }
    branches.push(`return __matchFail(${temp});`);
    return `(() => { const ${temp}: ${typeFromTy(valueType)} = ${this.emitExpr(expr.value, context)}; ${branches.join(" ")} })()`;
  }

  private emitPatternArm(payload: Pattern | undefined, value: string, type: Ty, arm: MatchArm, parent: Context, expected?: Ty): string {
    const compiled = payload ? this.compilePattern(payload, value, type, parent) : { test: "true", bindings: [], context: this.cloneContext(parent) };
    const body = `return ${this.emitExpr(arm.body, compiled.context, expected)};`;
    return compiled.test === "true" ? `{ ${compiled.bindings.join(" ")} ${body} }` : `if (${compiled.test}) { ${compiled.bindings.join(" ")} ${body} }`;
  }

  private compilePattern(pattern: Pattern, value: string, type: Ty, parent: Context): { test: string; bindings: string[]; context: Context } {
    const context = this.cloneContext(parent); const tests: string[] = [], bindings: string[] = [];
    const walk = (pat: Pattern, at: string, ty: Ty): void => {
      if (pat.kind === "wildcard") return;
      if (pat.kind === "bind") { context.values.set(pat.name, ty); context.emitted.set(pat.name, id(pat.name)); bindings.push(`const ${id(pat.name)} = ${at};`); return; }
      if (pat.kind === "literal") { tests.push(`${at} === ${literalCode(pat.value, pat.literalType)}`); return; }
      if (pat.kind === "variant") {
        const variant = this.variantInfo(pat.name); if (!variant) return;
        tests.push(`${at}.tag === ${quote(variant.name)}`);
        if (pat.payload) walk(pat.payload, `${at}.value`, this.variantPayloadType(variant, this.canonicalTy(ty)));
        return;
      }
      if (pat.kind === "record") {
        for (const field of pat.fields) {
          const fieldType = this.fieldType(ty, field.name);
          walk(field.pattern, `${at}[${quote(field.name)}]`, fieldType);
        }
      }
    };
    walk(pattern, value, type);
    return { test: tests.length ? tests.join(" && ") : "true", bindings, context };
  }

  private containsTypeVar(node: TypeNode, name: string): boolean {
    if (node.kind === "name") return node.name === name || node.args.some(x => this.containsTypeVar(x, name));
    if (node.kind === "function") return this.containsTypeVar(node.from, name) || this.containsTypeVar(node.to, name);
    return node.kind === "record" ? node.fields.some(x => this.containsTypeVar(x.type, name)) : node.variants.some(x => this.containsTypeVar(x.type, name));
  }
}

export function transpile(program: Program): string { return new Transpiler(program).run(); }

const typecheckOptions: ts.CompilerOptions = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, lib: ["lib.es2022.d.ts"], types: [] };
const generatedTypecheckFile = "/__funky_generated__.ts";

export function typecheck(source: string): string[] {
  const host = ts.createCompilerHost(typecheckOptions);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  const originalFileExists = host.fileExists.bind(host);
  const originalReadFile = host.readFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) => name === generatedTypecheckFile ? ts.createSourceFile(name, source, languageVersion, true) : originalGetSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile);
  host.fileExists = name => name === generatedTypecheckFile || originalFileExists(name);
  host.readFile = name => name === generatedTypecheckFile ? source : originalReadFile(name);
  const program = ts.createProgram([generatedTypecheckFile], typecheckOptions, host);
  return ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
}

export function typecheckInMemory(source: string, libraries: Record<string, string>): string[] {
  const normalized = (name: string) => name.replaceAll("\\", "/");
  const basename = (name: string) => normalized(name).split("/").pop()!;
  const libFiles = new Map(Object.entries(libraries));
  const contents = (name: string) => normalized(name) === generatedTypecheckFile ? source : libFiles.get(basename(name));
  const host: ts.CompilerHost = {
    getSourceFile: (name, languageVersion) => {
      const text = contents(name);
      return text === undefined ? undefined : ts.createSourceFile(name, text, languageVersion, true);
    },
    writeFile: () => undefined,
    getDefaultLibFileName: () => "lib.es2022.d.ts",
    getCurrentDirectory: () => "/",
    getCanonicalFileName: normalized,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: name => normalized(name) === generatedTypecheckFile || libFiles.has(basename(name)),
    readFile: name => contents(name),
    directoryExists: () => true,
    getDirectories: () => [],
    realpath: normalized,
  };
  const program = ts.createProgram([generatedTypecheckFile], typecheckOptions, host);
  return ts.getPreEmitDiagnostics(program).map(d => {
    const message = ts.flattenDiagnosticMessageText(d.messageText, "\n");
    if (!d.file || d.file.fileName !== generatedTypecheckFile || d.start === undefined) return `TS${d.code}: ${message}`;
    const { line, character } = ts.getLineAndCharacterOfPosition(d.file, d.start);
    return `${line + 1}:${character + 1} TS${d.code}: ${message}`;
  });
}
