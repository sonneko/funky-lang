# Expressions

In Funky, almost everything is an expression that returns a value.

## Conditional Expression (`if`)
The `if` expression requires both `then` and `else` branches. Both branches must return the same type.

```
if condition then true_value else false_value
```

## Loop Expression (`loop`)
The `loop` expression repeatedly evaluates its inner expression. It typically returns the value provided by a `break` expression.

```
loop do {
    if stop then break 0 else 1
} where { ... }
```

## Block Expression (`do-where`)
The `do-where` block provides a way to sequence expressions and define local bindings.

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

### Scoping and Bindings
- Bindings in the `where` clause are lexically scoped to the `do` block and the `where` clause itself (allowing for recursive or interdependent bindings).
- The `do` block contains a sequence of expressions. All but the last must be followed by a semicolon.
- The value of the last expression is the value of the entire `do-where` block.

## Break Expression
The `break` keyword is followed by an expression. It is used to exit the nearest enclosing `loop` and provides the loop's return value.

```
break expression
```
Note: While the grammar allows `break` within any `do` block, its semantic meaning is tied to loop termination.

## Literals and Construction
- **Literal**: Basic values like integers, floats, or strings.
- **Struct Literal**: `TypeName { field1 = expr1 field2 = expr2 }` initializes a struct.
- **Enum Literal**: `VariantName(expression)` constructs an enum variant.

## Period Access
Used for field access or accessing functions associated with a type/protocol.

```
point.x
```
Chaining is supported: `person.address.city`.
