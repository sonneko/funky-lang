//! Stack-based bytecode interpreter.
//!
//! Execution uses a single operand stack and an explicit frame stack; language
//! recursion therefore does not recurse on Rust's native call stack. Locals are
//! dense indices, structs use compact vectors, and names are interned symbols.

use std::fmt;
use std::sync::Arc;

use rustc_hash::FxHashMap;
use thiserror::Error;

use crate::bytecode::{
    Bytecode, Constant, FunctionId, FunctionKind, Instruction, Symbol, TypeId, TypeKind,
};

#[derive(Clone, Debug, PartialEq)]
pub struct StructValue {
    pub type_id: TypeId,
    pub fields: Arc<[Value]>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct EnumValue {
    pub type_id: TypeId,
    pub variant_index: u32,
    pub payload: Arc<Value>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct FunctionValue {
    pub function: FunctionId,
    pub bound_args: Vec<Value>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    Int(i64),
    Float(f64),
    Bool(bool),
    String(Arc<str>),
    Unit,
    Struct(Arc<StructValue>),
    Enum(Arc<EnumValue>),
    Function(FunctionValue),
}

impl Value {
    pub fn string(value: impl Into<Arc<str>>) -> Self {
        Self::String(value.into())
    }

    pub fn is_unit(&self) -> bool {
        matches!(self, Self::Unit)
    }
}

impl fmt::Display for Value {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Value::Int(value) => write!(f, "{value}"),
            Value::Float(value) => write!(f, "{value}"),
            Value::Bool(value) => write!(f, "{value}"),
            Value::String(value) => f.write_str(value),
            Value::Unit => f.write_str("()"),
            Value::Struct(value) => write!(f, "<struct#{}>", value.type_id.0),
            Value::Enum(value) => write!(f, "<enum#{}:{}>", value.type_id.0, value.variant_index),
            Value::Function(value) => write!(f, "<function#{}>", value.function.0),
        }
    }
}

#[derive(Debug, Error)]
pub enum VmError {
    #[error("invalid bytecode: {0}")]
    InvalidBytecode(String),
    #[error("entry `{0}` was not found")]
    UnknownEntry(String),
    #[error("cyclic initialization of top-level value `{0}`")]
    CyclicGlobal(String),
    #[error("function `{name}` expects {expected} argument(s), found {found}")]
    Arity { name: String, expected: usize, found: usize },
    #[error("attempted to call non-function value `{0}`")]
    NotCallable(String),
    #[error("no host implementation is registered for native function `{0}`")]
    MissingNative(String),
    #[error("runtime type error in `{operation}`: {message}")]
    TypeError { operation: String, message: String },
    #[error("arithmetic overflow in `{0}`")]
    ArithmeticOverflow(String),
    #[error("division by zero")]
    DivisionByZero,
    #[error("type has no field `{field}`")]
    MissingField { field: String },
    #[error("cannot access field `{field}` on {value}")]
    InvalidFieldAccess { field: String, value: String },
    #[error("operand stack underflow")]
    StackUnderflow,
    #[error("execution exceeded its instruction budget ({0} instructions)")]
    FuelExhausted(u64),
    #[error("call depth exceeded the configured limit ({0})")]
    CallDepthExceeded(usize),
    #[error("operand stack exceeded the configured limit ({0})")]
    StackLimitExceeded(usize),
}

#[derive(Clone, Copy, Debug)]
pub struct VmConfig {
    pub fuel: u64,
    pub max_call_depth: usize,
    pub max_operand_stack: usize,
}

impl Default for VmConfig {
    fn default() -> Self {
        Self {
            fuel: 10_000_000,
            max_call_depth: 1_024,
            max_operand_stack: 1_000_000,
        }
    }
}

type NativeCallback = Arc<dyn Fn(&[Value]) -> Result<Value, VmError> + Send + Sync + 'static>;

struct CallFrame {
    function: FunctionId,
    instruction: usize,
    locals: Vec<Value>,
    stack_base: usize,
    global_initializer: Option<usize>,
}

enum GlobalState {
    Uninitialized,
    Evaluating,
    Ready(Value),
}

pub struct Vm {
    bytecode: Bytecode,
    config: VmConfig,
    stack: Vec<Value>,
    frames: Vec<CallFrame>,
    steps: u64,
    globals: FxHashMap<Symbol, usize>,
    global_values: Vec<GlobalState>,
    field_indices: Vec<FxHashMap<Symbol, u32>>,
    native_callbacks: FxHashMap<String, NativeCallback>,
}

