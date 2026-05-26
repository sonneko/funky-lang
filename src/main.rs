use app::parse;

fn main() {
    let input = r#"using a b as c from "mod"; $Int is $BuiltinInt;"#.to_string();
    match parse(input) {
        Ok(ast) => println!("Parsed: {:?}", ast),
        Err(e) => println!("Error: {}", e),
    }
}
