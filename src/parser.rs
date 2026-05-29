use crate::ast::*;
use crate::lexer::{Token, TokenKind};

// ============================================================
// エラー
// ============================================================

#[derive(Debug, Clone)]
pub struct ParseError {
    pub message: String,
    pub span: Span,
}

impl ParseError {
    fn new(message: impl Into<String>, span: Span) -> Self {
        Self { message: message.into(), span }
    }
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "parse error at {}..{}: {}", self.span.start, self.span.end, self.message)
    }
}

impl std::error::Error for ParseError {}

// ============================================================
// パーサー本体
// ============================================================

pub struct Parser {
    tokens: Vec<Token>,
    pos: usize,
}

impl Parser {
    pub fn new(tokens: Vec<Token>) -> Self {
        Self { tokens, pos: 0 }
    }

    // ---- 基本ヘルパー ----

    fn peek(&self) -> &Token {
        &self.tokens[self.pos]
    }

    fn peek2(&self) -> &Token {
        let i = (self.pos + 1).min(self.tokens.len() - 1);
        &self.tokens[i]
    }

    fn peek_at(&self, offset: usize) -> &Token {
        let i = (self.pos + offset).min(self.tokens.len() - 1);
        &self.tokens[i]
    }

    fn advance(&mut self) -> &Token {
        let t = &self.tokens[self.pos];
        if self.pos + 1 < self.tokens.len() {
            self.pos += 1;
        }
        t
    }

    fn at(&self, kind: &TokenKind) -> bool {
        std::mem::discriminant(&self.peek().kind) == std::mem::discriminant(kind)
    }

    fn at_ident(&self) -> bool {
        matches!(self.peek().kind, TokenKind::Ident(_))
    }

    fn expect_ident(&mut self) -> Result<(String, Span), ParseError> {
        let t = self.peek().clone();
        match t.kind {
            TokenKind::Ident(ref s) => {
                self.advance();
                Ok((s.clone(), t.span))
            }
            _ => Err(ParseError::new(
                format!("expected identifier, got {}", t.kind.display()),
                t.span,
            )),
        }
    }

    fn expect(&mut self, kind: &TokenKind) -> Result<Span, ParseError> {
        let t = self.peek().clone();
        if std::mem::discriminant(&t.kind) == std::mem::discriminant(kind) {
            self.advance();
            Ok(t.span)
        } else {
            Err(ParseError::new(
                format!("expected {}, got {}", kind.display(), t.kind.display()),
                t.span,
            ))
        }
    }

    fn try_eat(&mut self, kind: &TokenKind) -> Option<Span> {
        if std::mem::discriminant(&self.peek().kind) == std::mem::discriminant(kind) {
            let s = self.peek().span;
            self.advance();
            Some(s)
        } else {
            None
        }
    }

    // ============================================================
    // プログラム
    // ============================================================

    pub fn parse_program(&mut self) -> Result<Program, ParseError> {
        let mut items = Vec::new();
        while !matches!(self.peek().kind, TokenKind::Eof) {
            items.push(self.parse_top_level()?);
        }
        Ok(Program { items })
    }

    fn parse_top_level(&mut self) -> Result<TopLevel, ParseError> {
        match self.peek().kind.clone() {
            TokenKind::Using   => Ok(TopLevel::Using(self.parse_using()?)),
            TokenKind::Dollar  => Ok(TopLevel::TypeDef(self.parse_type_def()?)),
            TokenKind::Caret   => Ok(TopLevel::Protocol(self.parse_protocol_def()?)),
            TokenKind::Ident(_)=> Ok(TopLevel::Function(self.parse_function_decl()?)),
            _ => {
                let t = self.peek().clone();
                Err(ParseError::new(
                    format!("unexpected token at top level: {}", t.kind.display()),
                    t.span,
                ))
            }
        }
    }

    // ============================================================
    // using foo as f bar from "lib";
    // ============================================================

