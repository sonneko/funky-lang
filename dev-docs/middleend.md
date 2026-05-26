# Middle-end Design

The middle-end handles semantic analysis, transforming the AST into a fully-typed HIR (High-level IR) and resolving all symbolic and structural requirements.

## Pipeline

1. **Lowering (AST -> HIR)**: Translates the raw AST into the HIR, performing initial name resolution and building the symbol table.
2. **Type Inference**: Uses the HIR to infer types for all expressions using a constraint-based unification algorithm.
3. **Protocol Resolution**: Ensures that structural types and generic parameters satisfy their respective protocol constraints as defined in the HIR.
4. **Validation**: Checks for errors such as ambiguous protocol adherence or cyclic type definitions.

## HIR and Semantic Analysis
The HIR (see [HIR Design](./ir_design.md)) is specifically optimized for these tasks:
- **Symbol Maps**: Allow for fast lookup of definitions during name resolution.
- **Type Slots**: Provide placeholders for the type inference engine.
- **Explicit Protocol Context**: Simplifies the verification of constraints on generic types.

## Output: TAST (Typed AST / Fully Typed HIR)
Once semantic analysis is complete, the HIR is fully populated with types and resolved protocol methods. This "Typed HIR" (or TAST) is then passed to the backend for LLVM IR generation.
