# Protocols

Protocols define a set of required function signatures. They are the primary mechanism for polymorphism and abstraction in Funky.

## Protocol Definition
A protocol is defined with the `^` prefix and contains a list of field names mapped to function types.

```
^Show is {
    to_string = $Self > $String
};
```
Within a protocol, `$Self` (or a similar convention) would typically refer to the type that implements the protocol.

## Protocol Composition
Protocols can be combined using the `+` operator. A type satisfying a composed protocol must satisfy all of its constituent protocols.

```
^EqShow is ^Eq + ^Show;
```

## Constraints
Protocols are used to constrain generic type parameters in functions and type definitions.

### Function Constraints
```
print_all $T:^Show => list:$List<$T> > $Unit is
    #builtin_print_list;
```

### Type Constraints
```
$TreeMap is $K:^Comparable $V => {
    root = $Option<$Node<$K, $V>>
}
```

## Adherence
A type "implements" a protocol if it provides definitions for all the functions listed in the protocol's body. Since Funky uses structural typing for these requirements, no explicit `implements` keyword is needed; if the type has the required structure/fields, it satisfies the protocol.

### Implementation Details
In practice, this is resolved during type checking. For the LLVM backend, this may involve passing "vtable" dictionaries or monomorphizing generic functions.