    fn parse_using(&mut self) -> Result<UsingDecl, ParseError> {
        let start = self.expect(&TokenKind::Using)?;
        let mut imports = Vec::new();

        while !matches!(self.peek().kind, TokenKind::From | TokenKind::Eof) {
            let (name, _) = self.expect_ident()?;
            let alias = if self.try_eat(&TokenKind::As).is_some() {
                Some(self.expect_ident()?.0)
            } else {
                None
            };
            imports.push(Import { name, alias });
        }

        self.expect(&TokenKind::From)?;
        let (from, _) = self.expect_string()?;
        let end = self.expect(&TokenKind::Semi)?;

        Ok(UsingDecl { imports, from, span: start.merge(end) })
    }

    fn expect_string(&mut self) -> Result<(String, Span), ParseError> {
        let t = self.peek().clone();
        match t.kind {
            TokenKind::StringLit(ref s) => {
                self.advance();
                Ok((s.clone(), t.span))
            }
            _ => Err(ParseError::new(
                format!("expected string literal, got {}", t.kind.display()),
                t.span,
            )),
        }
    }

    // ============================================================
    // $Foo is <type>;
    // ============================================================

    fn parse_type_def(&mut self) -> Result<TypeDef, ParseError> {
        let start = self.expect(&TokenKind::Dollar)?;
        let (name, _) = self.expect_ident()?;
        self.expect(&TokenKind::Is)?;
        let ty = self.parse_type_literal(false)?;
        let end = self.expect(&TokenKind::Semi)?;
        Ok(TypeDef { name, ty, span: start.merge(end) })
    }

    // ============================================================
    // ^Show is { ... };
    // ============================================================

    fn parse_protocol_def(&mut self) -> Result<ProtocolDef, ParseError> {
        let start = self.expect(&TokenKind::Caret)?;
        let (name, _) = self.expect_ident()?;
        self.expect(&TokenKind::Is)?;
        let body = self.parse_protocol_body()?;
        let end = self.expect(&TokenKind::Semi)?;
        Ok(ProtocolDef { name, body, span: start.merge(end) })
    }

    fn parse_protocol_body(&mut self) -> Result<ProtocolBodyOrLiteral, ParseError> {
        if matches!(self.peek().kind, TokenKind::LBrace) {
            self.parse_protocol_def_body().map(ProtocolBodyOrLiteral::Body)
        } else {
            self.parse_protocol_literal().map(ProtocolBodyOrLiteral::Literal)
        }
    }

    /// `{ method = fn_type* }`
    fn parse_protocol_def_body(&mut self) -> Result<ProtocolDefinitionBody, ParseError> {
        let start = self.expect(&TokenKind::LBrace)?;
        let mut methods = Vec::new();
        while !matches!(self.peek().kind, TokenKind::RBrace | TokenKind::Eof) {
            let (name, _) = self.expect_ident()?;
            self.expect(&TokenKind::Eq)?;
            let ty = self.parse_fn_type_body()?;
            methods.push(ProtocolMethod { name, ty });
        }
        let end = self.expect(&TokenKind::RBrace)?;
        Ok(ProtocolDefinitionBody { methods, span: start.merge(end) })
    }

    /// `^Show + ^Eq`
    fn parse_protocol_literal(&mut self) -> Result<ProtocolLiteral, ParseError> {
        let start = self.expect(&TokenKind::Caret)?;
        let mut names = vec![self.expect_ident()?.0];
        while self.try_eat(&TokenKind::Plus).is_some() {
            self.expect(&TokenKind::Caret)?;
            names.push(self.expect_ident()?.0);
        }
        let end = self.peek().span;
        Ok(ProtocolLiteral { names, span: start.merge(end) })
    }

    // ============================================================
    // 関数宣言
    //   name ($T: ^Show)* => param* > RetType is body;
    // ============================================================

