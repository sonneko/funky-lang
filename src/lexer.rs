use logos::Logos;

#[derive(Logos, Debug, Clone, PartialEq)]
#[logos(skip r"[ \t\n\f]+")]
pub enum Token {
    #[token("using")]
    Using,
    #[token("as")]
    As,
    #[token("from")]
    From,
    #[token("is")]
    Is,
    #[token("if")]
    If,
    #[token("then")]
    Then,
    #[token("else")]
    Else,
    #[token("loop")]
    Loop,
    #[token("do")]
    Do,
    #[token("break")]
    Break,
    #[token("where")]
    Where,

    #[regex(r"[a-zA-Z_][a-zA-Z0-9_]*", |lex| lex.slice().to_string())]
    Identifier(String),

    #[regex(r#""([^"\\]|\\.)*""#, |lex| {
        let s = lex.slice();
        s[1..s.len()-1].to_string()
    })]
    StringLiteral(String),

    #[regex(r"[0-9]+\.[0-9]+", |lex| lex.slice().parse::<f64>().ok())]
    FloatLiteral(f64),

    #[regex(r"[0-9]+", |lex| lex.slice().parse::<i64>().ok())]
    IntLiteral(i64),

    #[token(";")]
    Semicolon,
    #[token(":")]
    Colon,
    #[token("$")]
    Dollar,
    #[token("^")]
    Caret,
    #[token(">")]
    RAngle,
    #[token("=>")]
    FatArrow,
    #[token("{")]
    LBrace,
    #[token("}")]
    RBrace,
    #[token("|")]
    Pipe,
    #[token("=")]
    Eq,
    #[token("(")]
    LParen,
    #[token(")")]
    RParen,
    #[token(".")]
    Dot,
    #[token(",")]
    Comma,
    #[token("#")]
    Hash,
    #[token("<")]
    LAngle,
    #[token("+")]
    Plus,
}
