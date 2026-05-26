# Type System

Funky features a strong, static type system with support for structural types, algebraic data types (enums), and generics.

## Type Definitions
New types can be defined using the `$` prefix.

```
$MyInt is $BuiltinInt;
```

## Structural Types (Structs)
Structs are defined using curly braces `{}`. They can have optional generic parameters.

```
$Point is {
    x = $Float
    y = $Float
}
```

Generic struct:
```
$Box is $T => {
    value = $T
}
```

## Algebraic Data Types (Enums)
Enums (Sum types) are defined using pipe symbols `||`.

```
$Option is $T => |
    Some = $T
    None = {}
|
```

## Function Types
Function types use the `>` symbol to separate parameters and the return type.

```
$Int > $Int > $Int
```

Functions can also have protocol constraints:
```
$T : ^Show => $T > $String
```

## Generics
Generic parameters are identifiers prefixed with `$`. They can appear in type definitions and function signatures.

```
$List is $T => |
    Cons = { head = $T tail = $List<$T> }
    Nil = {}
|
```

## Type Literals
Type literals can be:
- A structural type body: `{ field = Type }`
- An enum type body: `| Variant = Type |`
- A function type body: `Type > Type`
- A type identifier: `$Identifier` (optionally with generic arguments `<Type1, Type2>`)
