# Language Overview

This document provides a high-level overview of the programming language (referred to as "Funky"). Funky is a functional-first language designed with a strong, static type system, structural typing, and a powerful protocol-based polymorphism.

## Key Features

- **Functional Programming**: Functions are first-class citizens. Expressions are preferred over statements.
- **Structural and Algebraic Data Types**: Easy-to-define structs and enums with structural subtyping or explicit type definitions.
- **Protocol-based Polymorphism**: A flexible protocol system (similar to traits or interfaces) to define shared behavior.
- **Generic Programming**: Type parameters are denoted by the `$` prefix and can be constrained by protocols.
- **Unique Block Expressions**: `do-where` blocks provide a clean way to write procedural-looking code with local bindings.
- **Curried Functions**: Function types and calls support a natural currying syntax.

## Basic Syntax

### Top-level Definitions
A program consists of imports (`using`), function definitions, type definitions, and protocol definitions.

```
using std.io from "std";

$Int is ...;

^Add is {
    add = $Int > $Int > $Int
};

add x:$Int y:$Int > $Int is #add_int;
```

### Functions
Functions are defined with their name, optional protocol constraints, parameters, and a body.

```
identity x:$T > $T is x;
```

### Expressions
Everything is an expression, including `if`, `loop`, and `do` blocks.

```
if condition then true_val else false_val
```

## Compilation
The Funky compiler is implemented in Rust and uses LLVM as the backend to produce efficient machine code.
