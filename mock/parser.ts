import { readFileSync } from "node:fs";
import peggy from "peggy";
import type { Program } from "./ast.ts";

const parser = peggy.generate(readFileSync(new URL("./funky.peggy", import.meta.url), "utf8"), { grammarSource: "Funky Draft 0.2" });

export class FunkySyntaxError extends Error {
  readonly line?: number;
  readonly column?: number;
  constructor(message: string, line?: number, column?: number) {
    super(line ? `${message} at ${line}:${column}` : message);
    this.name = "FunkySyntaxError";
    this.line = line;
    this.column = column;
  }
}

export function parse(source: string): Program {
  try {
    return parser.parse(source) as Program;
  } catch (error) {
    const e = error as { message?: string; location?: { start?: { line?: number; column?: number } } };
    throw new FunkySyntaxError(e.message ?? String(error), e.location?.start?.line, e.location?.start?.column);
  }
}
