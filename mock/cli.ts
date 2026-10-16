import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import { compile, run } from "./compiler.ts";

const cli = new Command().name("funky-ts").description("Funky Draft 0.2 TypeScript prototype").version("0.2.0");

cli.command("check <source>")
  .description("parse, transpile, and type-check a Funky file")
  .action((source: string) => { compile(readFileSync(source, "utf8")); console.log(`${source}: OK`); });

cli.command("compile <source>")
  .description("write generated TypeScript")
  .option("-o, --out <file>", "output TypeScript file")
  .action((source: string, options: { out?: string }) => {
    const output = options.out ?? source.replace(/\.funky$/, ".generated.ts");
    writeFileSync(output, compile(readFileSync(source, "utf8")).typescript);
    console.log(`wrote ${resolve(output)}`);
  });

cli.command("run <source> [args...]")
  .description("compile and run main")
  .option("--cwd <directory>", "working directory for std/io", process.cwd())
  .action((source: string, args: string[], options: { cwd: string }) => {
    const result = run(readFileSync(source, "utf8"), { cwd: options.cwd, args });
    if (typeof result === "bigint") {
      if (result < 0n || result > 255n) throw new RangeError("main Int result must be between 0 and 255");
      process.exitCode = Number(result);
    }
  });

try {
  await cli.parseAsync(process.argv);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