    fn parse_function_decl(&mut self) -> Result<FunctionDecl, ParseError> {
        let (name, start) = self.expect_ident()?;

        // プロトコル制約リスト: ($T: ^...)* =>
        let mut protocol_constraints = Vec::new();
        if self.is_fn_protocol_list_start() {
            while matches!(self.peek().kind, TokenKind::Dollar)
                && matches!(self.peek2().kind, TokenKind::Ident(_))
                && matches!(self.peek_at(2).kind, TokenKind::Colon)
            {
                self.advance(); // $
                let (pname, _) = self.expect_ident()?;
                self.expect(&TokenKind::Colon)?;
                let body = self.parse_protocol_body()?;
                protocol_constraints.push(FnProtocolConstraint { name: pname, body });
                if matches!(self.peek().kind, TokenKind::Arrow) { break; }
            }
            self.expect(&TokenKind::Arrow)?;
        }

        // パラメータリスト: (name: Type)*
        let mut params = Vec::new();
        while self.at_ident() && matches!(self.peek2().kind, TokenKind::Colon) {
            let (pname, _) = self.expect_ident()?;
            self.expect(&TokenKind::Colon)?;
            let ty = self.parse_type_literal(true)?; // insideFnParam
            params.push(Param { name: pname, ty });
        }
        self.expect(&TokenKind::Gt)?;
        let return_ty = self.parse_type_literal(false)?;

        self.expect(&TokenKind::Is)?;

        let body = if self.try_eat(&TokenKind::Hash).is_some() {
            FunctionBody::Builtin(self.expect_ident()?.0)
        } else {
            FunctionBody::Expr(self.parse_expr()?)
        };

        let end = self.expect(&TokenKind::Semi)?;
        Ok(FunctionDecl {
            name, protocol_constraints, params, return_ty, body,
            span: start.merge(end),
        })
    }

    /// `$T: ^...` が先頭にあるかチェック
    fn is_fn_protocol_list_start(&self) -> bool {
        matches!(self.peek().kind, TokenKind::Dollar)
            && matches!(self.peek2().kind, TokenKind::Ident(_))
            && matches!(self.peek_at(2).kind, TokenKind::Colon)
            && matches!(self.peek_at(3).kind, TokenKind::Caret | TokenKind::LBrace)
    }

    // ============================================================
    // 型リテラル
    // ============================================================

    /// insideFnParam=true のとき、`$T >` の `>` を fn型矢印として消費しない
    fn parse_type_literal(&mut self, inside_fn_param: bool) -> Result<TypeLiteral, ParseError> {
        // struct/enum 型パラメータ付きを先にチェック（`$A $B => {` など）
        if self.is_struct_type_start() {
            return self.parse_struct_type().map(TypeLiteral::Struct);
        }
        if self.is_enum_type_start() {
            return self.parse_enum_type().map(TypeLiteral::Enum);
        }

        // プロトコル制約付き fn型
        if self.is_fn_type_protocol_start() {
            return self.parse_fn_type_body().map(|f| TypeLiteral::Fn(Box::new(f)));
        }

        match self.peek().kind.clone() {
            TokenKind::Dollar => {
                self.advance(); // $
                let (name, span) = self.expect_ident()?;
                // `<T1 T2>` 型引数
                let args = if self.try_eat(&TokenKind::Lt).is_some() {
                    let mut a = Vec::new();
                    while !matches!(self.peek().kind, TokenKind::Gt | TokenKind::Eof) {
                        a.push(self.parse_type_literal(true)?);
                    }
                    self.expect(&TokenKind::Gt)?;
                    a
                } else {
                    Vec::new()
                };
                let named = NamedType { name, args, span };
                // fn型: `$T >` の形
                if !inside_fn_param && matches!(self.peek().kind, TokenKind::Gt) {
                    self.advance(); // >
                    let return_ty = if self.is_fn_type_protocol_start() {
                        FnReturn::Fn(Box::new(self.parse_fn_type_body()?))
                    } else {
                        FnReturn::Type(self.parse_type_literal(false)?)
                    };
                    return Ok(TypeLiteral::Fn(Box::new(FnTypeBody {
                        protocols: Vec::new(),
                        param_ty: TypeLiteral::Named(named),
                        return_ty,
                        span,
                    })));
                }
                Ok(TypeLiteral::Named(named))
            }
            TokenKind::LBrace => {
                self.parse_struct_type().map(TypeLiteral::Struct)
            }
            TokenKind::Pipe => {
                self.parse_enum_type().map(TypeLiteral::Enum)
            }
            _ => {
                let t = self.peek().clone();
                Err(ParseError::new(
                    format!("expected type literal, got {}", t.kind.display()),
                    t.span,
                ))
            }
        }
    }

