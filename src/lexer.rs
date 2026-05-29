use crate::ast::Span;

// ============================================================
// トークン種別
// ============================================================

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TokenKind {
    // リテラル
    Ident(String),
    StringLit(String),
    NumberLit(String),
    BoolLit(bool),

    // キーワード
    Using,
    As,
    From,
    Is,
    Do,
    Where,
    If,
    Then,
    Else,
    Break,

    // 記号
    Dollar,   // $
    Caret,    // ^
    Hash,     // #
    Arrow,    // =>
    Gt,       // >
    Lt,       // <
    Plus,     // +
    Eq,       // =
    Colon,    // :
    Dot,      // .
    Pipe,     // |
    Semi,     // ;
    LParen,   // (
    RParen,   // )
    LBrace,   // {
    RBrace,   // }

    Eof,
}

impl TokenKind {
    /// デバッグ用の表示文字列
    pub fn display(&self) -> &'static str {
        match self {
            TokenKind::Using    => "'using'",
            TokenKind::As       => "'as'",
            TokenKind::From     => "'from'",
            TokenKind::Is       => "'is'",
            TokenKind::Do       => "'do'",
            TokenKind::Where    => "'where'",
            TokenKind::If       => "'if'",
            TokenKind::Then     => "'then'",
            TokenKind::Else     => "'else'",
            TokenKind::Break    => "'break'",
            TokenKind::Dollar   => "'$'",
            TokenKind::Caret    => "'^'",
            TokenKind::Hash     => "'#'",
            TokenKind::Arrow    => "'=>'",
            TokenKind::Gt       => "'>'",
            TokenKind::Lt       => "'<'",
            TokenKind::Plus     => "'+'",
            TokenKind::Eq       => "'='",
            TokenKind::Colon    => "':'",
            TokenKind::Dot      => "'.'",
            TokenKind::Pipe     => "'|'",
            TokenKind::Semi     => "';'",
            TokenKind::LParen   => "'('",
            TokenKind::RParen   => "')'",
            TokenKind::LBrace   => "'{'",
            TokenKind::RBrace   => "'}'",
            TokenKind::Eof      => "<eof>",
            TokenKind::Ident(_) => "<ident>",
            TokenKind::StringLit(_) => "<string>",
            TokenKind::NumberLit(_) => "<number>",
            TokenKind::BoolLit(_)   => "<bool>",
        }
    }
}

// ============================================================
// トークン
// ============================================================

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Token {
    pub kind: TokenKind,
    pub span: Span,
}

impl Token {
    pub fn new(kind: TokenKind, start: usize, end: usize) -> Self {
        Self { kind, span: Span::new(start, end) }
    }
}

// ============================================================
// エラー
// ============================================================

#[derive(Debug, Clone)]
pub struct LexError {
    pub message: String,
    pub pos: usize,
}

impl LexError {
    pub fn new(message: impl Into<String>, pos: usize) -> Self {
        Self { message: message.into(), pos }
    }
}

impl std::fmt::Display for LexError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "lex error at {}: {}", self.pos, self.message)
    }
}

impl std::error::Error for LexError {}

// ============================================================
// Lexer
// ============================================================

pub struct Lexer<'src> {
    src: &'src [u8],
    pos: usize,
}

impl<'src> Lexer<'src> {
    pub fn new(src: &'src str) -> Self {
        Self { src: src.as_bytes(), pos: 0 }
    }

    // ---- 基本操作 ----

    fn peek(&self) -> Option<u8> {
        self.src.get(self.pos).copied()
    }

    fn peek2(&self) -> Option<u8> {
        self.src.get(self.pos + 1).copied()
    }

    fn advance(&mut self) -> u8 {
        let c = self.src[self.pos];
        self.pos += 1;
        c
    }

    fn skip_while(&mut self, pred: impl Fn(u8) -> bool) {
        while self.peek().map_or(false, &pred) {
            self.pos += 1;
        }
    }

    // ---- 空白・コメントスキップ ----

