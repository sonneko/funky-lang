import { Lexer } from "../src/lexer.js";
import { Parser } from "../src/parser.js";
function test(name, code) {
    try {
        const lexer = new Lexer(code);
        const tokens = lexer.tokenize();
        const parser = new Parser(tokens);
        const ast = parser.parseProgram();
        process.stdout.write(`PASS: ${name}\n`);
    }
    catch (e) {
        process.stdout.write(`FAIL: ${name}\n`);
        process.stdout.write(e.stack || e.message);
        process.stdout.write("\n");
        process.exit(1);
    }
}
test("Simple function", `
add x: $Int y: $Int > $Int is
    #add;
`);
test("Using statement", `
using Math as M from "math-lib";
`);
test("Struct type and literal", `
$Point is { x = $Int y = $Int };
makePoint x: $Int y: $Int > $Point is
    Point { x = x y = y };
`);
test("Enum type and literal", `
$Option $T is | Some = $T None = { } |;
someValue > $Option<$Int> is
    Some(42);
`);
test("If expression", `
max x: $Int y: $Int > $Int is
    if x y then x else y;
`);
test("Block expression with where", `
complexCalc x: $Int > $Int is
    do {
        f x
    } where {
        f = v > $Int is v
    };
`);
test("Curried call", `
add3 x: $Int y: $Int z: $Int > $Int is
    add x y z;
`);
test("Protocol definition", `
^Eq is {
    equals = $T > $T > $Bool
};
`);
test("Generic function with protocol", `
equals $T: ^Eq x: $T y: $T > $Bool is
    x.equals y;
`);
//# sourceMappingURL=parser.test.js.map