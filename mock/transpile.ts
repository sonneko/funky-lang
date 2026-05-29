import type {
  Program, TopLevel,
  UsingDecl, FunctionDecl, TypeDefinition, ProtocolDefinition,
  TypeLiteral, StructTypeBody, EnumTypeBody, FnTypeBody, NamedType,
  ProtocolLiteral, Expression, IfExpression, CallExpression,
  BlockExpression, StructLiteral, EnumLiteral,
} from "./parser.ts";

// ============================================================
// Transpile Error
// ============================================================

export class TranspileError extends Error {
  constructor(message: string) { super(message); }
}

// ============================================================
// Indentation helper
// ============================================================

class CodeWriter {
  private lines: string[] = [];
  private depth = 0;

  indent() { this.depth++; }
  dedent() { this.depth--; }

  write(line: string) {
    const pad = "  ".repeat(this.depth);
    // Handle multi-line strings (e.g. template literals)
    for (const l of line.split("\n")) {
      this.lines.push(l === "" ? "" : pad + l);
    }
  }

  // Write a raw line without indentation prefix (for continuations)
  writeRaw(line: string) { this.lines.push(line); }

  toString() { return this.lines.join("\n"); }
}

// ============================================================
// Scope: tracks which names are enum types so we can emit
// correct pattern-matching code at call sites.
// ============================================================

interface Scope {
  // type name → set of variant names
  enumTypes: Map<string, Set<string>>;
  // type name → set of field names
  structTypes: Map<string, Set<string>>;
  // protocol name → method names
  protocols: Map<string, string[]>;
  // function name → number of params (for currying)
  functions: Map<string, number>;
}

function makeScope(): Scope {
  return {
    enumTypes: new Map(),
    structTypes: new Map(),
    protocols: new Map(),
    functions: new Map(),
  };
}

// ============================================================
// Main Transpiler class
// ============================================================

export class Transpiler {
  private scope: Scope = makeScope();

  // ---- Public entry point ----

  transpile(program: Program): string {
    // First pass: register all type/protocol/function declarations into scope
    this.collectDeclarations(program);

    const w = new CodeWriter();
    w.write("// AUTO-GENERATED — do not edit");
    w.write("");

    for (const node of program.body) {
      this.emitTopLevel(w, node);
      w.write("");
    }

    return w.toString().trimEnd() + "\n";
  }

  // ---- Declaration collection (first pass) ----

  private collectDeclarations(program: Program) {
    for (const node of program.body) {
      if (node.kind === "TypeDefinition") {
        this.registerType(node.name, node.type);
      } else if (node.kind === "ProtocolDefinition") {
        if (node.body.kind === "ProtocolDefinitionBody") {
          this.scope.protocols.set(node.name, node.body.methods.map(m => m.name));
        }
      } else if (node.kind === "FunctionDecl") {
        this.scope.functions.set(node.name, node.params.length);
      }
    }
  }

  private registerType(name: string, type: TypeLiteral) {
    if (type.kind === "EnumTypeBody") {
      this.scope.enumTypes.set(name, new Set(type.variants.map(v => v.name)));
    } else if (type.kind === "StructTypeBody") {
      this.scope.structTypes.set(name, new Set(type.fields.map(f => f.name)));
    } else if (type.kind === "NamedType") {
      // Type alias — propagate the underlying type if known
      if (this.scope.enumTypes.has(type.name)) {
        this.scope.enumTypes.set(name, this.scope.enumTypes.get(type.name)!);
      } else if (this.scope.structTypes.has(type.name)) {
        this.scope.structTypes.set(name, this.scope.structTypes.get(type.name)!);
      }
    }
  }

  // ---- Top-level emitters ----

  private emitTopLevel(w: CodeWriter, node: TopLevel) {
    switch (node.kind) {
      case "UsingDecl": return this.emitUsing(w, node);
      case "FunctionDecl": return this.emitFunction(w, node);
      case "TypeDefinition": return this.emitTypeDefinition(w, node);
      case "ProtocolDefinition": return this.emitProtocol(w, node);
    }
  }

  // ------------------------------------------------------------------
  // using foo as f bar from "mod";
  //   → import { foo as f, bar } from "mod";
  // ------------------------------------------------------------------