    fn skip_trivia(&mut self) -> Result<(), LexError> {
        loop {
            self.skip_while(|c| c.is_ascii_whitespace());
            // `/* ... */` ブロックコメント
            if self.peek() == Some(b'/') && self.peek2() == Some(b'*') {
                let start = self.pos;
                self.pos += 2;
                loop {
                    if self.pos >= self.src.len() {
                        return Err(LexError::new("unterminated block comment", start));
                    }
                    if self.src[self.pos] == b'*' && self.src.get(self.pos + 1) == Some(&b'/') {
                        self.pos += 2;
                        break;
                    }
                    self.pos += 1;
                }
            } else {
                break;
            }
        }
        Ok(())
    }

    // ---- 文字列リテラル ----

    fn lex_string(&mut self, start: usize) -> Result<Token, LexError> {
        let quote = self.advance(); // ' or "
        let mut s = String::new();
        loop {
            match self.peek() {
                None => return Err(LexError::new("unterminated string literal", start)),
                Some(b'\\') => {
                    self.advance();
                    match self.peek() {
                        None => return Err(LexError::new("unterminated escape", start)),
                        Some(c) => {
                            self.advance();
                            match c {
                                b'n'  => s.push('\n'),
                                b't'  => s.push('\t'),
                                b'r'  => s.push('\r'),
                                b'\\' => s.push('\\'),
                                b'\'' => s.push('\''),
                                b'"'  => s.push('"'),
                                other => {
                                    s.push('\\');
                                    s.push(other as char);
                                }
                            }
                        }
                    }
                }
                Some(c) if c == quote => {
                    self.advance();
                    break;
                }
                Some(c) => {
                    // UTF-8バイト列として正しく処理
                    let byte_start = self.pos;
                    self.pos += 1;
                    // マルチバイト文字の続きバイトをまとめて読む
                    while self.peek().map_or(false, |b| b & 0b1100_0000 == 0b1000_0000) {
                        self.pos += 1;
                    }
                    let slice = &self.src[byte_start..self.pos];
                    s.push_str(std::str::from_utf8(slice)
                        .map_err(|_| LexError::new("invalid UTF-8 in string", byte_start))?);
                    let _ = c; // suppress warning
                }
            }
        }
        Ok(Token::new(TokenKind::StringLit(s), start, self.pos))
    }

    // ---- 数値リテラル ----

    fn lex_number(&mut self, start: usize) -> Token {
        while self.peek().map_or(false, |c| c.is_ascii_digit() || c == b'.' || c == b'_') {
            self.advance();
        }
        let s = std::str::from_utf8(&self.src[start..self.pos]).unwrap().to_owned();
        Token::new(TokenKind::NumberLit(s), start, self.pos)
    }

    // ---- 識別子・キーワード ----

    fn lex_ident(&mut self, start: usize) -> Token {
        while self.peek().map_or(false, |c| c.is_ascii_alphanumeric() || c == b'_') {
            self.advance();
        }
        let s = std::str::from_utf8(&self.src[start..self.pos]).unwrap();
        let kind = match s {
            "using" => TokenKind::Using,
            "as"    => TokenKind::As,
            "from"  => TokenKind::From,
            "is"    => TokenKind::Is,
            "do"    => TokenKind::Do,
            "where" => TokenKind::Where,
            "if"    => TokenKind::If,
            "then"  => TokenKind::Then,
            "else"  => TokenKind::Else,
            "break" => TokenKind::Break,
            "true"  => TokenKind::BoolLit(true),
            "false" => TokenKind::BoolLit(false),
            other   => TokenKind::Ident(other.to_owned()),
        };
        Token::new(kind, start, self.pos)
    }

    // ---- 次のトークンを1つ読む ----

