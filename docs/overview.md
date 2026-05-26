# Language Overview

Funky is a functional-first language designed with a strong, static type system, structural typing, and protocol-based polymorphism. It is compiled to machine code via LLVM and is implemented in Rust.

## Key Features

- **Functional Foundations**: First-class functions, currying, and expression-based syntax.
- **Advanced Type System**: Structural and nominal typing, sum types (enums), and recursion.
- **Protocols**: Flexible polymorphism through protocol constraints and composition.
- **Clean Local Bindings**: The `do-where` construct for readable procedural-style logic in a functional context.

## A Complete Example

The following example demonstrates a program that defines a protocol, a type, and functions to work with them.

```
# Import functions from the standard library
using std.io as io from "std";

# Define a protocol for types that can be described as strings
^Describe is {
    describe = $Self > $String
};

# Define a generic Option type
$Option is $T => |
    Some = $T
    None = {}
|;

# Define a Person struct
$Person is {
    name = $String
    age = $Int
};

# Define a function with protocol constraints
# It takes a type $T that satisfies ^Describe
print_description $T:^Describe => item:$T > $Unit is
    io.println (item.describe);

# Define a function that uses a do-where block
main > $Int is
    do {
        io.println p.name;
        print_description p;
        0
    } where {
        p : $Person = Person {
            name = "Alice"
            age = 30
        }
    }
```

## Compiler Design
The compiler is written in Rust and uses LLVM as its backend. It performs rigorous type checking and protocol resolution before generating optimized LLVM IR.