impl Vm {
    pub fn new(bytecode: Bytecode) -> Result<Self, VmError> {
        Self::with_config(bytecode, VmConfig::default())
    }

    pub fn with_config(bytecode: Bytecode, config: VmConfig) -> Result<Self, VmError> {
        bytecode.verify()?;
        let globals = bytecode
            .globals
            .iter()
            .enumerate()
            .map(|(index, global)| (global.name, index))
            .collect();
        let global_values = (0..bytecode.globals.len())
            .map(|_| GlobalState::Uninitialized)
            .collect();
        let field_indices = bytecode
            .types
            .iter()
            .map(|ty| match &ty.kind {
                TypeKind::Struct { fields } => fields
                    .iter()
                    .enumerate()
                    .map(|(index, symbol)| (*symbol, index as u32))
                    .collect(),
                TypeKind::Enum { .. } => FxHashMap::default(),
            })
            .collect();
        Ok(Self {
            bytecode,
            config,
            stack: Vec::new(),
            frames: Vec::new(),
            steps: 0,
            globals,
            global_values,
            field_indices,
            native_callbacks: FxHashMap::default(),
        })
    }

    pub fn bytecode(&self) -> &Bytecode {
        &self.bytecode
    }

    pub fn set_fuel(&mut self, fuel: u64) {
        self.config.fuel = fuel;
    }

    /// Register a host function referenced from Funky source with `# name`.
    /// The callback is shared safely across threads, though one VM executes on
    /// one thread at a time.
    pub fn register_native<F>(&mut self, name: impl Into<String>, callback: F)
    where
        F: Fn(&[Value]) -> Result<Value, VmError> + Send + Sync + 'static,
    {
        self.native_callbacks.insert(name.into(), Arc::new(callback));
    }

    /// Execute a zero-argument global (normally `main`).
    pub fn run(&mut self, entry: &str) -> Result<Value, VmError> {
        self.call(entry, &[])
    }

    /// Invoke a named global with host-provided values.
    pub fn call(&mut self, entry: &str, arguments: &[Value]) -> Result<Value, VmError> {
        // Clear interrupted evaluations after a prior runtime error. Ready
        // top-level values remain cached for the lifetime of this VM.
        for state in &mut self.global_values {
            if let GlobalState::Evaluating = state {
                *state = GlobalState::Uninitialized;
            }
        }
        self.stack.clear();
        self.frames.clear();
        self.steps = 0;

        let symbol = self.bytecode.find_symbol(entry).ok_or_else(|| {
            VmError::UnknownEntry(entry.to_owned())
        })?;
        let global_index = self.globals.get(&symbol).copied().ok_or_else(|| {
            VmError::UnknownEntry(entry.to_owned())
        })?;
        let (function_id, arity, native) = {
            let global = self.bytecode.globals.get(global_index).ok_or_else(|| {
                VmError::InvalidBytecode(format!("global `{entry}` has an invalid index"))
            })?;
            let function = self.bytecode.functions.get(global.function.0 as usize).ok_or_else(|| {
                VmError::InvalidBytecode(format!("global `{entry}` has an invalid function index"))
            })?;
            let native = match &function.kind {
                FunctionKind::Native(native) => Some(*native),
                FunctionKind::Bytecode(_) => None,
            };
            (global.function, function.arity, native)
        };
        if arity as usize != arguments.len() {
            return Err(VmError::Arity {
                name: entry.to_owned(),
                expected: arity as usize,
                found: arguments.len(),
            });
        }
        if arity == 0 {
            self.load_global(global_index)?;
            if self.frames.is_empty() {
                self.pop()
            } else {
                self.execute()
            }
        } else if let Some(native) = native {
            self.invoke_native(native, arguments)
        } else {
            self.push_frame(function_id, arguments.to_vec(), None)?;
            self.execute()
        }
    }

