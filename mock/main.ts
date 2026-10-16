import { parse } from "./parser";
import { transpile } from "./transpile";

function translate(program: string): string {
    const ast = parse(program);
    const tsCode = transpile(ast);
    return tsCode;
}
