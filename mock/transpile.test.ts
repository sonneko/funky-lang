import { parse } from "./parser.ts";
import { transpile } from "./transpile.ts";

// ---- helpers ----

let passed = 0, failed = 0;

function test(name: string, fn: () => void) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}:\n    ${(e as Error).message}`); failed++; }
}

function compile(src: string): string {
  return transpile(parse(src));
}

function contains(output: string, expected: string) {
  if (!output.includes(expected)) {
    throw new Error(`Expected output to contain:\n  ${expected}\nGot:\n${output}`);
  }
}

function notContains(output: string, unexpected: string) {
  if (output.includes(unexpected)) {
    throw new Error(`Expected output NOT to contain: ${unexpected}\nGot:\n${output}`);
  }
}

// ============================================================
console.log("\n=== using → import ===");
// ============================================================

test("simple import", () => {
  const out = compile(`using foo from "mylib";`);
  contains(out, `import { foo } from "mylib";`);
});

test("import with alias", () => {
  const out = compile(`using alpha as a from "lib";`);
  contains(out, `import { alpha as a } from "lib";`);
});

test("import multiple names", () => {
  const out = compile(`using foo bar baz from "lib";`);
  contains(out, `import { foo, bar, baz } from "lib";`);
});

test("import mixed alias", () => {
  const out = compile(`using foo as f bar from "lib";`);
  contains(out, `import { foo as f, bar } from "lib";`);
});

// ============================================================
console.log("\n=== type definitions: struct ===");
// ============================================================

test("simple struct", () => {
  const out = compile(`$Point is { x = $Int y = $Int };`);
  contains(out, `export type Point = { x: number; y: number };`);
});

test("struct with type params", () => {
  const out = compile(`$Pair is $A $B => { first = $A second = $B };`);
  contains(out, `export type Pair<A, B> = { first: A; second: B };`);
});

test("empty struct", () => {
  const out = compile(`$Unit is {};`);
  contains(out, `export type Unit = {  };`);
});

// ============================================================
console.log("\n=== type definitions: enum ===");
// ============================================================

test("simple enum", () => {
  const out = compile(`$Color is | Red = $Unit Green = $Unit Blue = $Unit |;`);
  contains(out, `{ tag: "Red"; value: void }`);
  contains(out, `{ tag: "Green"; value: void }`);
  contains(out, `{ tag: "Blue"; value: void }`);
});

test("generic enum", () => {
  const out = compile(`$Option is $T => | Some = $T None = $Unit |;`);
  contains(out, `export type Option<T> =`);
  contains(out, `{ tag: "Some"; value: T }`);
  contains(out, `{ tag: "None"; value: void }`);
});

test("result enum", () => {
  const out = compile(`$Result is $T $E => | Ok = $T Err = $E |;`);
  contains(out, `export type Result<T, E> =`);
  contains(out, `{ tag: "Ok"; value: T }`);
  contains(out, `{ tag: "Err"; value: E }`);
});

// ============================================================
console.log("\n=== type definitions: named alias ===");
// ============================================================

test("type alias to builtin", () => {
  const out = compile(`$MyInt is $Int;`);
  contains(out, `export type MyInt = number;`);
});

test("type alias to other type", () => {
  const out = compile(`$Foo is $Bar;`);
  contains(out, `export type Foo = Bar;`);
});

test("generic type alias", () => {
  const out = compile(`$Foo is $List<$Int>;`);
  contains(out, `export type Foo = Array<number>;`);
});

// ============================================================
console.log("\n=== protocol definitions ===");
// ============================================================

test("protocol with method", () => {
  const out = compile(`^Show is { show = $T > $String };`);
  contains(out, `export interface Show<T> {`);
  contains(out, `show:`);
});

test("protocol literal alias", () => {
  const out = compile(`^Display is ^Show;`);
  contains(out, `export type Display<T> = Show<T>;`);
});

test("protocol combination", () => {
  const out = compile(`^ShowEq is ^Show + ^Eq;`);
  contains(out, `export type ShowEq<T> = Show<T> & Eq<T>;`);
});

// ============================================================
console.log("\n=== function declarations ===");
// ============================================================

test("zero-param function (constant)", () => {
  const out = compile(`greet > $String is "hello";`);
  contains(out, `export const greet: string = "hello";`);
});

test("single-param function", () => {
  const out = compile(`double x: $Int > $Int is x;`);
  contains(out, `export const double = (x: number): number => x`);
});

test("two-param curried function", () => {
  const out = compile(`add x: $Int y: $Int > $Int is x;`);
  contains(out, `export const add = (x: number) => (y: number): number => x`);
});

test("three-param curried function", () => {
  const out = compile(`f a: $Int b: $Int c: $Int > $Int is a;`);
  contains(out, `(a: number) =>`);
  contains(out, `(b: number) =>`);
  contains(out, `(c: number): number =>`);
});

test("builtin function (#)", () => {
  const out = compile(`add x: $Int y: $Int > $Int is # nativeAdd;`);
  contains(out, `declare const nativeAdd:`);
  contains(out, `export const add = nativeAdd;`);
});

