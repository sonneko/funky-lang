#![forbid(unsafe_code)]

//! Funky language frontend, bytecode compiler, and stack-based virtual machine.

pub mod ast;
pub mod bytecode;
pub mod compiler;
pub mod env;
pub mod lexer;
pub mod parser;
pub mod ty;
pub mod typeck;
pub mod vm;

pub use compiler::{compile, CompileError, Compiler};
pub use parser::parse;
pub use vm::{Value, Vm, VmConfig, VmError};

/// Parse and compile source into a verified bytecode image.
///
/// Type checking is intentionally a separate pass so embedders can choose
/// whether to accept dynamically checked source or require static diagnostics.
pub fn compile_source(source: &str) -> Result<bytecode::Bytecode, String> {
    let program = parse(source).map_err(|error| error.to_string())?;
    compiler::compile(&program).map_err(|error| error.to_string())
}
