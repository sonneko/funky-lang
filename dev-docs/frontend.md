# Frontend Design

The frontend is responsible for translating source code into an Abstract Syntax Tree (AST).

## Lexer
The lexer tokenizes the source. Key tokens include:
- Keywords: `using`, `as`, `from`, `is`, `if`, `then`, `else`, `loop`, `do`, `break`, `where`.
- Symbols: `;`, `$`, `^`, `>`, `=>`, `{`, `}`, `|`, `=`, `(`, `)`, `.`, `,`, `:`.
- Identifiers: Alphanumeric strings (with special handling for `$` and `^` prefixes).
- Literals: Numeric and string literals.

## Parser
The parser uses a recursive descent or a parser combinator approach to build the AST according to the grammar rules.

### AST Structures
- `Program`: List of `TopLevel`.
- `TopLevel`: `Using`, `Function`, `TypeDefinition`, `ProtocolDefinition`.
- `Expression`: `If`, `Loop`, `Call`, `Block`, `Literal`, `StructLiteral`, `EnumLiteral`, `Access`.
- `TypeLiteral`: `StructBody`, `EnumBody`, `FnBody`, `TypeReference`.

## `do-where` Block Handling
The `do-where` block requires careful parsing to associate the bindings in `where` with the expressions in `do`.

## Protocol Definitions
Protocols are parsed into structures that represent the required function signatures and any composed protocols.
