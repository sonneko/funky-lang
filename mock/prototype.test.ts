import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { compile, run } from "./compiler.ts";
import { parse } from "./parser.ts";
import { transpile } from "./transpile.ts";

const examples = "examples/draft-0.2";
const readExample = (name: string) => readFileSync(`${examples}/${name}`, "utf8");

for (const file of [...readdirSync(examples).filter(x => x.endsWith(".funky")), ...readdirSync(`${examples}/modules`).filter(x => x.endsWith(".funky")).map(x => `modules/${x}`)]) {
  test(`Draft example parses: ${file}`, () => { assert.ok(parse(readExample(file)).body.length > 0); });
}

test("records, transparent aliases, generics, currying, and lazy values execute", () => {
  const source = `${readExample("01-records-and-currying.funky")}\nmain > $Int is answer;`;
  assert.equal(run(source), 42n);
});

test("List, closure capture, map/filter/foldLeft, and printLine execute", () => {
  const output: string[] = [];
  const result = run(readExample("02-collections.funky"), { printLine: x => output.push(x) });
  assert.equal(result, undefined);
  assert.deepEqual(output, ["sum of doubled evens: 24"]);
});

test("effectful I/O, Result match, for, and trim execute", () => {
  const output: string[] = [];
  run(readExample("03-file-processing.funky"), { readText: () => "  first  \nsecond\n", printLine: x => output.push(x) });
  assert.deepEqual(output, ["first", "second", ""]);
});

test("prelude Eq resolves nested List, Option, and Result dictionaries", () => {
  const source = `success > $Result<$Int $String> is Ok(1); main > $Int is if and (eq [1, 2] [1, 2]) (and (eq Some(1) Some(1)) (eq success success)) then 0 else 1;`;
  assert.equal(run(source), 0n);
});

test("protocol instances dispatch statically for Eq and Show", () => {
  const source = readExample("04-protocols.funky")
    .replace('using concat intToString from "std/text";', 'using concat intToString from "std/text"; using printLine from "std/io";')
    .replace("main > $Int is if samePoint origin origin then 0 else 1;", 'main >! $Unit is printLine (if samePoint origin origin then originLabel else "bad");');
  const output: string[] = [];
  assert.equal(run(source, { printLine: x => output.push(x) }), undefined);
  assert.deepEqual(output, ["0,0"]);
});

test("generic instances resolve their own constrained dictionaries", () => {
  const source = `
    $Box is $T => { value = $T };
    instance $T: ^Eq => ^Eq for $Box<$T> is {
      equal left right is eq left.value right.value;
    };
    main > $Int is if eq Box { value = 7 } Box { value = 7 } then 0 else 1;
  `;
  assert.equal(run(source), 0n);
});

test("composed protocols resolve inherited dictionaries and methods", () => {
  const source = `
    using concat intToString from "std/text";
    using printLine from "std/io";
    ^Show is { show = $Self > $String };
    ^Display is ^Show + ^Eq;
    $Point is { x = $Int };
    instance ^Display for $Point is {
      show point is intToString point.x;
      equal left right is eq left.x right.x;
    };
    display $T: ^Display => value: $T > $String is show value;
    main >! $Unit is printLine (display Point { x = 12 });
  `;
  const output: string[] = [];
  assert.equal(run(source, { printLine: x => output.push(x) }), undefined);
  assert.deepEqual(output, ["12"]);
});

test("JSON constructors, parse, Option, and nested match execute", () => {
  const output: string[] = [];
  run(readExample("05-json-config.funky"), { readText: () => '{"theme":"dark"}', printLine: x => output.push(x) });
  assert.deepEqual(output, ["theme: dark"]);
});

test("record patterns and Boolean matches are exhaustive expressions", () => {
  const source = `
    $Point is { x = $Int y = $Int };
    describe point: $Point > $Int is match point is { | Point { x = value } => value; };
    main > $Int is if match true is { | true => true; | false => false; } then describe Point { x = 7 y = 9 } else 0;
  `;
  assert.equal(run(source), 7n);
});