    fn load_global(&mut self, global_index: usize) -> Result<(), VmError> {
        let global = *self.bytecode.globals.get(global_index).ok_or_else(|| {
            VmError::InvalidBytecode(format!("missing global #{global_index}"))
        })?;
        let (arity, name, native) = {
            let function = self.bytecode.functions.get(global.function.0 as usize).ok_or_else(|| {
                VmError::InvalidBytecode(format!("global `{}` has an invalid function index", self.bytecode.symbol_name(global.name)))
            })?;
            let native = match &function.kind {
                FunctionKind::Native(native) => Some(*native),
                FunctionKind::Bytecode(_) => None,
            };
            (function.arity, function.name, native)
        };

        if arity > 0 {
            return self.push(Value::Function(FunctionValue {
                function: global.function,
                bound_args: Vec::new(),
            }));
        }
        let cached = match &self.global_values[global_index] {
            GlobalState::Ready(value) => Some(value.clone()),
            GlobalState::Evaluating => {
                return Err(VmError::CyclicGlobal(self.bytecode.symbol_name(name).to_owned()));
            }
            GlobalState::Uninitialized => None,
        };
        if let Some(value) = cached {
            return self.push(value);
        }

        self.global_values[global_index] = GlobalState::Evaluating;
        if let Some(native) = native {
            match self.invoke_native(native, &[]) {
                Ok(value) => {
                    self.global_values[global_index] = GlobalState::Ready(value.clone());
                    self.push(value)
                }
                Err(error) => {
                    self.global_values[global_index] = GlobalState::Uninitialized;
                    Err(error)
                }
            }
        } else if let Err(error) = self.push_frame(global.function, Vec::new(), Some(global_index)) {
            self.global_values[global_index] = GlobalState::Uninitialized;
            Err(error)
        } else {
            Ok(())
        }
    }

    /// Render a value using the loaded program's type and symbol tables.
    pub fn format_value(&self, value: &Value) -> String {
        let mut output = String::new();
        self.write_value(value, &mut output, false);
        output
    }

    fn write_value(&self, value: &Value, output: &mut String, nested: bool) {
        use std::fmt::Write as _;
        match value {
            Value::Int(value) => { let _ = write!(output, "{value}"); }
            Value::Float(value) => { let _ = write!(output, "{value}"); }
            Value::Bool(value) => { let _ = write!(output, "{value}"); }
            Value::String(value) => {
                if nested {
                    let _ = write!(output, "{value:?}");
                } else {
                    output.push_str(value);
                }
            }
            Value::Unit => output.push_str("()"),
            Value::Struct(value) => {
                let descriptor = self.bytecode.types.get(value.type_id.0 as usize);
                let type_name = descriptor
                    .map(|descriptor| self.bytecode.symbol_name(descriptor.name))
                    .unwrap_or("<invalid-type>");
                let _ = write!(output, "{type_name} {{");
                if let Some(descriptor) = descriptor {
                    if let TypeKind::Struct { fields } = &descriptor.kind {
                        for (index, field) in fields.iter().enumerate() {
                            if index > 0 { output.push(','); }
                            let _ = write!(output, " {} = ", self.bytecode.symbol_name(*field));
                            if let Some(field_value) = value.fields.get(index) {
                                self.write_value(field_value, output, true);
                            } else {
                                output.push_str("<missing>");
                            }
                        }
                    }
                }
                output.push_str(" }");
            }
            Value::Enum(value) => {
                let variant = self
                    .bytecode
                    .types
                    .get(value.type_id.0 as usize)
                    .and_then(|descriptor| match &descriptor.kind {
                        TypeKind::Enum { variants } => variants.get(value.variant_index as usize),
                        _ => None,
                    })
                    .map(|symbol| self.bytecode.symbol_name(*symbol))
                    .unwrap_or("<invalid-variant>");
                let _ = write!(output, "{variant}(");
                self.write_value(&value.payload, output, true);
                output.push(')');
            }
            Value::Function(value) => {
                let name = self
                    .bytecode
                    .functions
                    .get(value.function.0 as usize)
                    .map(|function| self.bytecode.symbol_name(function.name))
                    .unwrap_or("<invalid-function>");
                let _ = write!(output, "<function {name}>");
            }
        }
    }

