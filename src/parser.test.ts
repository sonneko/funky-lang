import { parse, tokenize, LexError, ParseError } from "./parser.ts";

// ---- Test helpers ----

let passed = 0, failed = 0;

function test(name: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}:\n    ${(e as Error).message}`); failed++; }
}

function eq(a: unknown, b: unknown) {
  const ja = JSON.stringify(a, null, 2), jb = JSON.stringify(b, null, 2);
  if (ja !== jb) throw new Error(`\nExpected:\n${jb}\nGot:\n${ja}`);
}

// ============================================================
console.log("\n=== Lexer tests ===");
// ============================================================

test("block comment is skipped", () => {
  const toks = tokenize("/* hello */ foo");
  eq(toks.map(t => t.kind), ["IDENT", "EOF"]);
});

test("nested-style comment (flat) is skipped", () => {
  const toks = tokenize("a /* b /* c */ d");
  // After /*, scanner runs until */, so "d" is after it
  eq(toks.map(t => [t.kind, t.value]), [["IDENT", "a"], ["IDENT", "d"], ["EOF", ""]]);
});

test("keywords are recognised", () => {
  const toks = tokenize("using as from is do where if then else break");
  const kinds = toks.slice(0, -1).map(t => t.kind);
  eq(kinds, ["USING", "AS", "FROM", "IS", "DO", "WHERE", "IF", "THEN", "ELSE", "BREAK"]);
});

test("bool literals", () => {
  const toks = tokenize("true false");
  eq(toks.slice(0, 2).map(t => [t.kind, t.value]), [["BOOL", "true"], ["BOOL", "false"]]);
});

test("string literal with escape", () => {
  const toks = tokenize('"hello \\"world\\""');
  eq(toks[0], { kind: "STRING", value: 'hello "world"', pos: 0 });
});

test("number literal", () => {
  const toks = tokenize("42 3.14");
  eq(toks.slice(0, 2).map(t => t.value), ["42", "3.14"]);
});

test("arrow token", () => {
  const toks = tokenize("=>");
  eq(toks[0].kind, "ARROW");
});

test("throws on unterminated string", () => {
  try { tokenize('"oops'); throw new Error("no error thrown"); }
  catch (e) { if (!(e instanceof LexError)) throw e; }
});

test("throws on unterminated comment", () => {
  try { tokenize("/* oops"); throw new Error("no error thrown"); }
  catch (e) { if (!(e instanceof LexError)) throw e; }
});

test("throws on unexpected character", () => {
  try { tokenize("@"); throw new Error("no error thrown"); }
  catch (e) { if (!(e instanceof LexError)) throw e; }
});

// ============================================================
console.log("\n=== Parser: using ===");
// ============================================================

test("simple using", () => {
  const ast = parse(`using foo from "mylib";`);
  eq(ast.body[0], {
    kind: "UsingDecl",
    imports: [{ name: "foo", alias: null }],
    from: "mylib",
  });
});

test("using multiple names", () => {
  const ast = parse(`using foo bar baz from "lib";`);
  const decl = ast.body[0] as any;
  eq(decl.imports.map((i: any) => i.name), ["foo", "bar", "baz"]);
});

test("using with alias", () => {
  const ast = parse(`using alpha as a beta as b from "lib";`);
  const decl = ast.body[0] as any;
  eq(decl.imports, [{ name: "alpha", alias: "a" }, { name: "beta", alias: "b" }]);
});

// ============================================================
console.log("\n=== Parser: type definitions ===");
// ============================================================

test("named type definition", () => {
  const ast = parse(`$Foo is $Bar;`);
  eq(ast.body[0], {
    kind: "TypeDefinition",
    name: "Foo",
    type: { kind: "NamedType", name: "Bar", args: [] },
  });
});

test("named type with type args", () => {
  const ast = parse(`$Foo is $List<$Int>;`);
  const def = ast.body[0] as any;
  eq(def.type, { kind: "NamedType", name: "List", args: [{ kind: "NamedType", name: "Int", args: [] }] });
});

test("struct type body", () => {
  const ast = parse(`$Point is { x = $Int y = $Int };`);
  const def = ast.body[0] as any;
  eq(def.type.kind, "StructTypeBody");
  eq(def.type.fields.map((f: any) => f.name), ["x", "y"]);
});

test("struct type body with type params", () => {
  const ast = parse(`$Pair is $A $B => { first = $A second = $B };`);
  const def = ast.body[0] as any;
  eq(def.type.typeParams, ["A", "B"]);
  eq(def.type.fields.map((f: any) => f.name), ["first", "second"]);
});

test("enum type body", () => {
  const ast = parse(`$Option is $T => | Some = $T None = $Unit |;`);
  const def = ast.body[0] as any;
  eq(def.type.kind, "EnumTypeBody");
  eq(def.type.typeParams, ["T"]);
  eq(def.type.variants.map((v: any) => v.name), ["Some", "None"]);
});

// ============================================================
console.log("\n=== Parser: protocol definitions ===");
// ============================================================

test("protocol with body", () => {
  const ast = parse(`^Show is { show = $T > $String };`);
  const p = ast.body[0] as any;
  eq(p.kind, "ProtocolDefinition");
  eq(p.name, "Show");
  eq(p.body.kind, "ProtocolDefinitionBody");
  eq(p.body.methods[0].name, "show");
});

test("protocol literal (alias)", () => {
  const ast = parse(`^Display is ^Show;`);
  const p = ast.body[0] as any;
  eq(p.body, { kind: "ProtocolLiteral", names: ["Show"] });
});

test("protocol literal with '+' combinator", () => {
  const ast = parse(`^ShowEq is ^Show + ^Eq;`);
  const p = ast.body[0] as any;
  eq(p.body, { kind: "ProtocolLiteral", names: ["Show", "Eq"] });
});

// ============================================================
console.log("\n=== Parser: function declarations ===");
// ============================================================

test("simple function", () => {
  const ast = parse(`add x: $Int y: $Int > $Int is x;`);
  const fn = ast.body[0] as any;
  eq(fn.kind, "FunctionDecl");
  eq(fn.name, "add");
  eq(fn.params.map((p: any) => p.name), ["x", "y"]);
  eq(fn.returnType, { kind: "NamedType", name: "Int", args: [] });
  eq(fn.body, { kind: "PeriodAccess", parts: ["x"] });
});

test("function with builtin", () => {
  const ast = parse(`add x: $Int > $Int is # nativeAdd;`);
  const fn = ast.body[0] as any;
  eq(fn.body, { kind: "Builtin", name: "nativeAdd" });
});

