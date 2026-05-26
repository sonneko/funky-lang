# Expressions

In Funky, almost everything is an expression that returns a value.

## Conditional Expression (`if`)
The `if` expression requires both `then` and `else` branches.

```
if condition then true_value else false_value
```

## Loop Expression (`loop`)
The `loop` expression repeatedly evaluates an expression.

```
loop do {
    if stop then break 0 else continue
} where { ... }
```

## Block Expression (`do-where`)
The `do-where` block allows for a sequence of expressions with local bindings.

```
do {
    expr1;
    expr2;
    result_expr
} where {
    var1 : $Type = val1
    var2 = val2
}
```
Bindings in the `where` clause are available within the `do` block. The last expression in the `do` block is the result of the entire block.

### Break
The `break` keyword can be used to exit a loop with a value.

```
break expression
```

## Literals
- **Literal**: Numbers, strings, etc.
- **Struct Literal**: `TypeName { field1 = expr1 field2 = expr2 }`
- **Enum Literal**: `VariantName(expression)`

## Period Access
Fields and methods are accessed using the `.` notation.

```
point.x
```

This can also be used for chaining: `a.b.c`.
