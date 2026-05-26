# Functions

Functions are a core part of Funky. They support multiple parameters, protocol constraints, and currying.

## Function Definition
A function is defined with its name, optional protocol requirements, parameter list, and a body.

```
add x:$Int y:$Int > $Int is ...;
```

### Protocol Requirements
Functions can specify requirements on their generic parameters using the `$identifier: protocol_body =>` syntax.

```
sum $T: { add = $T > $T > $T } => a:$T b:$T > $T is
    a.add b;
```

### Parameters
Parameters are defined as `identifier: type`. The parameter list ends with `>` followed by the return type.

```
identity x:$T > $T is x;
```

### Function Body
The body of a function can be an expression or a reference to an intrinsic/builtin function prefixed with `#`.

```
add_integers x:$Int y:$Int > $Int is #add_int;
```

## Function Calls
Function calls are performed by placing a primary expression after an expression.

```
f x
```

Since functions are curried, a multi-argument call looks like:

```
add 1 2
```

This is equivalent to `(add 1) 2`.

## Closures and First-Class Functions
Functions can be passed as arguments and returned from other functions. Their types are represented as `ParamType > ReturnType`.

```
apply_twice f:($Int > $Int) x:$Int > $Int is
    f (f x);
```