test("generic enums construct, match, and retain nominal brands", () => {
  const source = `
    $Maybe is $T => | Just = $T Empty = $Unit |;
    unwrap value: $Maybe<$Int> > $Int is match value is { | Just(number) => number; | Empty => 0; };
    main > $Int is unwrap Just(42);
  `;
  assert.equal(run(source), 42n);
  const sameShape = `$A is | Red = $Unit |; $B is | RedB = $Unit |; cast value: $A > $B is value;`;
  assert.throws(() => compile(sameShape), /type mismatch|not assignable/);
});

test("generic aliases to records preserve substituted constructor types", () => {
  const source = `
    $Box is $T => { value = $T };
    $IntBox is $Box<$Int>;
    $BoxList is $T => $Box<$List<$T>>;
    fixed > $IntBox is IntBox { value = 42 };
    wrap $T => value: $T > $BoxList<$T> is BoxList { value = [value] };
    main > $Int is fixed.value;
  `;
  assert.equal(run(source), 42n);
  assert.match(compile(source).typescript, /type IntBox = Box<bigint>/);
});

test("where supports recursive lazy closures and top-level cycles are diagnosed", () => {
  const factorial = `main > $Int is do { factorial 5 } where { factorial = fn n: $Int > $Int is if le n 1 then 1 else mul n (factorial (sub n 1)); };`;
  const parity = `main > $Int is do { if even 10 then 0 else 1 } where { even = fn n: $Int > $Bool is if eq n 0 then true else odd (sub n 1); odd = fn n: $Int > $Bool is if eq n 0 then false else even (sub n 1); };`;
  assert.equal(run(factorial), 120n);
  assert.equal(run(parity), 0n);
  assert.throws(() => run(`first > $Int is second; second > $Int is first; main > $Int is first;`), /cyclic lazy value/);
});

test("where declarations may omit separators when the next binding is unambiguous", () => {
  const source = `main > $Int is do { add first second } where { first = 20 second = 22 };`;
  assert.equal(run(source), 42n);
});

test("string escapes decode quotes, controls, and Unicode scalar values", () => {
  const source = `using printLine from "std/io"; main >! $Unit is printLine "quote: \\\" slash: \\\\ line: \\n bulb: \\u{1F4A1}";`;
  const output: string[] = [];
  run(source, { printLine: x => output.push(x) });
  assert.deepEqual(output, ['quote: " slash: \\ line: \n bulb: 💡']);
});

test("do break returns early and where bindings are available", () => {
  const source = `main > $Int is do { value <- 3; break add value increment; 99 } where { increment: $Int = 2; };`;
  assert.equal(run(source), 5n);
});

test("standard using aliases and JSON entry records are supported", () => {
  const source = `
    using Object Text stringify from "std/json";
    using concat intToString as showInt from "std/text";
    using printLine from "std/io";
    document > $Json is Object([JsonEntry { key = "answer" value = Text(showInt 42) }]);
    main >! $Unit is printLine (concat (stringify document) "!");
  `;
  const output: string[] = [];
  assert.equal(run(source, { printLine: x => output.push(x) }), undefined);
  assert.deepEqual(output, ['{"answer":"42"}!']);
});

test("standard module aliases work for types, record factories, constructors, and patterns", () => {
  const source = `
    using Json as Value JsonEntry as Entry Object as Obj Text as Str stringify as encode jsonField from "std/json";
    using printLine from "std/io";
    document > $Value is Obj([Entry { key = "greeting" value = Str("hello") }]);
    main >! $Unit is printLine (match jsonField "greeting" document is { | Some(Str(text)) => text; | _ => "missing"; });
  `;
  const output: string[] = [];
  assert.equal(run(source, { printLine: x => output.push(x) }), undefined);
  assert.deepEqual(output, ["hello"]);
});

test("Text and List standard functions must be imported", () => {
  assert.throws(() => compile(`bad > $String is concat "a" "b";`), /must be imported from std\/text/);
});

test("main is constrained to a zero-argument Unit or Int value", () => {
  assert.throws(() => compile(`main value: $Int > $Unit is ();`), /zero-parameter/);
  assert.throws(() => compile(`main > $String is "oops";`), /must return \$Unit or \$Int/);
});

