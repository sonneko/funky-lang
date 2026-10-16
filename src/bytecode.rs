//! Compact, serializable bytecode format shared by the compiler and VM.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::vm::VmError;

/// Increment when the serialized instruction or metadata layout changes.
pub const BYTECODE_VERSION: u16 = 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Symbol(pub u32);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct FunctionId(pub u32);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct TypeId(pub u32);

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum Constant {
    Int(i64),
    Float(f64),
    Bool(bool),
    String(Arc<str>),
    Unit,
}

/// Instructions are deliberately small and use indices instead of names. The
/// VM verifies a bytecode image once, when it is loaded, before dispatching it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum Instruction {
    Const(Constant),
    LoadLocal(u32),
    StoreLocal(u32),
    LoadGlobal(Symbol),
    GetField(Symbol),
    MakeStruct {
        type_id: TypeId,
        /// Field indices in expression evaluation order.
        field_indices: Arc<[u32]>,
    },
    MakeEnum {
        type_id: TypeId,
        variant_index: u32,
    },
    Apply,
    Pop,
    Jump(u32),
    JumpIfFalse(u32),
    Return,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum FunctionKind {
    Bytecode(Vec<Instruction>),
    /// Host function name. Hosts can register additional functions at runtime.
    Native(Symbol),
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Function {
    pub name: Symbol,
    pub arity: u32,
    pub local_count: u32,
    pub kind: FunctionKind,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum TypeKind {
    Struct { fields: Vec<Symbol> },
    Enum { variants: Vec<Symbol> },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TypeDescriptor {
    pub name: Symbol,
    pub kind: TypeKind,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Global {
    pub name: Symbol,
    pub function: FunctionId,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Bytecode {
    pub format_version: u16,
    /// Index-addressed string table shared by instructions and type metadata.
    pub symbols: Vec<Arc<str>>,
    pub types: Vec<TypeDescriptor>,
    pub functions: Vec<Function>,
    pub globals: Vec<Global>,
}

#[derive(Debug, Error)]
pub enum BytecodeError {
    #[error("unsupported bytecode version {0}; this runtime supports version 1")]
    UnsupportedVersion(u16),
    #[error("invalid bytecode: {0}")]
    Invalid(String),
    #[error("could not decode bytecode: {0}")]
    Decode(#[from] Box<bincode::ErrorKind>),
}

impl Bytecode {
    pub fn symbol_name(&self, symbol: Symbol) -> &str {
        self.symbols
            .get(symbol.0 as usize)
            .map(|name| name.as_ref())
            .unwrap_or("<invalid-symbol>")
    }

    pub fn find_symbol(&self, name: &str) -> Option<Symbol> {
        self.symbols
            .iter()
            .position(|candidate| candidate.as_ref() == name)
            .and_then(|index| u32::try_from(index).ok())
            .map(Symbol)
    }

    pub fn to_bytes(&self) -> Result<Vec<u8>, BytecodeError> {
        self.verify().map_err(|error| BytecodeError::Invalid(error.to_string()))?;
        Ok(bincode::serialize(self)?)
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self, BytecodeError> {
        let bytecode: Self = bincode::deserialize(bytes)?;
        if bytecode.format_version != BYTECODE_VERSION {
            return Err(BytecodeError::UnsupportedVersion(bytecode.format_version));
        }
        bytecode
            .verify()
            .map_err(|error| BytecodeError::Invalid(error.to_string()))?;
        Ok(bytecode)
    }

    /// Verify all indexes and reachable stack effects. This makes loading a
    /// `.fbc` file safe from malformed jumps, local indices, and stack underflow.
    pub fn verify(&self) -> Result<(), VmError> {
        if self.format_version != BYTECODE_VERSION {
            return Err(VmError::InvalidBytecode(format!(
                "unsupported bytecode version {} (runtime supports {})",
                self.format_version, BYTECODE_VERSION
            )));
        }

        let symbol_valid = |symbol: Symbol| (symbol.0 as usize) < self.symbols.len();
        for (index, ty) in self.types.iter().enumerate() {
            if !symbol_valid(ty.name) {
                return Err(VmError::InvalidBytecode(format!(
                    "type #{index} has invalid name symbol {}", ty.name.0
                )));
            }
            match &ty.kind {
                TypeKind::Struct { fields } => {
                    for field in fields {
                        if !symbol_valid(*field) {
                            return Err(VmError::InvalidBytecode(format!(
                                "type #{index} has invalid field symbol {}", field.0
                            )));
                        }
                    }
                }
                TypeKind::Enum { variants } => {
                    for variant in variants {
                        if !symbol_valid(*variant) {
                            return Err(VmError::InvalidBytecode(format!(
                                "type #{index} has invalid variant symbol {}", variant.0
                            )));
                        }
                    }
                }
            }
        }

        let mut global_names = rustc_hash::FxHashSet::default();
        for global in &self.globals {
            if !global_names.insert(global.name) {
                return Err(VmError::InvalidBytecode(format!(
                    "duplicate global `{}`", self.symbol_name(global.name)
                )));
            }
            if !symbol_valid(global.name) {
                return Err(VmError::InvalidBytecode(format!(
                    "global has invalid name symbol {}", global.name.0
                )));
            }
            if (global.function.0 as usize) >= self.functions.len() {
                return Err(VmError::InvalidBytecode(format!(
                    "global `{}` refers to missing function #{}",
                    self.symbol_name(global.name), global.function.0
                )));
            }
        }

        for (function_index, function) in self.functions.iter().enumerate() {
            if !symbol_valid(function.name) {
                return Err(VmError::InvalidBytecode(format!(
                    "function #{function_index} has invalid name symbol {}", function.name.0
                )));
            }
            match &function.kind {
                FunctionKind::Native(native) => {
                    if !symbol_valid(*native) {
                        return Err(VmError::InvalidBytecode(format!(
                            "function `{}` has invalid native symbol {}",
                            self.symbol_name(function.name), native.0
                        )));
                    }
                }
                FunctionKind::Bytecode(code) => {
                    self.verify_function(function_index, function, code, &symbol_valid)?;
                }
            }
        }
        Ok(())
    }

    fn verify_function(
        &self,
        function_index: usize,
        function: &Function,
        code: &[Instruction],
        symbol_valid: &impl Fn(Symbol) -> bool,
    ) -> Result<(), VmError> {
        let name = self.symbol_name(function.name);
        if code.is_empty() {
            return Err(VmError::InvalidBytecode(format!(
                "function `{name}` has empty bytecode"
            )));
        }
        if function.local_count < function.arity {
            return Err(VmError::InvalidBytecode(format!(
                "function `{name}` has {} parameter(s), but only {} local slot(s)",
                function.arity, function.local_count
            )));
        }

        // Check operands, including those in dead code.
        for (ip, instruction) in code.iter().enumerate() {
            match instruction {
                Instruction::LoadLocal(local) | Instruction::StoreLocal(local)
                    if *local >= function.local_count =>
                {
                    return Err(VmError::InvalidBytecode(format!(
                        "function `{name}` instruction {ip} refers to local #{local}, but has {} locals",
                        function.local_count
                    )));
                }
                Instruction::LoadGlobal(symbol) | Instruction::GetField(symbol)
                    if !symbol_valid(*symbol) =>
                {
                    return Err(VmError::InvalidBytecode(format!(
                        "function `{name}` instruction {ip} has invalid symbol {}", symbol.0
                    )));
                }
                Instruction::MakeStruct { type_id, field_indices } => {
                    let descriptor = self.types.get(type_id.0 as usize).ok_or_else(|| {
                        VmError::InvalidBytecode(format!(
                            "function `{name}` instruction {ip} refers to missing type #{}",
                            type_id.0
                        ))
                    })?;
                    let TypeKind::Struct { fields } = &descriptor.kind else {
                        return Err(VmError::InvalidBytecode(format!(
                            "function `{name}` instruction {ip} constructs non-struct type `{}`",
                            self.symbol_name(descriptor.name)
                        )));
                    };
                    if field_indices.len() != fields.len() {
                        return Err(VmError::InvalidBytecode(format!(
                            "function `{name}` instruction {ip} initializes {} field(s), expected {}",
                            field_indices.len(), fields.len()
                        )));
                    }
                    let mut initialized = vec![false; fields.len()];
                    for field in field_indices.iter() {
                        let Some(slot) = initialized.get_mut(*field as usize) else {
                            return Err(VmError::InvalidBytecode(format!(
                                "function `{name}` instruction {ip} refers to missing field #{field}"
                            )));
                        };
                        if *slot {
                            return Err(VmError::InvalidBytecode(format!(
                                "function `{name}` instruction {ip} initializes field #{field} more than once"
                            )));
                        }
                        *slot = true;
                    }
                }
                Instruction::MakeEnum { type_id, variant_index } => {
                    let descriptor = self.types.get(type_id.0 as usize).ok_or_else(|| {
                        VmError::InvalidBytecode(format!(
                            "function `{name}` instruction {ip} refers to missing type #{}",
                            type_id.0
                        ))
                    })?;
                    let TypeKind::Enum { variants } = &descriptor.kind else {
                        return Err(VmError::InvalidBytecode(format!(
                            "function `{name}` instruction {ip} constructs non-enum type `{}`",
                            self.symbol_name(descriptor.name)
                        )));
                    };
                    if (*variant_index as usize) >= variants.len() {
                        return Err(VmError::InvalidBytecode(format!(
                            "function `{name}` instruction {ip} refers to missing variant #{variant_index}"
                        )));
                    }
                }
                Instruction::Jump(target) | Instruction::JumpIfFalse(target)
                    if (*target as usize) >= code.len() =>
                {
                    return Err(VmError::InvalidBytecode(format!(
                        "function `{name}` instruction {ip} jumps outside bytecode to {target}"
                    )));
                }
                _ => {}
            }
        }

        // Work-list stack verifier. A function starts with an empty operand
        // stack; every reachable return must consume exactly its one result.
        let mut depths: Vec<Option<usize>> = vec![None; code.len()];
        let mut work = vec![(0usize, 0usize)];
        while let Some((ip, depth)) = work.pop() {
            if ip >= code.len() {
                return Err(VmError::InvalidBytecode(format!(
                    "function `{name}` falls off the end of its bytecode"
                )));
            }
            if let Some(previous) = depths[ip] {
                if previous != depth {
                    return Err(VmError::InvalidBytecode(format!(
                        "function `{name}` has inconsistent stack depth at instruction {ip} ({previous} vs {depth})"
                    )));
                }
                continue;
            }
            depths[ip] = Some(depth);

            let instruction = &code[ip];
            let (consumed, produced) = match instruction {
                Instruction::Const(_) | Instruction::LoadLocal(_) | Instruction::LoadGlobal(_) => (0, 1),
                Instruction::StoreLocal(_) | Instruction::Pop | Instruction::JumpIfFalse(_) => (1, 0),
                Instruction::GetField(_) | Instruction::MakeEnum { .. } => (1, 1),
                Instruction::MakeStruct { field_indices, .. } => (field_indices.len(), 1),
                Instruction::Apply => (2, 1),
                Instruction::Jump(_) => (0, 0),
                Instruction::Return => {
                    if depth != 1 {
                        return Err(VmError::InvalidBytecode(format!(
                            "function `{name}` returns with stack depth {depth}, expected 1"
                        )));
                    }
                    continue;
                }
            };
            if depth < consumed {
                return Err(VmError::InvalidBytecode(format!(
                    "function `{name}` underflows the operand stack at instruction {ip}"
                )));
            }
            let next_depth = depth - consumed + produced;
            match instruction {
                Instruction::Jump(target) => work.push((*target as usize, next_depth)),
                Instruction::JumpIfFalse(target) => {
                    work.push((*target as usize, next_depth));
                    work.push((ip + 1, next_depth));
                }
                _ => work.push((ip + 1, next_depth)),
            }
        }

        // Keep the argument in this method's signature to make diagnostics
        // stable if function IDs are ever added to the file format.
        let _ = function_index;
        Ok(())
    }

    pub fn disassemble(&self) -> String {
        let mut output = String::new();
        use std::fmt::Write as _;

        for (index, function) in self.functions.iter().enumerate() {
            let _ = writeln!(
                output,
                "fn #{} {} / {} arg(s), {} local(s)",
                index,
                self.symbol_name(function.name),
                function.arity,
                function.local_count
            );
            match &function.kind {
                FunctionKind::Native(native) => {
                    let _ = writeln!(output, "  native {}", self.symbol_name(*native));
                }
                FunctionKind::Bytecode(code) => {
                    for (ip, instruction) in code.iter().enumerate() {
                        let _ = writeln!(output, "  {ip:04}  {}", self.format_instruction(instruction));
                    }
                }
            }
            output.push('\n');
        }
        output
    }

    fn format_instruction(&self, instruction: &Instruction) -> String {
        match instruction {
            Instruction::Const(Constant::Int(value)) => format!("CONST_INT {value}"),
            Instruction::Const(Constant::Float(value)) => format!("CONST_FLOAT {value}"),
            Instruction::Const(Constant::Bool(value)) => format!("CONST_BOOL {value}"),
            Instruction::Const(Constant::String(value)) => format!("CONST_STRING {value:?}"),
            Instruction::Const(Constant::Unit) => "CONST_UNIT".into(),
            Instruction::LoadLocal(local) => format!("LOAD_LOCAL {local}"),
            Instruction::StoreLocal(local) => format!("STORE_LOCAL {local}"),
            Instruction::LoadGlobal(symbol) => {
                format!("LOAD_GLOBAL {}", self.symbol_name(*symbol))
            }
            Instruction::GetField(symbol) => format!("GET_FIELD {}", self.symbol_name(*symbol)),
            Instruction::MakeStruct { type_id, field_indices } => format!(
                "MAKE_STRUCT {} fields={:?}",
                self.types
                    .get(type_id.0 as usize)
                    .map(|ty| self.symbol_name(ty.name))
                    .unwrap_or("<invalid-type>"),
                field_indices
            ),
            Instruction::MakeEnum { type_id, variant_index } => {
                let variant = self
                    .types
                    .get(type_id.0 as usize)
                    .and_then(|ty| match &ty.kind {
                        TypeKind::Enum { variants } => variants.get(*variant_index as usize),
                        _ => None,
                    })
                    .map(|symbol| self.symbol_name(*symbol))
                    .unwrap_or("<invalid-variant>");
                format!("MAKE_ENUM {variant}")
            }
            Instruction::Apply => "APPLY".into(),
            Instruction::Pop => "POP".into(),
            Instruction::Jump(target) => format!("JUMP {target}"),
            Instruction::JumpIfFalse(target) => format!("JUMP_IF_FALSE {target}"),
            Instruction::Return => "RETURN".into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compiler;

    #[test]
    fn serializes_and_verifies_compiled_bytecode() {
        let program = crate::parse("main > $Int is add 19 23;").unwrap();
        let bytecode = compiler::compile(&program).unwrap();
        let bytes = bytecode.to_bytes().unwrap();
        let restored = Bytecode::from_bytes(&bytes).unwrap();
        assert_eq!(bytecode, restored);
        assert!(restored.disassemble().contains("APPLY"));
    }

    #[test]
    fn rejects_invalid_stack_program() {
        let bytecode = Bytecode {
            format_version: BYTECODE_VERSION,
            symbols: vec![Arc::from("bad")],
            types: vec![],
            functions: vec![Function {
                name: Symbol(0),
                arity: 0,
                local_count: 0,
                kind: FunctionKind::Bytecode(vec![Instruction::Pop, Instruction::Const(Constant::Unit), Instruction::Return]),
            }],
            globals: vec![],
        };
        assert!(bytecode.verify().is_err());
    }
}