    fn push_frame(
        &mut self,
        function_id: FunctionId,
        arguments: Vec<Value>,
        global_initializer: Option<usize>,
    ) -> Result<(), VmError> {
        if self.frames.len() >= self.config.max_call_depth {
            return Err(VmError::CallDepthExceeded(self.config.max_call_depth));
        }
        let function = self.bytecode.functions.get(function_id.0 as usize).ok_or_else(|| {
            VmError::InvalidBytecode(format!("missing function #{}", function_id.0))
        })?;
        let FunctionKind::Bytecode(_) = &function.kind else {
            return Err(VmError::InvalidBytecode(format!(
                "attempted to create a bytecode frame for native function `{}`",
                self.bytecode.symbol_name(function.name)
            )));
        };
        if arguments.len() != function.arity as usize {
            return Err(VmError::Arity {
                name: self.bytecode.symbol_name(function.name).to_owned(),
                expected: function.arity as usize,
                found: arguments.len(),
            });
        }
        let mut locals = vec![Value::Unit; function.local_count as usize];
        for (slot, argument) in arguments.into_iter().enumerate() {
            locals[slot] = argument;
        }
        self.frames.push(CallFrame {
            function: function_id,
            instruction: 0,
            locals,
            stack_base: self.stack.len(),
            global_initializer,
        });
        Ok(())
    }

    fn execute(&mut self) -> Result<Value, VmError> {
        while !self.frames.is_empty() {
            if self.steps >= self.config.fuel {
                return Err(VmError::FuelExhausted(self.config.fuel));
            }
            self.steps += 1;

            let frame_index = self.frames.len() - 1;
            let function_id = self.frames[frame_index].function;
            let ip = self.frames[frame_index].instruction;
            let function = &self.bytecode.functions[function_id.0 as usize];
            let FunctionKind::Bytecode(code) = &function.kind else {
                return Err(VmError::InvalidBytecode("native function has an instruction pointer".into()));
            };
            let instruction = code.get(ip).cloned().ok_or_else(|| {
                VmError::InvalidBytecode(format!(
                    "instruction pointer {ip} is outside function `{}`",
                    self.bytecode.symbol_name(function.name)
                ))
            })?;
            self.frames[frame_index].instruction += 1;

            match instruction {
                Instruction::Const(constant) => {
                    let value = match constant {
                        Constant::Int(value) => Value::Int(value),
                        Constant::Float(value) => Value::Float(value),
                        Constant::Bool(value) => Value::Bool(value),
                        Constant::String(value) => Value::String(value),
                        Constant::Unit => Value::Unit,
                    };
                    self.push(value)?;
                }
                Instruction::LoadLocal(local) => {
                    let value = self.frames[frame_index]
                        .locals
                        .get(local as usize)
                        .cloned()
                        .ok_or_else(|| VmError::InvalidBytecode(format!("missing local #{local}")))?;
                    self.push(value)?;
                }
                Instruction::StoreLocal(local) => {
                    let value = self.pop()?;
                    let target = self.frames[frame_index]
                        .locals
                        .get_mut(local as usize)
                        .ok_or_else(|| VmError::InvalidBytecode(format!("missing local #{local}")))?;
                    *target = value;
                }
                Instruction::LoadGlobal(symbol) => {
                    let global_index = self.globals.get(&symbol).copied().ok_or_else(|| {
                        VmError::UnknownEntry(self.bytecode.symbol_name(symbol).to_owned())
                    })?;
                    self.load_global(global_index)?;
                }
                Instruction::GetField(field) => {
                    let receiver = self.pop()?;
                    let value = self.get_field(receiver, field)?;
                    self.push(value)?;
                }
                Instruction::MakeStruct { type_id, field_indices } => {
                    let values = self.pop_values(field_indices.len())?;
                    let descriptor = self.bytecode.types.get(type_id.0 as usize).ok_or_else(|| {
                        VmError::InvalidBytecode(format!("missing type #{}", type_id.0))
                    })?;
                    let TypeKind::Struct { fields } = &descriptor.kind else {
                        return Err(VmError::InvalidBytecode("MAKE_STRUCT used with non-struct type".into()));
                    };
                    let mut result = vec![Value::Unit; fields.len()];
                    for (index, value) in field_indices.iter().zip(values) {
                        let slot = result.get_mut(*index as usize).ok_or_else(|| {
                            VmError::InvalidBytecode(format!("missing struct field #{index}"))
                        })?;
                        *slot = value;
                    }
                    self.push(Value::Struct(Arc::new(StructValue {
                        type_id,
                        fields: Arc::from(result.into_boxed_slice()),
                    })))?;
                }
                Instruction::MakeEnum { type_id, variant_index } => {
                    let payload = self.pop()?;
                    self.push(Value::Enum(Arc::new(EnumValue {
                        type_id,
                        variant_index,
                        payload: Arc::new(payload),
                    })))?;
                }
                Instruction::Apply => {
                    let argument = self.pop()?;
                    let callee = self.pop()?;
                    self.apply(callee, argument)?;
                }
                Instruction::Pop => { self.pop()?; }
                Instruction::Jump(target) => {
                    self.frames[frame_index].instruction = target as usize;
                }
                Instruction::JumpIfFalse(target) => {
                    let condition = self.pop()?;
                    match condition {
                        Value::Bool(false) => self.frames[frame_index].instruction = target as usize,
                        Value::Bool(true) => {}
                        other => return Err(VmError::TypeError {
                            operation: "if condition".into(),
                            message: format!("expected Bool, found {}", self.format_value(&other)),
                        }),
                    }
                }
                Instruction::Return => {
                    let result = self.pop()?;
                    let frame = self.frames.pop().expect("active frame");
                    self.stack.truncate(frame.stack_base);
                    if let Some(global_index) = frame.global_initializer {
                        self.global_values[global_index] = GlobalState::Ready(result.clone());
                    }
                    if self.frames.is_empty() {
                        return Ok(result);
                    }
                    self.push(result)?;
                }
            }
            if self.stack.len() > self.config.max_operand_stack {
                return Err(VmError::StackLimitExceeded(self.config.max_operand_stack));
            }
        }
        Err(VmError::InvalidBytecode("execution ended without returning a value".into()))
    }

