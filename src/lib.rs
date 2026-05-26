pub mod ast;
pub mod lexer;
pub mod parser;

use logos::Logos;
use crate::lexer::Token;
use crate::ast::TopLevel;
use chumsky::Parser;

pub fn parse(program: String) -> Result<Vec<TopLevel>, String> {
    let lex = Token::lexer(&program);
    let tokens: Vec<_> = lex.map(|t| t.unwrap_or(Token::Identifier("ERROR".to_string()))).collect();

    crate::parser::parser()
        .parse(&tokens)
        .into_result()
        .map_err(|errs| {
            errs.into_iter()
                .map(|e| format!("{:?}", e))
                .collect::<Vec<_>>()
                .join("\n")
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_using() {
        let input = r#"using std as s from "std";"#.to_string();
        let result = parse(input).unwrap();
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn test_parse_function() {
        let input = r#"identity x:$T > $T is x;"#.to_string();
        let result = parse(input).unwrap();
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn test_parse_type_def() {
        let input = r#"$Int is { value = $BuiltinInt };"#.to_string();
        let result = parse(input).unwrap();
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn test_parse_enum_def() {
        let input = r#"$Option is $T => | Some = $T None = {} |;"#.to_string();
        let result = parse(input).unwrap();
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn test_parse_protocol_def() {
        let input = r#"^Show is { to_string = $Self > $String };"#.to_string();
        let result = parse(input).unwrap();
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn test_parse_if_else() {
        let input = r#"abs x:$Int > $Int is if x.is_pos then x else x.neg;"#.to_string();
        let result = parse(input).unwrap();
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn test_parse_do_where() {
        let input = r#"
            main > $Int is do {
                io.println p.name;
                0
            } where {
                p = Person { name = "Alice" }
            };
        "#.to_string();
        let result = parse(input).unwrap();
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn test_parse_complex() {
        let input = r#"
            using io from "std";
            $Option is $T => | Some = $T None = {} |;
            identity x:$T > $T is x;
            ^Show is { to_string = $Self > $String };
        "#.to_string();
        let result = parse(input).unwrap();
        assert_eq!(result.len(), 4);
    }

    #[test]
    fn test_parse_loop_break() {
        let input = r#"
            forever > $Unit is loop do {
                if stop then break {} else {}
            } where {
                stop = #check_stop
            };
        "#.to_string();
        let result = parse(input).unwrap();
        assert_eq!(result.len(), 1);
    }
}