test("function with protocol constraint", () => {
  const out = compile(`show $T: ^Show => x: $T > $String is x;`);
  contains(out, `export const show = <T extends`);
  contains(out, `(x: T): string =>`);
});

// ============================================================
console.log("\n=== expressions ===");
// ============================================================

test("if-then-else", () => {
  const out = compile(`f x: $Bool > $Int is if x then 1 else 2;`);
  contains(out, `(x ? 1 : 2)`);
});

test("nested if", () => {
  const out = compile(`f x: $Bool > $Int is if x then if x then 1 else 2 else 3;`);
  contains(out, `(x ? (x ? 1 : 2) : 3)`);
});

test("call expression", () => {
  const out = compile(`f > $Int is add 1 2;`);
  // add 1 2 → (add(1))(2)
  contains(out, `add(1)(2)`);
});

test("period access", () => {
  const out = compile(`f x: $Point > $Int is x.y.z;`);
  contains(out, `x.y.z`);
});

test("paren expression", () => {
  const out = compile(`f > $Int is (42);`);
  contains(out, `(42)`);
});

test("struct literal", () => {
  const out = compile(`f > $Point is Point { x = 1 y = 2 };`);
  contains(out, `{ x: 1, y: 2 }`);
  contains(out, `as Point`);
});

test("empty struct literal", () => {
  const out = compile(`f > $Unit is Unit {};`);
  contains(out, `{} as Unit`);
});

test("enum literal Some", () => {
  const out = compile(`f > $Option is Some(42);`);
  contains(out, `{ tag: "Some", value: 42 }`);
});

test("enum literal wrapping string", () => {
  const out = compile(`f > $Option is Err("oops");`);
  contains(out, `{ tag: "Err", value: "oops" }`);
});

test("bool literal true", () => {
  const out = compile(`f > $Bool is true;`);
  contains(out, `= true`);
});

test("bool literal false", () => {
  const out = compile(`f > $Bool is false;`);
  contains(out, `= false`);
});

test("string literal", () => {
  const out = compile(`f > $String is "hello world";`);
  contains(out, `"hello world"`);
});

test("number literal", () => {
  const out = compile(`f > $Int is 42;`);
  contains(out, `= 42`);
});

// ============================================================
console.log("\n=== block / do-where ===");
// ============================================================

test("block with where binding", () => {
  const out = compile(`f > $Int is do { x } where { x = 1 };`);
  contains(out, `(() => {`);
  contains(out, `const x = 1;`);
  contains(out, `return x;`);
  contains(out, `})()`);
});

test("block with typed binding", () => {
  const out = compile(`f > $Int is do { x } where { x: $Int = 42 };`);
  contains(out, `const x: number = 42;`);
});

test("block with statement", () => {
  const out = compile(`f > $Int is do { foo; 1 } where {};`);
  contains(out, `foo;`);
  contains(out, `return 1;`);
});

test("block with break → return", () => {
  const out = compile(`f > $Int is do { break 99; 0 } where {};`);
  contains(out, `return 99;`);
  contains(out, `return 0;`);
});

test("block multiple bindings", () => {
  const out = compile(`f > $Int is do { x } where { x = 1 y = 2 };`);
  contains(out, `const x = 1;`);
  contains(out, `const y = 2;`);
});

// ============================================================
console.log("\n=== integration: full program ===");
// ============================================================

test("full program: option type + map function", () => {
  const src = `
    $Option is $T => | Some = $T None = $Unit |;
    map f: $Int x: $Option > $Option is
      if x.tag then Some(f x.value) else None(false);
  `;
  const out = compile(src);
  contains(out, `export type Option<T> =`);
  contains(out, `{ tag: "Some"; value: T }`);
  contains(out, `export const map =`);
});

test("full program: using + builtin + wrapper", () => {
  const src = `
    using console from "node:console";
    log msg: $String > $Unit is # consoleLog;
  `;
  const out = compile(src);
  contains(out, `import { console } from "node:console";`);
  contains(out, `declare const consoleLog:`);
  contains(out, `export const log = consoleLog;`);
});

test("full program: struct + constructor function", () => {
  const src = `
    $Vec2 is { x = $Float y = $Float };
    zero > $Vec2 is Vec2 { x = 0 y = 0 };
    add a: $Vec2 b: $Vec2 > $Vec2 is Vec2 { x = a.x y = b.y };
  `;
  const out = compile(src);
  contains(out, `export type Vec2 = { x: number; y: number };`);
  contains(out, `export const zero: Vec2 =`);
  contains(out, `export const add =`);
  contains(out, `{ x: a.x, y: b.y }`);
});

// ============================================================
console.log("\n=== Summary ===");
// ============================================================
console.log(`  Total: ${passed + failed}  Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) process.exit(1);
