use std::path::PathBuf;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("usage: funkylang <file.funky>");
        std::process::exit(1);
    }

    let path = PathBuf::from(&args[1]);
    let src = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("error reading {}: {}", path.display(), e);
            std::process::exit(1);
        }
    };

    match funkylang::parse(&src) {
        Ok(program) => {
            println!("parsed {} top-level items:", program.items.len());
            for item in &program.items {
                match item {
                    funkylang::ast::TopLevel::Using(u)    =>
                        println!("  using ... from {:?}", u.from),
                    funkylang::ast::TopLevel::Function(f) =>
                        println!("  fn  {}", f.name),
                    funkylang::ast::TopLevel::TypeDef(t)  =>
                        println!("  type ${}", t.name),
                    funkylang::ast::TopLevel::Protocol(p) =>
                        println!("  protocol ^{}", p.name),
                }
            }
        }
        Err(e) => {
            eprintln!("error: {}", e);
            std::process::exit(1);
        }
    }
}
