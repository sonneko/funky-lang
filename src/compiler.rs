//! AST-to-bytecode compiler.
//!
//! The compiler uses fixed-index locals, interned symbols and a compact
//! instruction stream. Function calls retain the language's curried semantics:
//! `f a b` compiles to two `APPLY` instructions and may produce partial
//! function values between applications.

use std::sync::Arc;

use rustc_hash::FxHashMap;
use thiserror::Error;

use crate::ast::*;
use crate::bytecode::{
    Bytecode, Constant, Function, FunctionId, FunctionKind, Global, Instruction, Symbol,
    TypeDescriptor, TypeId, TypeKind, BYTECODE_VERSION,
};

#[derive(Debug, Clone, Error)]
#[error("compile error at bytes {span_start}..{span_end}: {message}")]
pub struct CompileError {
    pub span_start: usize,
    pub span_end: usize,
    pub message: String,
}

impl CompileError {
    fn at(span: Span, message: impl Into<String>) -> Self {
        Self { span_start: span.start, span_end: span.end, message: message.into() }
    }

    fn program(message: impl Into<String>) -> Self {
        Self::at(Span::new(0, 0), message)
    }
}

#[derive(Default)]
struct Interner {
    names: Vec<Arc<str>>,
    ids: FxHashMap<String, Symbol>,
}

impl Interner {
    fn intern(&mut self, name: &str) -> Symbol {
        if let Some(symbol) = self.ids.get(name) {
            return *symbol;
        }
        let id = u32::try_from(self.names.len()).expect("too many interned symbols");
        let symbol = Symbol(id);
        self.names.push(Arc::from(name));
        self.ids.insert(name.to_owned(), symbol);
        symbol
    }
}

/// Name, host function name, and arity for the standard library provided by
/// the VM. These entries are only installed when a program does not define the
/// corresponding function itself.
const BUILTINS: &[(&str, &str, u32)] = &[
    ("add", "nativeAdd", 2),
    ("sub", "nativeSub", 2),
    ("mul", "nativeMul", 2),
    ("div", "nativeDiv", 2),
    ("mod_", "nativeMod", 2),
    ("eq", "nativeEq", 2),
    ("lt", "nativeLt", 2),
    ("gt", "nativeGt", 2),
    ("le", "nativeLe", 2),
    ("ge", "nativeGe", 2),
    ("ne", "nativeNe", 2),
    ("and", "nativeAnd", 2),
    ("or", "nativeOr", 2),
    ("not", "nativeNot", 1),
    ("concat", "nativeConcat", 2),
];

pub struct Compiler {
    interner: Interner,
    types: Vec<TypeDescriptor>,
    type_ids: FxHashMap<String, TypeId>,
    variant_ids: FxHashMap<String, (TypeId, u32)>,
    functions: Vec<Function>,
    function_ids: FxHashMap<String, FunctionId>,
    globals: Vec<Global>,
}

impl Compiler {
    pub fn new() -> Self {
        Self {
            interner: Interner::default(),
            types: Vec::new(),
            type_ids: FxHashMap::default(),
            variant_ids: FxHashMap::default(),
            functions: Vec::new(),
            function_ids: FxHashMap::default(),
            globals: Vec::new(),
        }
    }

    pub fn compile(program: &Program) -> Result<Bytecode, CompileError> {
        Self::new().compile_program(program)
    }

    pub fn compile_program(mut self, program: &Program) -> Result<Bytecode, CompileError> {
        self.collect_types(program)?;
        self.collect_functions(program)?;
        self.compile_functions(program)?;

        let bytecode = Bytecode {
            format_version: BYTECODE_VERSION,
            symbols: self.interner.names,
            types: self.types,
            functions: self.functions,
            globals: self.globals,
        };
        bytecode
            .verify()
            .map_err(|error| CompileError::program(format!("generated invalid bytecode: {error}")))?;
        Ok(bytecode)
    }