    /// struct型の先頭判定: `{` または `$A ($B)* => {`
    fn is_struct_type_start(&self) -> bool {
        if matches!(self.peek().kind, TokenKind::LBrace) { return true; }
        let mut i = 0;
        let mut count = 0;
        while matches!(self.peek_at(i).kind, TokenKind::Dollar) {
            i += 1;
            if !matches!(self.peek_at(i).kind, TokenKind::Ident(_)) { return false; }
            // `$T:` はプロトコル制約なのでここでは対象外
            if matches!(self.peek_at(i + 1).kind, TokenKind::Colon) { return false; }
            i += 1;
            count += 1;
        }
        count > 0
            && matches!(self.peek_at(i).kind, TokenKind::Arrow)
            && matches!(self.peek_at(i + 1).kind, TokenKind::LBrace)
    }

    /// enum型の先頭判定: `|` または `$A ($B)* => |`
    fn is_enum_type_start(&self) -> bool {
        if matches!(self.peek().kind, TokenKind::Pipe) { return true; }
        let mut i = 0;
        let mut count = 0;
        while matches!(self.peek_at(i).kind, TokenKind::Dollar) {
            i += 1;
            if !matches!(self.peek_at(i).kind, TokenKind::Ident(_)) { return false; }
            if matches!(self.peek_at(i + 1).kind, TokenKind::Colon) { return false; }
            i += 1;
            count += 1;
        }
        count > 0
            && matches!(self.peek_at(i).kind, TokenKind::Arrow)
            && matches!(self.peek_at(i + 1).kind, TokenKind::Pipe)
    }

    fn is_fn_type_protocol_start(&self) -> bool {
        matches!(self.peek().kind, TokenKind::Dollar)
            && matches!(self.peek2().kind, TokenKind::Ident(_))
            && matches!(self.peek_at(2).kind, TokenKind::Colon)
            && matches!(self.peek_at(3).kind, TokenKind::Caret)
    }

    /// `(($T)*) => {` の型パラメータ部分を消費して Vec<String> を返す
    fn parse_optional_type_params(&mut self) -> Vec<String> {
        let saved = self.pos;
        let mut params = Vec::new();
        while matches!(self.peek().kind, TokenKind::Dollar) {
            self.advance();
            match self.peek().kind.clone() {
                TokenKind::Ident(ref s) => {
                    // $T: はプロトコル制約なので除外
                    if matches!(self.peek2().kind, TokenKind::Colon) {
                        self.pos = saved;
                        return Vec::new();
                    }
                    params.push(s.clone());
                    self.advance();
                }
                _ => { self.pos = saved; return Vec::new(); }
            }
        }
        if !params.is_empty() && matches!(self.peek().kind, TokenKind::Arrow) {
            self.advance(); // =>
            params
        } else {
            self.pos = saved;
            Vec::new()
        }
    }

    fn parse_struct_type(&mut self) -> Result<StructTypeBody, ParseError> {
        let type_params = self.parse_optional_type_params();
        let start = self.expect(&TokenKind::LBrace)?;
        let mut fields = Vec::new();
        while !matches!(self.peek().kind, TokenKind::RBrace | TokenKind::Eof) {
            let (name, _) = self.expect_ident()?;
            self.expect(&TokenKind::Eq)?;
            let ty = self.parse_type_literal(false)?;
            fields.push(TypeField { name, ty });
        }
        let end = self.expect(&TokenKind::RBrace)?;
        Ok(StructTypeBody { type_params, fields, span: start.merge(end) })
    }

    fn parse_enum_type(&mut self) -> Result<EnumTypeBody, ParseError> {
        let type_params = self.parse_optional_type_params();
        let start = self.expect(&TokenKind::Pipe)?;
        let mut variants = Vec::new();
        while !matches!(self.peek().kind, TokenKind::Pipe | TokenKind::Eof) {
            let (name, _) = self.expect_ident()?;
            self.expect(&TokenKind::Eq)?;
            let ty = self.parse_type_literal(false)?;
            variants.push(TypeVariant { name, ty });
        }
        let end = self.expect(&TokenKind::Pipe)?;
        Ok(EnumTypeBody { type_params, variants, span: start.merge(end) })
    }

