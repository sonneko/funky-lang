import * as fs from "fs";
import * as path from "path";
import * as peggy from "peggy";
import { transpile } from "./transpiler";
import { execSync } from "child_process";

const grammar = fs.readFileSync(path.join(__dirname, "funky.pegjs"), "utf8");
const parser = peggy.generate(grammar);

const inputFile = process.argv[2];
if (!inputFile) {
  console.error("Usage: ts-node src/index.ts <input.funky>");
  process.exit(1);
}

const input = fs.readFileSync(inputFile, "utf8");
try {
  const ast = parser.parse(input);
  const tsCode = transpile(ast);

  const prelude = `
const __intrinsic_print = (x: any) => { console.log(x); return x; };
const __intrinsic_add = (x: number) => (y: number) => x + y;
const __intrinsic_sub = (x: number) => (y: number) => x - y;
`;

  const outputTsPath = inputFile.replace(/\.funky$/, ".ts");
  fs.writeFileSync(outputTsPath, prelude + tsCode);

  console.log(`Transpiled to ${outputTsPath}`);

  // Try to run it if it's a main-like file or just run it anyway
  console.log("Running...");
  execSync(`npx ts-node ${outputTsPath}`, { stdio: "inherit" });

} catch (e: any) {
  if (e.location) {
    console.error(`Parse error at line ${e.location.start.line}, column ${e.location.start.column}: ${e.message}`);
  } else {
    console.error(e);
  }
  process.exit(1);
}