  private emitUsing(w: CodeWriter, node: UsingDecl) {
    if (node.imports.length === 0) {
      w.write(`import "${node.from}";`);
      return;
    }
    const specs = node.imports.map(i =>
      i.alias ? `${i.name} as ${i.alias}` : i.name
    ).join(", ");
    w.write(`import { ${specs} } from "${node.from}";`);
  }

  // ------------------------------------------------------------------
  // Type definitions
  //
  // Struct:  $Point is { x = $Int y = $Int };
  //   → export type Point = { x: number; y: number };
  //
  // Enum:    $Option is $T => | Some = $T None = $Unit |;
  //   → export type Option<T> =
  //       | { tag: "Some"; value: T }
  //       | { tag: "None"; value: Unit };
  //
  // Named:   $Foo is $Bar;
  //   → export type Foo = Bar;
  // ------------------------------------------------------------------

  private emitTypeDefinition(w: CodeWriter, node: TypeDefinition) {
    const type = node.type;

    if (type.kind === "StructTypeBody") {
      const params = type.typeParams.length
        ? `<${type.typeParams.join(", ")}>`
        : "";
      const fields = type.fields
        .map(f => `${f.name}: ${this.emitTypeLiteral(f.type)}`)
        .join("; ");
      w.write(`export type ${node.name}${params} = { ${fields} };`);
      return;
    }

    if (type.kind === "EnumTypeBody") {
      const params = type.typeParams.length
        ? `<${type.typeParams.join(", ")}>`
        : "";
      if (type.variants.length === 0) {
        w.write(`export type ${node.name}${params} = never;`);
        return;
      }
      w.write(`export type ${node.name}${params} =`);
      w.indent();
      for (const v of type.variants) {
        w.write(`| { tag: "${v.name}"; value: ${this.emitTypeLiteral(v.type)} }`);
      }
      w.dedent();
      w.write(`;`);
      return;
    }

    if (type.kind === "FnTypeBody") {
      w.write(`export type ${node.name} = ${this.emitTypeLiteral(type)};`);
      return;
    }

    // NamedType alias
    w.write(`export type ${node.name} = ${this.emitTypeLiteral(type)};`);
  }

  // ------------------------------------------------------------------
  // Protocol definitions
  //
  // ^Show is { show = $T > $String };
  //   → export interface Show<T> { show(value: T): string; }
  //
  // ^ShowEq is ^Show + ^Eq;
  //   → export type ShowEq<T> = Show<T> & Eq<T>;
  // ------------------------------------------------------------------

  private emitProtocol(w: CodeWriter, node: ProtocolDefinition) {
    const body = node.body;

    if (body.kind === "ProtocolLiteral") {
      // Intersection of other protocols — emit as type alias
      // We use a single generic T since we don't know the arity
      const parts = body.names.map(n => `${n}<T>`).join(" & ");
      w.write(`export type ${node.name}<T> = ${parts};`);
      return;
    }

    // ProtocolDefinitionBody
    if (body.methods.length === 0) {
      w.write(`export interface ${node.name}<T> {}`);
      return;
    }

    w.write(`export interface ${node.name}<T> {`);
    w.indent();
    for (const method of body.methods) {
      w.write(`${method.name}: ${this.emitTypeLiteral(method.type)};`);
    }
    w.dedent();
    w.write(`}`);
  }

  // ------------------------------------------------------------------
  // Function declarations
  //
  // Curried functions (multiple params) are emitted as nested lambdas:
  //   add x: $Int y: $Int > $Int is ...
  //   → export const add = (x: number) => (y: number): number => ...
  //
  // Zero-param functions become plain values:
  //   greet > $String is "hello"
  //   → export const greet: string = "hello";
  //
  // Builtin (#name) → declare const name: ...; (external)
  //
  // Protocol constraints become generic type parameters + where clause:
  //   show $T: ^Show => x: $T > $String is ...
  //   → export const show = <T extends Show<T>>(x: T): string => ...
  // ------------------------------------------------------------------

