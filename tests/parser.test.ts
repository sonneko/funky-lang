import { Lexer } from "../src/lexer.js";
import { Parser } from "../src/parser.js";

function test(name: string, code: string) {
    try {
        const lexer = new Lexer(code);
        const tokens = lexer.tokenize();
        console.log(`Tokens for ${name}:`, tokens.map(t => `${t.type}(${t.value})`).join(" "));
        const parser = new Parser(tokens);
        const ast = parser.parseProgram();
        process.stdout.write(`PASS: ${name}\n`);
    } catch (e: any) {
        process.stdout.write(`FAIL: ${name}\n`);
        process.stdout.write(e.stack || e.message);
        process.stdout.write("\n");
        process.exit(1);
    }
}

test("Block expression with where", `
complexCalc x: $Int > $Int is
    do {
        f x
    } where {
        f = v : $Int > $Int is v
    };
`);
