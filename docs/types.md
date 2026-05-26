# Type System

Funky features a strong, static type system with support for structural types, algebraic data types (enums), and generics.

## Type Definitions
New types can be defined using the `$` prefix. These definitions create **nominal types** that can be referenced by name throughout the program.

```
$MyInt is $BuiltinInt;
```

## Structural Types (Structs)
Structs are defined using curly braces `{}`. They represent a record of fields, each with a specific type.

```
$Point is {
    x = $Float
    y = $Float
}
```

### Generic Structs
Structs can declare generic type parameters using the `($ID)* =>` syntax before the body.

```
$Box is $T => {
    value = $T
}
```

## Algebraic Data Types (Enums)
Enums (Sum types) represent a choice between several variants, each optionally carrying a value. They are defined using pipe symbols `||`.

```
$Option is $T => |
    Some = $T
    None = {}
|
```

## Function Types
Function types use the `>` symbol. They are naturally curried, meaning a function of multiple arguments is a sequence of nested functions.

```
$Int > $Int > $Int
```

Functions can also have protocol constraints:
```
$T : ^Show => $T > $String
```

## Generic Type Application
When using a generic type, arguments are passed within angle brackets `< >`.

```
$IntList is $List<$Int>;
```

## Structural vs. Nominal Typing
- **Structural**: Anonymous type bodies `{...}` or `|...|` are matched based on their structure.
- **Nominal**: Types defined with `$ID is ...` are distinct, but may be used as aliases or for creating specific named instances.

## Recursion
Types can be recursive, which is essential for defining data structures like lists or trees.

```
$List is $T => |
    Cons = { head = $T tail = $List<$T> }
    Nil = {}
|
```