    fn collect_types(&mut self, program: &Program) -> Result<(), CompileError> {
        for item in &program.items {
            let TopLevel::TypeDef(definition) = item else { continue };
            let (kind, runtime_name) = match &definition.ty {
                TypeLiteral::Struct(body) => {
                    let mut fields = Vec::with_capacity(body.fields.len());
                    let mut seen = FxHashMap::default();
                    for field in &body.fields {
                        if seen.insert(field.name.clone(), ()).is_some() {
                            return Err(CompileError::at(
                                body.span,
                                format!("duplicate field `{}` in type `${}`", field.name, definition.name),
                            ));
                        }
                        let index = u32::try_from(fields.len()).map_err(|_| {
                            CompileError::at(body.span, "struct has too many fields")
                        })?;
                        let _ = index;
                        fields.push(self.interner.intern(&field.name));
                    }
                    (Some(TypeKind::Struct { fields }), true)
                }
                TypeLiteral::Enum(body) => {
                    let mut variants = Vec::with_capacity(body.variants.len());
                    let mut seen_variants = FxHashMap::default();
                    for variant in &body.variants {
                        if seen_variants.insert(variant.name.clone(), ()).is_some() {
                            return Err(CompileError::at(
                                body.span,
                                format!("duplicate enum variant `{}`", variant.name),
                            ));
                        }
                        if let Some((previous_type, _)) = self.variant_ids.get(&variant.name) {
                            let previous = self
                                .types
                                .get(previous_type.0 as usize)
                                .map(|ty| self.interner.names[ty.name.0 as usize].as_ref())
                                .unwrap_or("<unknown>");
                            return Err(CompileError::at(
                                body.span,
                                format!(
                                    "enum variant `{}` is ambiguous (already defined by `${}`)",
                                    variant.name, previous
                                ),
                            ));
                        }
                        variants.push(self.interner.intern(&variant.name));
                    }
                    (Some(TypeKind::Enum { variants }), true)
                }
                // Type aliases do not have runtime layouts.
                TypeLiteral::Named(_) | TypeLiteral::Fn(_) => (None, false),
            };
            if !runtime_name {
                continue;
            }
            if self.type_ids.contains_key(&definition.name) {
                return Err(CompileError::at(
                    definition.span,
                    format!("duplicate runtime type `${}`", definition.name),
                ));
            }
            let symbol = self.interner.intern(&definition.name);
            let type_id = TypeId(u32::try_from(self.types.len()).map_err(|_| {
                CompileError::at(definition.span, "program has too many runtime types")
            })?);
            let kind = kind.expect("runtime types have a layout");
            if let TypeKind::Enum { variants } = &kind {
                for (index, variant) in variants.iter().enumerate() {
                    let name = self.interner.names[variant.0 as usize].to_string();
                    self.variant_ids.insert(
                        name,
                        (type_id, u32::try_from(index).expect("enum variant count exceeds u32")),
                    );
                }
            }
            self.types.push(TypeDescriptor { name: symbol, kind });
            self.type_ids.insert(definition.name.clone(), type_id);
        }
        Ok(())
    }

    fn collect_functions(&mut self, program: &Program) -> Result<(), CompileError> {
        for item in &program.items {
            let TopLevel::Function(declaration) = item else { continue };
            if self.function_ids.contains_key(&declaration.name) {
                return Err(CompileError::at(
                    declaration.span,
                    format!("duplicate function `{}`", declaration.name),
                ));
            }
            let arity = u32::try_from(declaration.params.len())
                .map_err(|_| CompileError::at(declaration.span, "function has too many parameters"))?;
            let function_id = FunctionId(u32::try_from(self.functions.len())
                .map_err(|_| CompileError::at(declaration.span, "program has too many functions"))?);
            let name = self.interner.intern(&declaration.name);
            self.functions.push(Function {
                name,
                arity,
                local_count: 0,
                kind: FunctionKind::Bytecode(Vec::new()),
            });
            self.function_ids.insert(declaration.name.clone(), function_id);
            self.globals.push(Global { name, function: function_id });
        }

        for &(name, native_name, arity) in BUILTINS {
            if self.function_ids.contains_key(name) {
                continue;
            }
            let function_id = FunctionId(u32::try_from(self.functions.len())
                .map_err(|_| CompileError::program("program has too many functions"))?);
            let name_symbol = self.interner.intern(name);
            let native_symbol = self.interner.intern(native_name);
            self.functions.push(Function {
                name: name_symbol,
                arity,
                local_count: 0,
                kind: FunctionKind::Native(native_symbol),
            });
            self.function_ids.insert(name.to_owned(), function_id);
            self.globals.push(Global { name: name_symbol, function: function_id });
        }
        Ok(())
    }

    fn compile_functions(&mut self, program: &Program) -> Result<(), CompileError> {
        for item in &program.items {
            let TopLevel::Function(declaration) = item else { continue };
            let function_id = *self.function_ids.get(&declaration.name).ok_or_else(|| {
                CompileError::at(declaration.span, "internal error: missing function entry")
            })?;
            match &declaration.body {
                FunctionBody::Builtin(native_name) => {
                    self.check_builtin_arity(native_name, declaration.params.len(), declaration.span)?;
                    let native = self.interner.intern(native_name);
                    self.functions[function_id.0 as usize].kind = FunctionKind::Native(native);
                }
                FunctionBody::Expr(expression) => {
                    let (code, local_count) = {
                        let mut function_compiler = FunctionCompiler::new(self, declaration)?;
                        function_compiler.compile_expr(expression)?;
                        function_compiler.code.push(Instruction::Return);
                        (function_compiler.code, function_compiler.local_count)
                    };
                    let function = &mut self.functions[function_id.0 as usize];
                    function.local_count = local_count;
                    function.kind = FunctionKind::Bytecode(code);
                }
            }
        }
        Ok(())
    }