test("function with protocol constraints", () => {
  const ast = parse(`show $T: ^Show => x: $T > $String is x;`);
  const fn = ast.body[0] as any;
  eq(fn.protocols[0].name, "T");
  eq(fn.protocols[0].body.kind, "ProtocolDefinitionBody");
});

test("zero-param function", () => {
  const ast = parse(`greet > $String is "hello";`);
  const fn = ast.body[0] as any;
  eq(fn.params, []);
  eq(fn.body, { kind: "StringLiteral", value: "hello" });
});

// ============================================================
console.log("\n=== Parser: expressions ===");
// ============================================================

test("if-then-else", () => {
  const ast = parse(`f > $Bool is if true then x else y;`);
  const fn = ast.body[0] as any;
  eq(fn.body.kind, "IfExpression");
  eq(fn.body.condition, { kind: "BoolLiteral", value: true });
});

test("nested if", () => {
  const ast = parse(`f > $Bool is if a then if b then c else d else e;`);
  const fn = ast.body[0] as any;
  eq(fn.body.then.kind, "IfExpression");
});

test("block expression", () => {
  const src = `f > $Int is do { x } where { x = 1 };`;
  const ast = parse(src);
  const fn = ast.body[0] as any;
  eq(fn.body.kind, "BlockExpression");
  eq(fn.body.final, { kind: "PeriodAccess", parts: ["x"] });
  eq(fn.body.bindings[0].name, "x");
});

test("block expression with stmt and break", () => {
  const src = `f > $Unit is do { foo; break bar; baz } where {};`;
  const ast = parse(src);
  const fn = ast.body[0] as any;
  eq(fn.body.stmts.map((s: any) => s.kind), ["Stmt", "Break"]);
});

test("call expression", () => {
  const ast = parse(`f > $Int is add 1 2;`);
  const fn = ast.body[0] as any;
  // add 1 2  =>  (add 1) 2  =>  CallExpression(CallExpression(add, 1), 2)
  eq(fn.body.kind, "CallExpression");
  eq(fn.body.arg, { kind: "NumberLiteral", value: "2" });
  eq(fn.body.callee.kind, "CallExpression");
  eq(fn.body.callee.arg, { kind: "NumberLiteral", value: "1" });
});

test("struct literal", () => {
  const ast = parse(`f > $Point is Point { x = 1 y = 2 };`);
  const fn = ast.body[0] as any;
  eq(fn.body.kind, "StructLiteral");
  eq(fn.body.name, "Point");
  eq(fn.body.fields.map((f: any) => f.name), ["x", "y"]);
});

test("enum literal", () => {
  const ast = parse(`f > $Option is Some(42);`);
  const fn = ast.body[0] as any;
  eq(fn.body.kind, "EnumLiteral");
  eq(fn.body.name, "Some");
  eq(fn.body.value, { kind: "NumberLiteral", value: "42" });
});

test("period access", () => {
  const ast = parse(`f > $Int is a.b.c;`);
  const fn = ast.body[0] as any;
  eq(fn.body, { kind: "PeriodAccess", parts: ["a", "b", "c"] });
});

test("paren expression", () => {
  const ast = parse(`f > $Int is (42);`);
  const fn = ast.body[0] as any;
  eq(fn.body, { kind: "ParenExpression", expr: { kind: "NumberLiteral", value: "42" } });
});

// ============================================================
console.log("\n=== Parser: block comments ===");
// ============================================================

test("comment inside expression is ignored", () => {
  const ast = parse(`f > $Int is /* the answer */ 42;`);
  const fn = ast.body[0] as any;
  eq(fn.body, { kind: "NumberLiteral", value: "42" });
});

test("comment in type definition is ignored", () => {
  const ast = parse(`$/* type */ Foo is $Int;`);
  const def = ast.body[0] as any;
  eq(def.name, "Foo");
});

// ============================================================
console.log("\n=== Parser: error handling ===");
// ============================================================

test("throws ParseError on unexpected token", () => {
  try { parse(`$Foo is;`); throw new Error("no error"); }
  catch (e) { if (!(e instanceof ParseError) && !(e instanceof LexError)) throw e; }
});

test("throws LexError on bad char", () => {
  try { parse(`$Foo is @;`); throw new Error("no error"); }
  catch (e) { if (!(e instanceof LexError)) throw e; }
});

// ============================================================
console.log("\n=== Summary ===");
// ============================================================
console.log(`  Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) process.exit(1);