test("TypeScript catches nominal mismatches", () => {
  const source = `$Point is { x = $Int }; $Pixel is { x = $Int }; bad point: $Point > $Pixel is point;`;
  assert.throws(() => compile(source), /type mismatch|not assignable/);
});

test("Never is usable as the bottom result type", () => {
  const source = `unreachable > $Never is # crash; use > $Int is unreachable; choose condition: $Bool > $Int is if condition then unreachable else 1; main > $Int is use;`;
  assert.doesNotThrow(() => compile(source));
  assert.throws(() => compile(`invalid > $Never is 1;`), /not assignable|type .* not assignable/);
  assert.throws(() => compile(`wrongArgumentType > ($Int > $Int) is fn value: $Never > $Int is 0;`), /not assignable/);
});

test("numeric separators normalize and numeric bounds are checked", () => {
  assert.equal(run(`main > $Int is 00042;`), 42n);
  assert.throws(() => compile(`main > $Int is 9223372036854775808;`), /signed 64-bit range/);
  assert.throws(() => compile(`overflow > $Float is 1e999;`), /finite binary64 range/);
});

test("non-exhaustive and unreachable match arms are rejected", () => {
  assert.throws(() => transpile(parse(`main > $Int is match true is { | true => 1; };`)), /non-exhaustive/);
  assert.throws(() => compile(`main > $Int is match true is { | true => 1; | false => 0; | _ => 2; };`), /unreachable/);
  assert.throws(() => compile(`main > $Int is match Some(1) is { | Some(_) => 1; | Some(1) => 2; | None => 0; };`), /unreachable/);
  assert.throws(() => compile(`$P is { x = $Int }; main > $Int is match P { x = 1 } is { | P { x = _ } => 1; | P { x = 1 } => 2; };`), /unreachable/);
});

test("hidden effects are rejected", () => {
  assert.throws(() => compile(`using printLine from "std/io"; bad > $Unit is printLine "hidden";`), /pure function bad/);
});

test("effects cannot be hidden in where bindings, local functions, instances, or native declarations", () => {
  const usingIo = `using printLine from "std/io"; `;
  assert.throws(() => compile(`${usingIo} bad > $Unit is do { action "hidden"; () } where { action = printLine; };`), /pure function bad/);
  assert.throws(() => compile(`${usingIo} bad > $Unit is do { () } where { value = printLine "hidden"; };`), /where binding value must be pure/);
  assert.throws(() => compile(`${usingIo} ^Logger is { log = $Self > $Unit }; $Thing is {}; instance ^Logger for $Thing is { log thing is printLine "hidden"; };`), /pure protocol method log/);
  assert.throws(() => compile(`printLine text: $String > $Unit is # stdPrintLine;`), /must use >!/);
});

test("effectful callbacks cannot be passed to pure map", () => {
  const source = `using map from "std/list"; using printLine from "std/io"; main >! $Unit is do { values <- map (fn x: $Int >! $Unit is printLine "x") [1]; () } where {};`;
  assert.throws(() => compile(source), /effect mismatch|pure lambda/);
});

test("runtime timeout also covers the main entry and recursive calls", () => {
  const source = `loop n: $Int > $Int is loop (add n 1); main > $Int is loop 0;`;
  assert.throws(() => run(source, { timeout: 50 }), /timed out|Maximum call stack size exceeded/);
});

test("empty-separator split counts Unicode scalar values", () => {
  const source = `using split from "std/text"; using length from "std/list"; main > $Int is length (split "" "💡a");`;
  assert.equal(run(source), 2n);
});

test("JSON rejects values outside the finite Float range", () => {
  const source = `using parseJson from "std/json"; main > $Int is if match parseJson "1e999" is { | Err(_) => true; | Ok(_) => false; } then 0 else 1;`;
  assert.equal(run(source), 0n);
});

test("external module linking is the one unsupported using feature", () => {
  assert.throws(() => compile(`using Point from "./geometry.funky"; main > $Int is 0;`), /external using is not supported/);
});