    fn check_builtin_arity(
        &self,
        native_name: &str,
        found: usize,
        span: Span,
    ) -> Result<(), CompileError> {
        let expected = BUILTINS
            .iter()
            .find_map(|(_, native, arity)| (*native == native_name).then_some(*arity as usize))
            .or_else(|| match native_name {
                "nativePrint" | "nativePrintln" | "consoleLog" | "nativeConsoleLog" => Some(1),
                _ => None,
            });
        if let Some(expected) = expected {
            if expected != found {
                return Err(CompileError::at(
                    span,
                    format!("native function `{native_name}` expects {expected} argument(s), found {found}"),
                ));
            }
        }
        Ok(())
    }
}

impl Default for Compiler {
    fn default() -> Self { Self::new() }
}

/// Convenience wrapper used by embedders and the command-line frontend.
pub fn compile(program: &Program) -> Result<Bytecode, CompileError> {
    Compiler::compile(program)
}

struct FunctionCompiler<'a> {
    compiler: &'a mut Compiler,
    code: Vec<Instruction>,
    scopes: Vec<FxHashMap<String, u32>>,
    local_count: u32,
}

impl<'a> FunctionCompiler<'a> {
    fn new(compiler: &'a mut Compiler, function: &FunctionDecl) -> Result<Self, CompileError> {
        let mut this = Self {
            compiler,
            code: Vec::new(),
            scopes: vec![FxHashMap::default()],
            local_count: 0,
        };
        for parameter in &function.params {
            let slot = this.allocate_local(function.span)?;
            // As in ordinary lexical scopes, a later parameter shadows an
            // earlier one with the same name.
            this.scopes[0].insert(parameter.name.clone(), slot);
        }
        Ok(this)
    }

    fn allocate_local(&mut self, span: Span) -> Result<u32, CompileError> {
        let slot = self.local_count;
        self.local_count = self.local_count.checked_add(1)
            .ok_or_else(|| CompileError::at(span, "function has too many local variables"))?;
        Ok(slot)
    }

    fn lookup_local(&self, name: &str) -> Option<u32> {
        self.scopes.iter().rev().find_map(|scope| scope.get(name).copied())
    }

    fn compile_expr(&mut self, expression: &Expr) -> Result<(), CompileError> {
        match expression {
            Expr::Lit(literal, span) => match literal {
                Literal::String(value) => self.code.push(Instruction::Const(
                    Constant::String(Arc::from(value.as_str()))
                )),
                Literal::Bool(value) => self.code.push(Instruction::Const(Constant::Bool(*value))),
                Literal::Number(text) => {
                    let normalized = text.replace('_', "");
                    if normalized.contains('.') {
                        let value = normalized.parse::<f64>().map_err(|_| {
                            CompileError::at(*span, format!("invalid floating-point literal `{text}`"))
                        })?;
                        if !value.is_finite() {
                            return Err(CompileError::at(*span, "floating-point literal is not finite"));
                        }
                        self.code.push(Instruction::Const(Constant::Float(value)));
                    } else {
                        let value = normalized.parse::<i64>().map_err(|_| {
                            CompileError::at(*span, format!("integer literal `{text}` is outside the Int range"))
                        })?;
                        self.code.push(Instruction::Const(Constant::Int(value)));
                    }
                }
            },
            Expr::Var(parts, span) => self.compile_variable(parts, *span)?,
            Expr::Paren(inner, _) => self.compile_expr(inner)?,
            Expr::If(expression) => self.compile_if(expression)?,
            Expr::Call(expression) => {
                self.compile_expr(&expression.callee)?;
                self.compile_expr(&expression.arg)?;
                self.code.push(Instruction::Apply);
            }
            Expr::Block(expression) => self.compile_block(expression)?,
            Expr::Struct(expression) => self.compile_struct(expression)?,
            Expr::Enum(expression) => self.compile_enum(expression)?,
        }
        Ok(())
    }

