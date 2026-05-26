# Backend Design

The backend translates the Typed AST into LLVM IR.

## Type Mapping
- **Structs**: Mapped to LLVM literal or identified struct types.
- **Enums**: Mapped to a tagged union (typically a struct containing an integer tag and a union/buffer for the largest variant).
- **Functions**: Mapped to LLVM function definitions. Currying may be implemented via closure conversion or by generating specialized functions.

## Expression Lowering
- **`if`**: Lowered to LLVM branch instructions.
- **`loop`**: Lowered to a set of basic blocks with a backward branch.
- **`do-where`**: Lowered by first evaluating the `where` bindings and then the `do` expressions.
- **`call`**: Mapped to LLVM `call` instructions.

## Protocol Implementation (vtable/dict)
Since Funky uses protocols, the backend must support dynamic dispatch or specialization:
- **Monomorphization**: Generating specialized code for each concrete type used with a generic function (similar to Rust).
- **Dictionary Passing**: Passing a table of function pointers (vtable) for protocol methods.

## Intrinsic Functions (`#identifier`)
Intrinsics are directly mapped to specific LLVM IR sequences or calls to a runtime library (e.g., `#add_int` becomes an `add` instruction).

## Memory Management
The initial implementation may use a simple heap allocation strategy or integrate with a garbage collector (like Boehm GC) if necessary for closures and dynamic data.