    fn apply(&mut self, callee: Value, argument: Value) -> Result<(), VmError> {
        let Value::Function(mut function_value) = callee else {
            return Err(VmError::NotCallable(self.format_value(&callee)));
        };
        let (arity, name, native) = {
            let function = self
                .bytecode
                .functions
                .get(function_value.function.0 as usize)
                .ok_or_else(|| VmError::InvalidBytecode("closure refers to missing function".into()))?;
            let native = match &function.kind {
                FunctionKind::Native(native) => Some(*native),
                FunctionKind::Bytecode(_) => None,
            };
            (function.arity as usize, function.name, native)
        };
        function_value.bound_args.push(argument);
        if function_value.bound_args.len() > arity {
            return Err(VmError::Arity {
                name: self.bytecode.symbol_name(name).to_owned(),
                expected: arity,
                found: function_value.bound_args.len(),
            });
        }
        if function_value.bound_args.len() < arity {
            self.push(Value::Function(function_value))?;
            return Ok(());
        }

        if let Some(native) = native {
            let result = self.invoke_native(native, &function_value.bound_args)?;
            self.push(result)
        } else {
            self.push_frame(function_value.function, function_value.bound_args, None)
        }
    }

    fn get_field(&self, receiver: Value, field: Symbol) -> Result<Value, VmError> {
        match receiver {
            Value::Struct(value) => {
                let index = self
                    .field_indices
                    .get(value.type_id.0 as usize)
                    .and_then(|fields| fields.get(&field))
                    .copied()
                    .ok_or_else(|| VmError::MissingField {
                        field: self.bytecode.symbol_name(field).to_owned(),
                    })?;
                value.fields.get(index as usize).cloned().ok_or_else(|| {
                    VmError::InvalidBytecode(format!("struct field index {index} is out of range"))
                })
            }
            Value::Enum(value) => {
                match self.bytecode.symbol_name(field) {
                    "tag" => {
                        let variant = self
                            .bytecode
                            .types
                            .get(value.type_id.0 as usize)
                            .and_then(|descriptor| match &descriptor.kind {
                                TypeKind::Enum { variants } => variants.get(value.variant_index as usize),
                                _ => None,
                            })
                            .ok_or_else(|| VmError::InvalidBytecode("enum has invalid variant".into()))?;
                        Ok(Value::String(Arc::clone(
                            &self.bytecode.symbols[variant.0 as usize],
                        )))
                    }
                    "value" => Ok((*value.payload).clone()),
                    name => Err(VmError::MissingField { field: name.to_owned() }),
                }
            }
            other => Err(VmError::InvalidFieldAccess {
                field: self.bytecode.symbol_name(field).to_owned(),
                value: self.format_value(&other),
            }),
        }
    }

