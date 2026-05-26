# Name Resolution and Scoping

This document describes how Funky handles identifiers, imports, and lexical scoping.

## Imports (`using`)
The `using` keyword is used to bring names from other modules or files into the current scope.

```
using <identifier> (as <identifier>)? from <literal>;
```

- **Identifier**: The name to be imported.
- **`as` Alias**: Optional renaming of the imported identifier to avoid conflicts.
- **Literal**: A string literal specifying the source module or file path.

Example:
```
using list as L from "std.collections";
```

## Scoping Rules

### Global Scope
Top-level definitions (functions, types, protocols) are visible throughout the entire module.

### Function Scope
Function parameters are visible only within the body of the function. For curried functions, each parameter adds a new level of nesting in the scope.

```
# x is in scope for the whole body, y is only in scope for the second part
add x:$Int y:$Int > $Int is
    x.add y;
```

### Block Scope (`do-where`)
The `do-where` expression creates a local scope.

```
do {
    # Bindings from 'where' are visible here
} where {
    # Bindings defined here are visible in the 'do' block
    # and also within other bindings in the same 'where' clause.
}
```

- **Shadowing**: Local bindings can shadow identifiers from outer scopes (e.g., global definitions or function parameters).
- **Mutual Recursion**: Bindings within a single `where` clause can be mutually recursive.

## Identifier Categories
- **Type Parameters**: Prefixed with `$` (e.g., `$T`, `$Int`).
- **Protocols**: Prefixed with `^` (e.g., ^Show).
- **Intrinsics**: Prefixed with `#` (e.g., `#add_int`).
- **Variables/Functions**: Standard alphanumeric identifiers.
