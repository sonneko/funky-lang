use std::path::{Path, PathBuf};

use anyhow::{anyhow, bail, Context, Result};
use clap::{CommandFactory, Parser, Subcommand};
use funkylang::{bytecode::Bytecode, compiler, parse, typeck::TypeChecker, Vm, VmConfig};
use rustyline::error::ReadlineError;

#[derive(Debug, Parser)]
#[command(name = "funkylang", version, about = "Compile and run Funky bytecode programs")]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
    /// Run a source file directly (shorthand for `funkylang run FILE`).
    #[arg(value_name = "FILE")]
    file: Option<PathBuf>,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Parse, type-check, and verify a source file.
    Check {
        file: PathBuf,
    },
    /// Compile a source file to a portable `.fbc` bytecode file.
    Compile {
        file: PathBuf,
        #[arg(short, long)]
        output: Option<PathBuf>,
        /// Skip static type checking; runtime checks still apply.
        #[arg(long)]
        no_typecheck: bool,
    },
    /// Compile (if needed) and execute a program.
    Run {
        file: PathBuf,
        /// Zero-argument global to invoke.
        #[arg(short, long, default_value = "main")]
        entry: String,
        /// Maximum number of bytecode instructions to execute.
        #[arg(long, default_value_t = 10_000_000)]
        fuel: u64,
        /// Skip static type checking; runtime checks still apply.
        #[arg(long)]
        no_typecheck: bool,
    },
    /// Print human-readable bytecode instructions.
    Disassemble {
        file: PathBuf,
    },
    /// Start a line-editing expression REPL.
    Repl,
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Some(Command::Check { file }) => check_file(&file),
        Some(Command::Compile { file, output, no_typecheck }) => {
            compile_file(&file, output, !no_typecheck)
        }
        Some(Command::Run { file, entry, fuel, no_typecheck }) => {
            run_file(&file, &entry, fuel, !no_typecheck)
        }
        Some(Command::Disassemble { file }) => disassemble_file(&file),
        Some(Command::Repl) => repl(),
        None => match cli.file {
            Some(file) => run_file(&file, "main", VmConfig::default().fuel, true),
            None => {
                Cli::command().print_help()?;
                println!();
                Ok(())
            }
        },
    }
}

fn read_source(path: &Path) -> Result<String> {
    std::fs::read_to_string(path)
        .with_context(|| format!("could not read source file `{}`", path.display()))
}

fn parse_source(source: &str, path: &Path) -> Result<funkylang::ast::Program> {
    parse(source).map_err(|error| anyhow!("{}: {error}", path.display()))
}

fn typecheck(program: &funkylang::ast::Program, path: &Path) -> Result<()> {
    let mut checker = TypeChecker::new();
    checker.check_program(program);
    if checker.has_errors() {
        let diagnostics = checker
            .diags
            .iter()
            .map(|diagnostic| {
                format!(
                    "  {}:{}..{}: {}",
                    path.display(),
                    diagnostic.span.start,
                    diagnostic.span.end,
                    diagnostic.kind
                )
            })
            .collect::<Vec<_>>()
            .join("\n");
        bail!("type checking failed:\n{diagnostics}");
    }
    Ok(())
}

fn compile_source_file(path: &Path, check_types: bool) -> Result<Bytecode> {
    let source = read_source(path)?;
    let program = parse_source(&source, path)?;
    if check_types {
        typecheck(&program, path)?;
    }
    compiler::compile(&program).map_err(|error| anyhow!("{}: {error}", path.display()))
}

fn check_file(path: &Path) -> Result<()> {
    let source = read_source(path)?;
    let program = parse_source(&source, path)?;
    typecheck(&program, path)?;
    compiler::compile(&program).map_err(|error| anyhow!("{}: {error}", path.display()))?;
    println!("{}: ok ({} top-level declarations)", path.display(), program.items.len());
    Ok(())
}

fn compile_file(path: &Path, output: Option<PathBuf>, check_types: bool) -> Result<()> {
    let bytecode = compile_source_file(path, check_types)?;
    let output = output.unwrap_or_else(|| path.with_extension("fbc"));
    let bytes = bytecode.to_bytes().context("could not serialize bytecode")?;
    std::fs::write(&output, bytes)
        .with_context(|| format!("could not write bytecode file `{}`", output.display()))?;
    println!(
        "compiled {} function(s) to {}",
        bytecode.functions.len(),
        output.display()
    );
    Ok(())
}

fn load_bytecode(path: &Path) -> Result<Bytecode> {
    let bytes = std::fs::read(path)
        .with_context(|| format!("could not read bytecode file `{}`", path.display()))?;
    Bytecode::from_bytes(&bytes).map_err(|error| anyhow!("{}: {error}", path.display()))
}

fn run_file(path: &Path, entry: &str, fuel: u64, check_types: bool) -> Result<()> {
    let bytecode = if path.extension().and_then(|extension| extension.to_str()) == Some("fbc") {
        load_bytecode(path)?
    } else {
        compile_source_file(path, check_types)?
    };
    let mut vm = Vm::with_config(bytecode, VmConfig { fuel, ..VmConfig::default() })
        .with_context(|| format!("could not initialize VM for `{}`", path.display()))?;
    let value = vm.run(entry).with_context(|| {
        format!("execution of `{}` (entry `{entry}`) failed", path.display())
    })?;
    if !value.is_unit() {
        println!("{}", vm.format_value(&value));
    }
    Ok(())
}

fn disassemble_file(path: &Path) -> Result<()> {
    let bytecode = load_bytecode(path)?;
    print!("{}", bytecode.disassemble());
    Ok(())
}

fn repl() -> Result<()> {
    let mut editor = rustyline::DefaultEditor::new().context("could not initialize line editor")?;
    println!("Funky expression REPL — :help for help, :quit to exit");
    loop {
        match editor.readline("funky> ") {
            Ok(line) => {
                let expression = line.trim();
                if expression.is_empty() {
                    continue;
                }
                let _ = editor.add_history_entry(expression);
                if matches!(expression, ":quit" | ":q" | ":exit") {
                    break;
                }
                if expression == ":help" {
                    println!("Enter one Funky expression per line. :quit exits.\nExample: add 20 22");
                    continue;
                }
                let expression = expression.strip_suffix(';').unwrap_or(expression);
                let source = format!("__repl > $Unit is {expression};");
                match funkylang::compile_source(&source) {
                    Ok(bytecode) => match Vm::new(bytecode).and_then(|mut vm| vm.run("__repl").map(|value| (value, vm))) {
                        Ok((value, vm)) => println!("{}", vm.format_value(&value)),
                        Err(error) => eprintln!("runtime error: {error}"),
                    },
                    Err(error) => eprintln!("error: {error}"),
                }
            }
            Err(ReadlineError::Interrupted) => {
                println!("^C");
            }
            Err(ReadlineError::Eof) => break,
            Err(error) => return Err(anyhow!(error)).context("line editor failed"),
        }
    }
    Ok(())
}