    fn parse_fn_type_body(&mut self) -> Result<FnTypeBody, ParseError> {
        // オプションのプロトコル制約 `($T: ^Proto)* =>`
        let mut protocols = Vec::new();
        if self.is_fn_type_protocol_start() {
            while matches!(self.peek().kind, TokenKind::Dollar)
                && matches!(self.peek2().kind, TokenKind::Ident(_))
                && matches!(self.peek_at(2).kind, TokenKind::Colon)
            {
                self.advance(); // $
                let (name, _) = self.expect_ident()?;
                self.expect(&TokenKind::Colon)?;
                let protocol = self.parse_protocol_literal()?;
                protocols.push(ProtocolConstraint { name, protocol });
                if matches!(self.peek().kind, TokenKind::Arrow) { break; }
            }
            self.expect(&TokenKind::Arrow)?;
        }

        let param_ty = self.parse_type_literal(true)?; // param position: don't eat >
        let span = match &param_ty {
            TypeLiteral::Named(n) => n.span,
            TypeLiteral::Struct(s) => s.span,
            TypeLiteral::Enum(e) => e.span,
            TypeLiteral::Fn(f) => f.span,
        };
        self.expect(&TokenKind::Gt)?;

        let return_ty = if self.is_fn_type_protocol_start() {
            FnReturn::Fn(Box::new(self.parse_fn_type_body()?))
        } else {
            FnReturn::Type(self.parse_type_literal(false)?)
        };

        Ok(FnTypeBody { protocols, param_ty, return_ty, span })
    }

    // ============================================================
    // 式
    // ============================================================

    fn parse_expr(&mut self) -> Result<Expr, ParseError> {
        self.parse_call_expr()
    }

    /// 左結合のカリー化適用: `f a b c` → `((f a) b) c`
    fn parse_call_expr(&mut self) -> Result<Expr, ParseError> {
        let mut expr = self.parse_base_expr()?;

        while self.is_primary_expr_start() {
            let arg = self.parse_primary_expr()?;
            let span = expr.span().merge(arg.span());
            expr = Expr::Call(Box::new(CallExpr { callee: expr, arg, span }));
        }

        Ok(expr)
    }

    fn is_primary_expr_start(&self) -> bool {
        match &self.peek().kind {
            TokenKind::StringLit(_) | TokenKind::NumberLit(_) | TokenKind::BoolLit(_) => true,
            TokenKind::Ident(_) => {
                // `=` `is` `:` `=>` の直前は式の開始ではない
                !matches!(self.peek2().kind,
                    TokenKind::Eq | TokenKind::Is | TokenKind::Colon | TokenKind::Arrow)
            }
            _ => false,
        }
    }

    fn parse_base_expr(&mut self) -> Result<Expr, ParseError> {
        match self.peek().kind.clone() {
            TokenKind::If    => self.parse_if_expr(),
            TokenKind::Do    => self.parse_block_expr(),
            TokenKind::LParen => self.parse_paren_expr(),
            _ => self.parse_primary_expr(),
        }
    }

    fn parse_if_expr(&mut self) -> Result<Expr, ParseError> {
        let start = self.expect(&TokenKind::If)?;
        let cond = self.parse_expr()?;
        self.expect(&TokenKind::Then)?;
        let then = self.parse_expr()?;
        self.expect(&TokenKind::Else)?;
        let else_ = self.parse_expr()?;
        let span = start.merge(else_.span());
        Ok(Expr::If(Box::new(IfExpr { cond, then, else_, span })))
    }