    fn next_token(&mut self) -> Result<Token, LexError> {
        self.skip_trivia()?;
        let start = self.pos;

        let c = match self.peek() {
            None => return Ok(Token::new(TokenKind::Eof, start, start)),
            Some(c) => c,
        };

        // 文字列
        if c == b'"' || c == b'\'' {
            return self.lex_string(start);
        }

        // 数値
        if c.is_ascii_digit() {
            self.advance();
            return Ok(self.lex_number(start));
        }

        // 識別子・キーワード
        if c.is_ascii_alphabetic() || c == b'_' {
            self.advance();
            return Ok(self.lex_ident(start));
        }

        // `=>` vs `=`
        if c == b'=' {
            self.advance();
            if self.peek() == Some(b'>') {
                self.advance();
                return Ok(Token::new(TokenKind::Arrow, start, self.pos));
            }
            return Ok(Token::new(TokenKind::Eq, start, self.pos));
        }

        // 単一文字記号
        self.advance();
        let kind = match c {
            b'$'  => TokenKind::Dollar,
            b'^'  => TokenKind::Caret,
            b'#'  => TokenKind::Hash,
            b'>'  => TokenKind::Gt,
            b'<'  => TokenKind::Lt,
            b'+'  => TokenKind::Plus,
            b':'  => TokenKind::Colon,
            b'.'  => TokenKind::Dot,
            b'|'  => TokenKind::Pipe,
            b';'  => TokenKind::Semi,
            b'('  => TokenKind::LParen,
            b')'  => TokenKind::RParen,
            b'{'  => TokenKind::LBrace,
            b'}'  => TokenKind::RBrace,
            other => return Err(LexError::new(
                format!("unexpected character '{}'", other as char), start
            )),
        };
        Ok(Token::new(kind, start, self.pos))
    }

    // ---- 全トークンをVecに変換 ----

    pub fn tokenize(mut self) -> Result<Vec<Token>, LexError> {
        let mut tokens = Vec::new();
        loop {
            let tok = self.next_token()?;
            let is_eof = tok.kind == TokenKind::Eof;
            tokens.push(tok);
            if is_eof { break; }
        }
        Ok(tokens)
    }
}

/// 便利関数
pub fn tokenize(src: &str) -> Result<Vec<Token>, LexError> {
    Lexer::new(src).tokenize()
}

// ============================================================
// テスト
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(src: &str) -> Vec<TokenKind> {
        tokenize(src).unwrap().into_iter().map(|t| t.kind).collect()
    }

    #[test]
    fn block_comment_skipped() {
        let ks = kinds("/* hello */ foo");
        assert_eq!(ks, vec![TokenKind::Ident("foo".into()), TokenKind::Eof]);
    }

    #[test]
    fn nested_comment_flat() {
        // `/* b /* c */` まで一つのコメントとして扱い、`d` が残る
        let ks = kinds("a /* b /* c */ d");
        assert_eq!(ks, vec![
            TokenKind::Ident("a".into()),
            TokenKind::Ident("d".into()),
            TokenKind::Eof,
        ]);
    }

    #[test]
    fn keywords() {
        let ks = kinds("using as from is do where if then else break");
        assert_eq!(ks, vec![
            TokenKind::Using, TokenKind::As, TokenKind::From,
            TokenKind::Is, TokenKind::Do, TokenKind::Where,
            TokenKind::If, TokenKind::Then, TokenKind::Else, TokenKind::Break,
            TokenKind::Eof,
        ]);
    }

    #[test]
    fn bool_literals() {
        let ks = kinds("true false");
        assert_eq!(ks, vec![TokenKind::BoolLit(true), TokenKind::BoolLit(false), TokenKind::Eof]);
    }

    #[test]
    fn string_escape() {
        let ks = tokenize(r#""hello \"world\"""#).unwrap();
        assert_eq!(ks[0].kind, TokenKind::StringLit(r#"hello "world""#.into()));
    }

    #[test]
    fn number() {
        let ks = kinds("42 3.14");
        assert_eq!(ks[0], TokenKind::NumberLit("42".into()));
        assert_eq!(ks[1], TokenKind::NumberLit("3.14".into()));
    }

    #[test]
    fn arrow() {
        let ks = kinds("=>");
        assert_eq!(ks[0], TokenKind::Arrow);
    }

    #[test]
    fn eq_vs_arrow() {
        let ks = kinds("= =>");
        assert_eq!(ks[0], TokenKind::Eq);
        assert_eq!(ks[1], TokenKind::Arrow);
    }

    #[test]
    fn unterminated_string_error() {
        assert!(tokenize(r#""oops"#).is_err());
    }

    #[test]
    fn unterminated_comment_error() {
        assert!(tokenize("/* oops").is_err());
    }

    #[test]
    fn unexpected_char_error() {
        assert!(tokenize("@").is_err());
    }

    #[test]
    fn span_correctness() {
        let toks = tokenize("foo bar").unwrap();
        assert_eq!(toks[0].span, Span::new(0, 3));
        assert_eq!(toks[1].span, Span::new(4, 7));
    }
}