    fn invoke_native(&mut self, native: Symbol, arguments: &[Value]) -> Result<Value, VmError> {
        let name = self.bytecode.symbol_name(native).to_owned();
        if let Some(callback) = self.native_callbacks.get(&name).cloned() {
            return callback(arguments);
        }

        match name.as_str() {
            "nativeAdd" => self.numeric_binary(&name, arguments, NumericOp::Add),
            "nativeSub" => self.numeric_binary(&name, arguments, NumericOp::Sub),
            "nativeMul" => self.numeric_binary(&name, arguments, NumericOp::Mul),
            "nativeDiv" => self.numeric_binary(&name, arguments, NumericOp::Div),
            "nativeMod" => self.numeric_binary(&name, arguments, NumericOp::Mod),
            "nativeEq" => self.boolean_binary(&name, arguments, |a, b| a == b),
            "nativeNe" => self.boolean_binary(&name, arguments, |a, b| a != b),
            "nativeLt" => self.numeric_compare(&name, arguments, |ordering| ordering.is_lt()),
            "nativeGt" => self.numeric_compare(&name, arguments, |ordering| ordering.is_gt()),
            "nativeLe" => self.numeric_compare(&name, arguments, |ordering| ordering.is_le()),
            "nativeGe" => self.numeric_compare(&name, arguments, |ordering| ordering.is_ge()),
            "nativeAnd" => self.bool_operation(&name, arguments, |a, b| a && b),
            "nativeOr" => self.bool_operation(&name, arguments, |a, b| a || b),
            "nativeNot" => {
                let [Value::Bool(value)] = arguments else {
                    return Err(Self::native_type_error(&name, "one Bool argument"));
                };
                Ok(Value::Bool(!*value))
            }
            "nativeConcat" => {
                let [Value::String(left), Value::String(right)] = arguments else {
                    return Err(Self::native_type_error(&name, "two String arguments"));
                };
                let mut joined = String::with_capacity(left.len() + right.len());
                joined.push_str(left);
                joined.push_str(right);
                Ok(Value::String(Arc::from(joined)))
            }
            "consoleLog" | "nativeConsoleLog" | "nativePrintln" => {
                let [value] = arguments else {
                    return Err(Self::native_type_error(&name, "one argument"));
                };
                println!("{}", self.format_value(value));
                Ok(Value::Unit)
            }
            "nativePrint" => {
                let [value] = arguments else {
                    return Err(Self::native_type_error(&name, "one argument"));
                };
                print!("{}", self.format_value(value));
                Ok(Value::Unit)
            }
            _ => Err(VmError::MissingNative(name)),
        }
    }

    fn numeric_binary(&self, name: &str, arguments: &[Value], operation: NumericOp) -> Result<Value, VmError> {
        let [left, right] = arguments else {
            return Err(Self::native_type_error(name, "two numeric arguments"));
        };
        match (left, right) {
            (Value::Int(left), Value::Int(right)) => {
                let value = match operation {
                    NumericOp::Add => left.checked_add(*right),
                    NumericOp::Sub => left.checked_sub(*right),
                    NumericOp::Mul => left.checked_mul(*right),
                    NumericOp::Div => {
                        if *right == 0 { return Err(VmError::DivisionByZero); }
                        left.checked_div(*right)
                    }
                    NumericOp::Mod => {
                        if *right == 0 { return Err(VmError::DivisionByZero); }
                        left.checked_rem(*right)
                    }
                }
                .ok_or_else(|| VmError::ArithmeticOverflow(name.to_owned()))?;
                Ok(Value::Int(value))
            }
            (Value::Float(left), Value::Float(right)) => {
                if matches!(operation, NumericOp::Div | NumericOp::Mod) && *right == 0.0 {
                    return Err(VmError::DivisionByZero);
                }
                let value = match operation {
                    NumericOp::Add => left + right,
                    NumericOp::Sub => left - right,
                    NumericOp::Mul => left * right,
                    NumericOp::Div => left / right,
                    NumericOp::Mod => left % right,
                };
                Ok(Value::Float(value))
            }
            _ => Err(Self::native_type_error(name, "two values of the same numeric type")),
        }
    }

    fn boolean_binary(
        &self,
        name: &str,
        arguments: &[Value],
        operation: impl FnOnce(&Value, &Value) -> bool,
    ) -> Result<Value, VmError> {
        let [left, right] = arguments else {
            return Err(Self::native_type_error(name, "two arguments"));
        };
        Ok(Value::Bool(operation(left, right)))
    }