  private emitFunction(w: CodeWriter, node: FunctionDecl) {
    const { name, protocols, params, returnType, body } = node;

    // Builtin: declare the external function
    if (body.kind === "Builtin") {
      const sig = this.buildFunctionSignature(protocols, params, returnType);
      w.write(`declare const ${body.name}: ${sig};`);
      w.write(`export const ${name} = ${body.name};`);
      return;
    }

    const bodyStr = this.emitExpression(body);

    if (params.length === 0) {
      // Nullary: constant value
      const retTs = this.emitTypeLiteral(returnType);
      w.write(`export const ${name}: ${retTs} = ${bodyStr};`);
      return;
    }

    // Generic type params from protocol constraints
    const generics = protocols.length
      ? `<${protocols.map(p => {
        const lit = (p.body as any).literal as ProtocolLiteral | undefined;
        const constraint = lit
          ? lit.names.map(n => `${n}<${p.name}>`).join(" & ")
          : (this.scope.protocols.has(p.name) ? `${p.name}<${p.name}>` : "unknown");
        return `${p.name} extends ${constraint}`;
      }).join(", ")}>`
      : "";

    // Curried parameter list
    const retTs = this.emitTypeLiteral(returnType);
    const paramParts = params.map(p =>
      `(${p.name}: ${this.emitTypeLiteral(p.type)})`
    );
    // Innermost return type annotation goes on the last arrow
    const arrows = paramParts.map((p, i) =>
      i === paramParts.length - 1
        ? `${p}: ${retTs} => ${bodyStr}`
        : `${p} =>`
    );

    w.write(`export const ${name} = ${generics}${arrows.join(" ")};`);
  }

  // Build a function type string (used for builtins)
  private buildFunctionSignature(
    protocols: FunctionDecl["protocols"],
    params: FunctionDecl["params"],
    returnType: TypeLiteral,
  ): string {
    if (params.length === 0) return this.emitTypeLiteral(returnType);
    const retTs = this.emitTypeLiteral(returnType);
    // Emit as curried function type
    const parts = params.map(p => `(${p.name}: ${this.emitTypeLiteral(p.type)}) =>`);
    return `${parts.join(" ")} ${retTs}`;
  }

  // ---- Type literal emitter ----

  emitTypeLiteral(type: TypeLiteral): string {
    switch (type.kind) {
      case "NamedType": return this.emitNamedType(type);
      case "StructTypeBody": return this.emitStructTypeLiteral(type);
      case "EnumTypeBody": return this.emitEnumTypeLiteral(type);
      case "FnTypeBody": return this.emitFnTypeLiteral(type);
    }
  }

  private emitNamedType(type: NamedType): string {
    const base = mapBuiltinType(type.name);
    if (type.args.length === 0) return base;
    return `${base}<${type.args.map(a => this.emitTypeLiteral(a)).join(", ")}>`;
  }

  private emitStructTypeLiteral(type: StructTypeBody): string {
    if (type.fields.length === 0) return "{}";
    const fields = type.fields
      .map(f => `${f.name}: ${this.emitTypeLiteral(f.type)}`)
      .join("; ");
    return `{ ${fields} }`;
  }

  private emitEnumTypeLiteral(type: EnumTypeBody): string {
    if (type.variants.length === 0) return "never";
    return type.variants
      .map(v => `{ tag: "${v.name}"; value: ${this.emitTypeLiteral(v.type)} }`)
      .join(" | ");
  }

  private emitFnTypeLiteral(type: FnTypeBody): string {
    const param = this.emitTypeLiteral(type.paramType);
    const ret = type.returnType.kind === "FnTypeBody"
      ? this.emitFnTypeLiteral(type.returnType)
      : this.emitTypeLiteral(type.returnType);
    // No parameter name available from type-only position; use _
    return `(_: ${param}) => ${ret}`;
  }

  // ---- Expression emitter ----

