# HIR (High-level Intermediate Representation) Design

The High-level IR (HIR) is an intermediate representation optimized for semantic analysis, including name resolution, type inference, and protocol resolution. It is lowered from the AST and serves as the input for the middle-end.

## Key Design Goals

- **Symbolic Resolution**: HIR replaces string-based identifiers with unique symbol IDs or direct references to definitions.
- **Type Information**: Every node in the HIR has an associated type slot (potentially initially unknown, to be filled by type inference).
- **Protocol Context**: HIR nodes for generic types and functions explicitly track protocol constraints.
- **Structural Normalization**: Struct and enum types are normalized to facilitate structural typing comparisons.

## HIR Structure

### Symbols and Scopes
- **Symbol Table**: A global mapping of unique IDs to their definitions (Top-level functions, types, protocols).
- **Scope Tree**: Represents lexical nesting. Each scope contains a local symbol table for parameters and `do-where` bindings.

### Types
HIR types are represented as:
- `Primitive(kind)`: Built-in types (Int, Float, etc.).
- `Function(params, return)`: Curried function types.
- `Nominal(symbol_id, args)`: User-defined types.
- `StructuralStruct(fields)`: Anonymous struct bodies.
- `StructuralEnum(variants)`: Anonymous enum bodies.
- `GenericParam(param_id, constraints)`: Placeholders for generic types with their protocol requirements.

### Expressions
HIR expressions are similar to AST expressions but decorated:
- `Call(func, arg, call_type)`
- `Binding(symbol_id, type, expr)`
- `ProtocolMethodCall(receiver, method_id, constraints)`: Explicitly handles dispatch.

## Lowering from AST to HIR

1. **Identifier Resolution**: Replace `Identifier(name)` with `Symbol(id)`.
2. **Type Extraction**: Convert `TypeLiteral` AST nodes into HIR `Type` structures.
3. **Binding Desugaring**: Normalize `do-where` blocks into a sequence of bindings followed by a result expression, ensuring all names are uniquely identified.

## Optimization for Type Inference

The HIR is designed to support constraint-based type inference (e.g., Hindley-Milner).
- **Type Variables**: HIR nodes can hold type variables that are unified during inference.
- **Protocol Dispatch Maps**: For every structural access, the HIR tracks which protocol (if any) provides the method, facilitating easier backend lowering.
