# Compiler Architecture

The Funky compiler is built using Rust and leverages LLVM for code generation.

## Overall Pipeline

1. **Lexer**: Converts the source code into a stream of tokens.
2. **Parser**: Consumes tokens and builds an Abstract Syntax Tree (AST) based on the grammar.
3. **Name Resolution**: Resolves identifiers, handles imports, and manages scopes.
4. **Type Checking & Protocol Resolution**: Performs static type analysis and ensures protocol constraints are met.
5. **Intermediate Representation (Typed AST)**: An AST decorated with type information.
6. **LLVM IR Generation**: Translates the Typed AST into LLVM Intermediate Representation.
7. **Optimization & Code Gen**: Uses LLVM to optimize the IR and produce machine code.

## Implementation Language: Rust
Rust was chosen for its performance, safety features, and excellent ecosystem (e.g., `inkwell` or `llvm-sys` for LLVM bindings, `nom` or `chumsky` for parsing).

## Backend: LLVM
LLVM provides a robust framework for optimization and support for various target architectures.