    fn compile_variable(&mut self, parts: &[String], span: Span) -> Result<(), CompileError> {
        let Some(first) = parts.first() else {
            return Err(CompileError::at(span, "empty variable path"));
        };
        if let Some(local) = self.lookup_local(first) {
            self.code.push(Instruction::LoadLocal(local));
        } else if self.compiler.function_ids.contains_key(first) {
            let symbol = self.compiler.interner.intern(first);
            self.code.push(Instruction::LoadGlobal(symbol));
        } else {
            return Err(CompileError::at(span, format!("undefined variable `{first}`")));
        }
        for field in &parts[1..] {
            let symbol = self.compiler.interner.intern(field);
            self.code.push(Instruction::GetField(symbol));
        }
        Ok(())
    }

    fn compile_if(&mut self, expression: &IfExpr) -> Result<(), CompileError> {
        self.compile_expr(&expression.cond)?;
        let branch = self.code.len();
        self.code.push(Instruction::JumpIfFalse(u32::MAX));
        self.compile_expr(&expression.then)?;
        let skip_else = self.code.len();
        self.code.push(Instruction::Jump(u32::MAX));
        let else_start = self.code.len();
        self.patch_jump_if_false(branch, else_start, expression.span)?;
        self.compile_expr(&expression.else_)?;
        let end = self.code.len();
        self.patch_jump(skip_else, end, expression.span)?;
        Ok(())
    }

    fn compile_block(&mut self, expression: &BlockExpr) -> Result<(), CompileError> {
        self.scopes.push(FxHashMap::default());
        let result = (|| {
            let mut bindings = Vec::with_capacity(expression.bindings.len());
            for binding in &expression.bindings {
                if self.scopes.last().unwrap().contains_key(&binding.name) {
                    return Err(CompileError::at(
                        expression.span,
                        format!("duplicate `where` binding `{}`", binding.name),
                    ));
                }
                let slot = self.allocate_local(expression.span)?;
                self.scopes.last_mut().unwrap().insert(binding.name.clone(), slot);
                bindings.push((binding, slot));
            }

            // Allocate every slot first, so where-bindings can refer forward
            // to another binding in the same block.
            for (binding, slot) in bindings {
                self.compile_expr(&binding.value)?;
                self.code.push(Instruction::StoreLocal(slot));
            }

            let mut breaks = Vec::new();
            for statement in &expression.stmts {
                match statement {
                    BlockStmt::Expr(statement) => {
                        self.compile_expr(statement)?;
                        self.code.push(Instruction::Pop);
                    }
                    BlockStmt::Break(value, span) => {
                        self.compile_expr(value)?;
                        let jump = self.code.len();
                        self.code.push(Instruction::Jump(u32::MAX));
                        breaks.push((jump, *span));
                    }
                }
            }
            self.compile_expr(&expression.final_expr)?;
            let end = self.code.len();
            for (jump, span) in breaks {
                self.patch_jump(jump, end, span)?;
            }
            Ok(())
        })();
        self.scopes.pop();
        result
    }

    fn compile_struct(&mut self, expression: &StructLit) -> Result<(), CompileError> {
        let type_id = *self.compiler.type_ids.get(&expression.name).ok_or_else(|| {
            CompileError::at(expression.span, format!("unknown runtime struct type `${}`", expression.name))
        })?;
        let field_symbols = match &self.compiler.types[type_id.0 as usize].kind {
            TypeKind::Struct { fields } => fields.clone(),
            TypeKind::Enum { .. } => {
                return Err(CompileError::at(expression.span, format!("`${}` is not a struct type", expression.name)));
            }
        };

        let mut field_indices = Vec::with_capacity(expression.fields.len());
        let mut seen = FxHashMap::default();
        // Keep source evaluation order, while recording the destination field
        // index for the compact vector representation used by the VM.
        for field in &expression.fields {
            let name = self.compiler.interner.intern(&field.name);
            if seen.insert(name, ()).is_some() {
                return Err(CompileError::at(
                    expression.span,
                    format!("field `{}` is initialized more than once", field.name),
                ));
            }
            let Some(index) = field_symbols.iter().position(|candidate| *candidate == name) else {
                return Err(CompileError::at(
                    expression.span,
                    format!("struct `${}` has no field `{}`", expression.name, field.name),
                ));
            };
            field_indices.push(u32::try_from(index).expect("field index exceeds u32"));
            self.compile_expr(&field.value)?;
        }
        if field_indices.len() != field_symbols.len() {
            let missing = field_symbols.iter().find(|symbol| !seen.contains_key(*symbol))
                .map(|symbol| self.compiler.interner.names[symbol.0 as usize].as_ref())
                .unwrap_or("<unknown>");
            return Err(CompileError::at(
                expression.span,
                format!("missing field `{missing}` in `${}` literal", expression.name),
            ));
        }
        self.code.push(Instruction::MakeStruct {
            type_id,
            field_indices: Arc::from(field_indices.into_boxed_slice()),
        });
        Ok(())
    }