    /// `do { stmt* final } where { binding* }`
    fn parse_block_expr(&mut self) -> Result<Expr, ParseError> {
        let start = self.expect(&TokenKind::Do)?;
        self.expect(&TokenKind::LBrace)?;

        let mut stmts: Vec<BlockStmt> = Vec::new();
        let final_expr;

        loop {
            if matches!(self.peek().kind, TokenKind::RBrace | TokenKind::Eof) {
                return Err(ParseError::new("block must have a final expression", self.peek().span));
            }
            if matches!(self.peek().kind, TokenKind::Break) {
                let s = self.advance().span; // break
                let e = self.parse_expr()?;
                self.expect(&TokenKind::Semi)?;
                stmts.push(BlockStmt::Break(e, s));
                continue;
            }
            let e = self.parse_expr()?;
            if self.try_eat(&TokenKind::Semi).is_some() {
                stmts.push(BlockStmt::Expr(e));
            } else {
                final_expr = e;
                break;
            }
        }

        self.expect(&TokenKind::RBrace)?;
        self.expect(&TokenKind::Where)?;
        self.expect(&TokenKind::LBrace)?;

        let mut bindings = Vec::new();
        while !matches!(self.peek().kind, TokenKind::RBrace | TokenKind::Eof) {
            let (bname, _) = self.expect_ident()?;
            let ty = if self.try_eat(&TokenKind::Colon).is_some() {
                Some(self.parse_type_literal(false)?)
            } else {
                None
            };
            self.expect(&TokenKind::Eq)?;
            let value = self.parse_expr()?;
            bindings.push(Binding { name: bname, ty, value });
        }
        let end = self.expect(&TokenKind::RBrace)?;

        Ok(Expr::Block(Box::new(BlockExpr {
            stmts, final_expr, bindings, span: start.merge(end),
        })))
    }

    fn parse_paren_expr(&mut self) -> Result<Expr, ParseError> {
        let start = self.expect(&TokenKind::LParen)?;
        let e = self.parse_expr()?;
        let end = self.expect(&TokenKind::RParen)?;
        Ok(Expr::Paren(Box::new(e), start.merge(end)))
    }

    fn parse_primary_expr(&mut self) -> Result<Expr, ParseError> {
        let t = self.peek().clone();
        match t.kind {
            TokenKind::StringLit(ref s) => {
                self.advance();
                Ok(Expr::Lit(Literal::String(s.clone()), t.span))
            }
            TokenKind::NumberLit(ref n) => {
                self.advance();
                Ok(Expr::Lit(Literal::Number(n.clone()), t.span))
            }
            TokenKind::BoolLit(b) => {
                self.advance();
                Ok(Expr::Lit(Literal::Bool(b), t.span))
            }
            TokenKind::Ident(_) => {
                // struct literal: Ident `{`
                if matches!(self.peek2().kind, TokenKind::LBrace) {
                    return self.parse_struct_lit();
                }
                // enum literal: Ident `(`
                if matches!(self.peek2().kind, TokenKind::LParen) {
                    return self.parse_enum_lit();
                }
                // period access or plain ident
                self.parse_period_access()
            }
            _ => Err(ParseError::new(
                format!("expected expression, got {}", t.kind.display()),
                t.span,
            )),
        }
    }

    fn parse_struct_lit(&mut self) -> Result<Expr, ParseError> {
        let (name, start) = self.expect_ident()?;
        self.expect(&TokenKind::LBrace)?;
        let mut fields = Vec::new();
        while !matches!(self.peek().kind, TokenKind::RBrace | TokenKind::Eof) {
            let (fname, _) = self.expect_ident()?;
            self.expect(&TokenKind::Eq)?;
            let value = self.parse_expr()?;
            fields.push(StructLitField { name: fname, value });
        }
        let end = self.expect(&TokenKind::RBrace)?;
        Ok(Expr::Struct(Box::new(StructLit { name, fields, span: start.merge(end) })))
    }

    fn parse_enum_lit(&mut self) -> Result<Expr, ParseError> {
        let (name, start) = self.expect_ident()?;
        self.expect(&TokenKind::LParen)?;
        let value = self.parse_expr()?;
        let end = self.expect(&TokenKind::RParen)?;
        Ok(Expr::Enum(Box::new(EnumLit { name, value, span: start.merge(end) })))
    }

    fn parse_period_access(&mut self) -> Result<Expr, ParseError> {
        let (first, start) = self.expect_ident()?;
        let mut parts = vec![first];
        let mut end = start;
        while self.try_eat(&TokenKind::Dot).is_some() {
            let (part, s) = self.expect_ident()?;
            parts.push(part);
            end = s;
        }
        Ok(Expr::Var(parts, start.merge(end)))
    }
}