  emitExpression(expr: Expression): string {
    switch (expr.kind) {
      case "IfExpression": return this.emitIf(expr);
      case "CallExpression": return this.emitCall(expr);
      case "BlockExpression": return this.emitBlock(expr);
      case "ParenExpression": return `(${this.emitExpression(expr.expr)})`;

      // PrimaryExpression variants
      case "StringLiteral": return JSON.stringify(expr.value);
      case "NumberLiteral": return expr.value;
      case "BoolLiteral": return expr.value ? "true" : "false";
      case "StructLiteral": return this.emitStructLit(expr);
      case "EnumLiteral": return this.emitEnumLit(expr);
      case "PeriodAccess": return expr.parts.join(".");
    }
  }

  // ------------------------------------------------------------------
  // if cond then e1 else e2
  //   → (cond ? e1 : e2)
  // ------------------------------------------------------------------

  private emitIf(expr: IfExpression): string {
    const cond = this.emitExpression(expr.condition);
    const then = this.emitExpression(expr.then);
    const els = this.emitExpression(expr.else);
    return `(${cond} ? ${then} : ${els})`;
  }

  // ------------------------------------------------------------------
  // Call expression: curried application
  //
  //   f a b  (parsed as CallExpr(CallExpr(f, a), b))
  //   → f(a)(b)
  //
  // Special case: if the callee is a known single-param function or
  // the argument is an enum pattern, we just do f(a).
  // ------------------------------------------------------------------

  private emitCall(expr: CallExpression): string {
    const callee = this.emitExpression(expr.callee);
    const arg = this.emitExpression(expr.arg);
    return `${callee}(${arg})`;
  }

  // ------------------------------------------------------------------
  // Block expression:
  //   do {
  //     stmt1;
  //     break val;
  //     finalExpr
  //   } where {
  //     x = expr1
  //     y: $T = expr2
  //   }
  //
  //   → (() => {
  //       const x = expr1;
  //       const y: T = expr2;
  //       stmt1;
  //       return val;   // break → return
  //       return finalExpr;
  //     })()
  //
  // The `where` bindings are hoisted to the top of the IIFE so that
  // all bindings are in scope for all statements (like a letrec).
  // ------------------------------------------------------------------

  private emitBlock(expr: BlockExpression): string {
    const lines: string[] = [];
    lines.push("(() => {");

    // where bindings first
    for (const b of expr.bindings) {
      const typeAnn = b.type ? `: ${this.emitTypeLiteral(b.type)}` : "";
      const val = this.emitExpression(b.value);
      lines.push(`  const ${b.name}${typeAnn} = ${val};`);
    }

    // statements
    for (const s of expr.stmts) {
      if (s.kind === "Break") {
        lines.push(`  return ${this.emitExpression(s.expr)};`);
      } else {
        lines.push(`  ${this.emitExpression(s.expr)};`);
      }
    }

    // final expression
    lines.push(`  return ${this.emitExpression(expr.final)};`);
    lines.push("})()");

    return lines.join("\n");
  }

  // ------------------------------------------------------------------
  // Struct literal:
  //   Point { x = 1 y = 2 }
  //   → ({ x: 1, y: 2 } as Point)
  // ------------------------------------------------------------------

  private emitStructLit(expr: StructLiteral): string {
    if (expr.fields.length === 0) return `({} as ${expr.name})`;
    const fields = expr.fields
      .map(f => `${f.name}: ${this.emitExpression(f.value)}`)
      .join(", ");
    return `({ ${fields} } as ${expr.name})`;
  }

  // ------------------------------------------------------------------
  // Enum literal:
  //   Some(42)
  //   → ({ tag: "Some", value: 42 })
  // ------------------------------------------------------------------

  private emitEnumLit(expr: EnumLiteral): string {
    const val = this.emitExpression(expr.value);
    return `({ tag: "${expr.name}", value: ${val} })`;
  }
}

// ============================================================
// Built-in type mapping
// ============================================================

function mapBuiltinType(name: string): string {
  const map: Record<string, string> = {
    Int: "number",
    Float: "number",
    Number: "number",
    String: "string",
    Bool: "boolean",
    Unit: "void",
    Never: "never",
    Any: "unknown",
    List: "Array",
    Array: "Array",
    Map: "Map",
    Set: "Set",
    Option: "Option",
    Result: "Result",
  };
  return map[name] ?? name;
}

// ============================================================
// Public API
// ============================================================

export function transpile(program: Program): string {
  return new Transpiler().transpile(program);
}
