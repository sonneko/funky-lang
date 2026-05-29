use std::path::PathBuf;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("usage: lang <file.funky>");
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

    match lang::parse(&src) {
        Ok(program) => {
            println!("parsed {} top-level items:", program.items.len());
            for item in &program.items {
                match item {
                    lang::ast::TopLevel::Using(u)    =>
                        println!("  using ... from {:?}", u.from),
                    lang::ast::TopLevel::Function(f) =>
                        println!("  fn  {}", f.name),
                    lang::ast::TopLevel::TypeDef(t)  =>
                        println!("  type ${}", t.name),
                    lang::ast::TopLevel::Protocol(p) =>
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