// ============================================================
// 便利関数
// ============================================================

pub fn parse(src: &str) -> Result<Program, Box<dyn std::error::Error>> {
    let tokens = crate::lexer::tokenize(src)?;
    let mut parser = Parser::new(tokens);
    Ok(parser.parse_program()?)
}

// ============================================================
// テスト
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lexer::tokenize;

    fn parser(src: &str) -> Parser {
        Parser::new(tokenize(src).unwrap())
    }

    // ---- using ----

    #[test]
    fn test_using_simple() {
        let prog = parser(r#"using foo from "mylib";"#).parse_program().unwrap();
        let TopLevel::Using(u) = &prog.items[0] else { panic!() };
        assert_eq!(u.imports[0].name, "foo");
        assert_eq!(u.from, "mylib");
    }

    #[test]
    fn test_using_alias() {
        let prog = parser(r#"using alpha as a beta as b from "lib";"#).parse_program().unwrap();
        let TopLevel::Using(u) = &prog.items[0] else { panic!() };
        assert_eq!(u.imports[0].alias, Some("a".into()));
        assert_eq!(u.imports[1].alias, Some("b".into()));
    }

    // ---- type definitions ----

    #[test]
    fn test_named_type() {
        let prog = parser("$Foo is $Bar;").parse_program().unwrap();
        let TopLevel::TypeDef(d) = &prog.items[0] else { panic!() };
        assert_eq!(d.name, "Foo");
        assert!(matches!(d.ty, TypeLiteral::Named(_)));
    }

    #[test]
    fn test_struct_type() {
        let prog = parser("$Point is { x = $Int y = $Int };").parse_program().unwrap();
        let TopLevel::TypeDef(d) = &prog.items[0] else { panic!() };
        let TypeLiteral::Struct(s) = &d.ty else { panic!() };
        assert_eq!(s.fields.len(), 2);
        assert_eq!(s.fields[0].name, "x");
    }

    #[test]
    fn test_struct_type_params() {
        let prog = parser("$Pair is $A $B => { first = $A second = $B };").parse_program().unwrap();
        let TopLevel::TypeDef(d) = &prog.items[0] else { panic!() };
        let TypeLiteral::Struct(s) = &d.ty else { panic!() };
        assert_eq!(s.type_params, vec!["A", "B"]);
    }

    #[test]
    fn test_enum_type() {
        let prog = parser("$Option is $T => | Some = $T None = $Unit |;").parse_program().unwrap();
        let TopLevel::TypeDef(d) = &prog.items[0] else { panic!() };
        let TypeLiteral::Enum(e) = &d.ty else { panic!() };
        assert_eq!(e.type_params, vec!["T"]);
        assert_eq!(e.variants.len(), 2);
    }

    #[test]
    fn test_named_type_with_args() {
        let prog = parser("$Foo is $List<$Int>;").parse_program().unwrap();
        let TopLevel::TypeDef(d) = &prog.items[0] else { panic!() };
        let TypeLiteral::Named(n) = &d.ty else { panic!() };
        assert_eq!(n.name, "List");
        assert_eq!(n.args.len(), 1);
    }

    // ---- protocol definitions ----

    #[test]
    fn test_protocol_body() {
        let prog = parser("^Show is { show = $T > $String };").parse_program().unwrap();
        let TopLevel::Protocol(p) = &prog.items[0] else { panic!() };
        assert_eq!(p.name, "Show");
        let ProtocolBodyOrLiteral::Body(b) = &p.body else { panic!() };
        assert_eq!(b.methods[0].name, "show");
    }

    #[test]
    fn test_protocol_literal() {
        let prog = parser("^ShowEq is ^Show + ^Eq;").parse_program().unwrap();
        let TopLevel::Protocol(p) = &prog.items[0] else { panic!() };
        let ProtocolBodyOrLiteral::Literal(l) = &p.body else { panic!() };
        assert_eq!(l.names, vec!["Show", "Eq"]);
    }

    // ---- functions ----

    #[test]
    fn test_fn_simple() {
        let prog = parser("add x: $Int y: $Int > $Int is x;").parse_program().unwrap();
        let TopLevel::Function(f) = &prog.items[0] else { panic!() };
        assert_eq!(f.name, "add");
        assert_eq!(f.params.len(), 2);
    }

    #[test]
    fn test_fn_builtin() {
        let prog = parser("add x: $Int > $Int is # nativeAdd;").parse_program().unwrap();
        let TopLevel::Function(f) = &prog.items[0] else { panic!() };
        assert!(matches!(f.body, FunctionBody::Builtin(ref s) if s == "nativeAdd"));
    }

    #[test]
    fn test_fn_zero_params() {
        let prog = parser(r#"greet > $String is "hello";"#).parse_program().unwrap();
        let TopLevel::Function(f) = &prog.items[0] else { panic!() };
        assert!(f.params.is_empty());
    }

    #[test]
    fn test_fn_protocol_constraint() {
        let prog = parser("show $T: ^Show => x: $T > $String is x;").parse_program().unwrap();
        let TopLevel::Function(f) = &prog.items[0] else { panic!() };
        assert_eq!(f.protocol_constraints[0].name, "T");
    }

    // ---- expressions ----

    #[test]
    fn test_if_then_else() {
        let prog = parser("f > $Bool is if true then x else y;").parse_program().unwrap();
        let TopLevel::Function(f) = &prog.items[0] else { panic!() };
        assert!(matches!(f.body, FunctionBody::Expr(Expr::If(_))));
    }

    #[test]
    fn test_call_expr() {
        let prog = parser("f > $Int is add 1 2;").parse_program().unwrap();
        let TopLevel::Function(fun) = &prog.items[0] else { panic!() };
        let FunctionBody::Expr(Expr::Call(outer)) = &fun.body else { panic!() };
        assert!(matches!(outer.arg, Expr::Lit(Literal::Number(ref n), _) if n == "2"));
        assert!(matches!(outer.callee, Expr::Call(_)));
    }

    #[test]
    fn test_period_access() {
        let prog = parser("f x: $Point > $Int is x.y.z;").parse_program().unwrap();
        let TopLevel::Function(f) = &prog.items[0] else { panic!() };
        let FunctionBody::Expr(Expr::Var(parts, _)) = &f.body else { panic!() };
        assert_eq!(parts, &["x", "y", "z"]);
    }

    #[test]
    fn test_struct_lit() {
        let prog = parser("f > $P is Point { x = 1 y = 2 };").parse_program().unwrap();
        let TopLevel::Function(f) = &prog.items[0] else { panic!() };
        let FunctionBody::Expr(Expr::Struct(s)) = &f.body else { panic!() };
        assert_eq!(s.name, "Point");
        assert_eq!(s.fields.len(), 2);
    }

    #[test]
    fn test_enum_lit() {
        let prog = parser("f > $Option is Some(42);").parse_program().unwrap();
        let TopLevel::Function(f) = &prog.items[0] else { panic!() };
        let FunctionBody::Expr(Expr::Enum(e)) = &f.body else { panic!() };
        assert_eq!(e.name, "Some");
    }

    #[test]
    fn test_block_expr() {
        let prog = parser("f > $Int is do { x } where { x = 1 };").parse_program().unwrap();
        let TopLevel::Function(f) = &prog.items[0] else { panic!() };
        let FunctionBody::Expr(Expr::Block(b)) = &f.body else { panic!() };
        assert_eq!(b.bindings[0].name, "x");
    }

    #[test]
    fn test_block_break() {
        let prog = parser("f > $Int is do { break 99; 0 } where {};").parse_program().unwrap();
        let TopLevel::Function(f) = &prog.items[0] else { panic!() };
        let FunctionBody::Expr(Expr::Block(b)) = &f.body else { panic!() };
        assert!(matches!(b.stmts[0], BlockStmt::Break(_, _)));
    }

    #[test]
    fn test_comment_in_expr() {
        let prog = parser("f > $Int is /* answer */ 42;").parse_program().unwrap();
        let TopLevel::Function(f) = &prog.items[0] else { panic!() };
        assert!(matches!(f.body, FunctionBody::Expr(Expr::Lit(Literal::Number(_), _))));
    }
}
