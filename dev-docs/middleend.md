# Middle-end Design

The middle-end handles semantic analysis, including name resolution and type checking.

## Name Resolution
- Maps identifiers to their definitions.
- Handles scoping for `do-where` blocks and function parameters.
- Processes `using` statements to bring external names into scope.

## Type System Implementation
The type checker must handle:
- **Structural Typing**: Checking if two struct types are compatible based on their fields.
- **Algebraic Data Types**: Managing enum variants and pattern matching (implied by enum literals).
- **Curried Functions**: Validating function applications and partial applications.
- **Generics**: Implementing Hindley-Milner or a similar type inference algorithm with support for constrained polymorphism.

## Protocol Resolution
- Ensures that types satisfy the protocols they are constrained by.
- Handles protocol composition (`^A + ^B`).
- Supports the `$` prefix for generic type parameters and their constraints.

## Typed AST (TAST)
After semantic analysis, the AST is transformed into a Typed AST, where every expression and definition has an associated type. This TAST is used for backend code generation.