    fn numeric_compare(
        &self,
        name: &str,
        arguments: &[Value],
        predicate: impl FnOnce(std::cmp::Ordering) -> bool,
    ) -> Result<Value, VmError> {
        let [left, right] = arguments else {
            return Err(Self::native_type_error(name, "two comparable numeric arguments"));
        };
        let result = match (left, right) {
            (Value::Int(left), Value::Int(right)) => predicate(left.cmp(right)),
            (Value::Float(left), Value::Float(right)) => left
                .partial_cmp(right)
                .map(predicate)
                .unwrap_or(false),
            _ => return Err(Self::native_type_error(name, "two values of the same numeric type")),
        };
        Ok(Value::Bool(result))
    }

    fn bool_operation(
        &self,
        name: &str,
        arguments: &[Value],
        operation: impl FnOnce(bool, bool) -> bool,
    ) -> Result<Value, VmError> {
        let [Value::Bool(left), Value::Bool(right)] = arguments else {
            return Err(Self::native_type_error(name, "two Bool arguments"));
        };
        Ok(Value::Bool(operation(*left, *right)))
    }

    fn native_type_error(name: &str, expected: &str) -> VmError {
        VmError::TypeError {
            operation: name.to_owned(),
            message: format!("expected {expected}"),
        }
    }

    fn push(&mut self, value: Value) -> Result<(), VmError> {
        if self.stack.len() >= self.config.max_operand_stack {
            return Err(VmError::StackLimitExceeded(self.config.max_operand_stack));
        }
        self.stack.push(value);
        Ok(())
    }

    fn pop(&mut self) -> Result<Value, VmError> {
        self.stack.pop().ok_or(VmError::StackUnderflow)
    }

    fn pop_values(&mut self, count: usize) -> Result<Vec<Value>, VmError> {
        if self.stack.len() < count {
            return Err(VmError::StackUnderflow);
        }
        let start = self.stack.len() - count;
        Ok(self.stack.split_off(start))
    }
}

#[derive(Clone, Copy)]
enum NumericOp {
    Add,
    Sub,
    Mul,
    Div,
    Mod,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compiler;

    fn execute(source: &str) -> (Value, Vm) {
        let program = crate::parse(source).unwrap();
        let bytecode = compiler::compile(&program).unwrap();
        let mut vm = Vm::new(bytecode).unwrap();
        let result = vm.run("main").unwrap();
        (result, vm)
    }

    #[test]
    fn evaluates_primitives_and_native_arithmetic() {
        let (result, _) = execute("main > $Int is add 20 22;");
        assert_eq!(result, Value::Int(42));
    }

    #[test]
    fn builds_values_and_formats_them() {
        let (result, vm) = execute(
            "$Point is { x = $Int  y = $Int };\n\
             main > $Point is Point { x = 12  y = 30 };",
        );
        assert_eq!(vm.format_value(&result), "Point { x = 12, y = 30 }");
    }

    #[test]
    fn supports_user_registered_native_functions() {
        let program = crate::parse("read > $Int is # hostRead;").unwrap();
        let bytecode = compiler::compile(&program).unwrap();
        let mut vm = Vm::new(bytecode).unwrap();
        vm.register_native("hostRead", |_| Ok(Value::Int(7)));
        assert_eq!(vm.run("read").unwrap(), Value::Int(7));
    }

    #[test]
    fn memoizes_zero_argument_globals() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        let program = crate::parse("read > $Int is # hostRead;").unwrap();
        let bytecode = compiler::compile(&program).unwrap();
        let mut vm = Vm::new(bytecode).unwrap();
        let calls = std::sync::Arc::new(AtomicUsize::new(0));
        let count = std::sync::Arc::clone(&calls);
        vm.register_native("hostRead", move |_| {
            count.fetch_add(1, Ordering::SeqCst);
            Ok(Value::Int(7))
        });
        assert_eq!(vm.run("read").unwrap(), Value::Int(7));
        assert_eq!(vm.run("read").unwrap(), Value::Int(7));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn enforces_fuel() {
        let program = crate::parse(
            "loop n: $Int > $Int is loop n; main > $Int is loop 0;",
        ).unwrap();
        let bytecode = compiler::compile(&program).unwrap();
        let mut vm = Vm::with_config(bytecode, VmConfig { fuel: 50, ..VmConfig::default() }).unwrap();
        assert!(matches!(vm.run("main"), Err(VmError::FuelExhausted(50))));
    }
}
