# Draft 0.2 TypeScript prototype

`mock/` is an experimental compiler for [`docs/language-spec.md`](../docs/language-spec.md). It parses Funky, checks the language-level types/effects and generated TypeScript, then can emit TypeScript or execute the checked program. It is separate from the Rust compiler and does not change the Rust CLI.

## Requirements and commands

Node.js 22.6 or newer is required (the prototype runs TypeScript directly using Node's type stripping).

```sh
npm ci
npm test
npm run check:prototype

npm run prototype -- check examples/draft-0.2/02-collections.funky
npm run prototype -- compile examples/draft-0.2/02-collections.funky -o /tmp/collections.ts
npm run prototype -- run examples/draft-0.2/02-collections.funky
```

`run` evaluates the zero-argument `main` value. File I/O is relative to the current working directory; use `--cwd <directory>` to select one. The compiler API (`compile`, `run`, `transpileSource`) is exported from `compiler.ts`; `run` accepts injectable file, output, argument, and native-function capabilities for tests or embedding.

The built-in standard modules are `std/io`, `std/text`, `std/list`, and `std/json`. Their names are imported with `using`; supported declarations and runtime behavior are implemented in the prototype. `using` with a Funky file path is the one intentionally unsupported Draft 0.2 feature: module linking and cross-file instance discovery are not implemented yet.

## Architecture

- `funky.peggy` is the Peggy grammar; `parser.ts` creates the parser from it.
- `ast.ts` defines a discriminated-union AST.
- `transpile.ts` performs prototype type/effect checks, resolves protocol dictionaries, emits TypeScript, and uses the TypeScript compiler API for strict checking.
- `compiler.ts` transpiles to JavaScript and runs it with host capabilities; `cli.ts` is the CLI entry point.
- `prototype.test.ts` exercises the grammar, Draft 0.2 examples, runtime, protocols, effects, and expected diagnostics.

The implementation favors generated native TypeScript types/functions over a separate runtime type system, and uses Peggy, TypeScript, Commander, and Node's built-in test runner to keep tooling and maintenance small.
