# Protocols

Protocols define a set of required functions that a type must implement. They are prefixed with `^`.

## Protocol Definition
A protocol is defined with its name and a body containing function signatures.

```
^Show is {
    to_string = $Self > $String
};
```

## Protocol Composition
Protocols can be composed of other protocols using the `+` operator.

```
^EqShow is ^Eq + ^Show;
```

## Protocol Usage
Protocols are primarily used to constrain generic type parameters.

### In Function Definitions
```
print_it $T:^Show => x:$T > $Unit is
    print (x.to_string);
```

### In Type Definitions
Types can also have protocol constraints on their generic parameters.

```
$SortedList is $T:^Comparable => {
    elements = $List<$T>
}
```

## Protocol Implementation
(Based on the grammar, explicit implementation blocks are not visible, suggesting either structural adherence or that implementation is implied when a type's fields match the protocol's required functions.)
In Funky, if a type has functions or fields that match the requirements of a protocol, it can be used where that protocol is required.