    fn compile_enum(&mut self, expression: &EnumLit) -> Result<(), CompileError> {
        if let Some((type_id, variant_index)) = self.compiler.variant_ids.get(&expression.name).copied() {
            self.compile_expr(&expression.value)?;
            self.code.push(Instruction::MakeEnum { type_id, variant_index });
            return Ok(());
        }

        // The parser preserves uppercase `Name(expr)` as an enum candidate.
        // Resolve it as a function call if no enum owns `Name`.
        if !self.compiler.function_ids.contains_key(&expression.name) {
            return Err(CompileError::at(
                expression.span,
                format!("unknown enum variant or function `{}`", expression.name),
            ));
        }
        let symbol = self.compiler.interner.intern(&expression.name);
        self.code.push(Instruction::LoadGlobal(symbol));
        self.compile_expr(&expression.value)?;
        self.code.push(Instruction::Apply);
        Ok(())
    }

    fn patch_jump(&mut self, ip: usize, target: usize, span: Span) -> Result<(), CompileError> {
        let target = u32::try_from(target)
            .map_err(|_| CompileError::at(span, "function bytecode exceeds u32 jump range"))?;
        match self.code.get_mut(ip) {
            Some(Instruction::Jump(current)) if *current == u32::MAX => {
                *current = target;
                Ok(())
            }
            _ => Err(CompileError::at(span, "internal error while patching bytecode jump")),
        }
    }

    fn patch_jump_if_false(&mut self, ip: usize, target: usize, span: Span) -> Result<(), CompileError> {
        let target = u32::try_from(target)
            .map_err(|_| CompileError::at(span, "function bytecode exceeds u32 jump range"))?;
        match self.code.get_mut(ip) {
            Some(Instruction::JumpIfFalse(current)) if *current == u32::MAX => {
                *current = target;
                Ok(())
            }
            _ => Err(CompileError::at(span, "internal error while patching conditional jump")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vm::{Value, Vm};

    fn compile_and_run(source: &str) -> Value {
        let program = crate::parse(source).unwrap();
        let bytecode = compile(&program).unwrap();
        let mut vm = Vm::new(bytecode).unwrap();
        vm.run("main").unwrap()
    }

    #[test]
    fn typechecks_compiles_and_runs_the_sample_program() {
        let source = include_str!("../examples/sample.funky");
        let program = crate::parse(source).unwrap();
        let mut checker = crate::typeck::TypeChecker::new();
        checker.check_program(&program);
        assert!(
            !checker.has_errors(),
            "sample type errors: {}",
            checker.diags.iter().map(|diagnostic| diagnostic.kind.to_string()).collect::<Vec<_>>().join("\n")
        );
        let bytecode = compile(&program).unwrap();
        let mut vm = Vm::new(bytecode).unwrap();
        assert_eq!(vm.run("main").unwrap(), Value::Int(42));
    }

    #[test]
    fn compiles_and_runs_curried_calls() {
        let value = compile_and_run("main > $Int is add 19 23;");
        assert_eq!(value, Value::Int(42));
    }

    #[test]
    fn accepts_parenthesized_function_calls() {
        let value = compile_and_run("main > $Int is add (sub 5 3) 2;");
        assert_eq!(value, Value::Int(4));
    }

    #[test]
    fn handles_recursion_and_branches() {
        let value = compile_and_run(
            "factorial n: $Int > $Int is if le n 1 then 1 else mul n (factorial (sub n 1));\n\
             main > $Int is factorial 6;",
        );
        assert_eq!(value, Value::Int(720));
    }

    #[test]
    fn handles_locals_break_and_struct_fields() {
        let value = compile_and_run(
            "$Point is { x = $Int  y = $Int };\n\
             getX p: $Point > $Int is p.x;\n\
             main > $Int is do { break point.x; 0 } where { point = Point { x = 42  y = 0 } };",
        );
        assert_eq!(value, Value::Int(42));
    }

    #[test]
    fn constructs_generic_enum_values() {
        let value = compile_and_run(
            "$Option is $T => | Some = $T  None = $Unit |;\n\
             get option: $Option<$Int> > $Int is option.value;\n\
             main > $Int is get Some(42);",
        );
        assert_eq!(value, Value::Int(42));
    }

    #[test]
    fn errors_on_missing_struct_fields() {
        let program = crate::parse("$Point is { x = $Int  y = $Int }; main > $Point is Point { x = 1 };").unwrap();
        assert!(compile(&program).unwrap_err().message.contains("missing field"));
    }
}
