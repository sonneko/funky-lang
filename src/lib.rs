pub mod ast;
pub mod env;
pub mod lexer;
pub mod parser;
pub mod ty;
pub mod typeck;

pub use parser::parse;
