/// ソースコード上の位置情報
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Span {
    pub start: usize,
    pub end: usize,
}

impl Span {
    pub fn new(start: usize, end: usize) -> Self {
        Self { start, end }
    }
    pub fn merge(self, other: Span) -> Self {
        Self {
            start: self.start.min(other.start),
            end: self.end.max(other.end),
        }
    }
}

// ============================================================
// リテラル
// ============================================================

#[derive(Debug, Clone, PartialEq)]
pub enum Literal {
    String(String),
    Number(String), // 精度を保つため文字列で保持
    Bool(bool),
}

// ============================================================
// 型リテラル
// ============================================================

#[derive(Debug, Clone, PartialEq)]
pub enum TypeLiteral {
    Named(NamedType),
    Struct(StructTypeBody),
    Enum(EnumTypeBody),
    Fn(Box<FnTypeBody>),
}

#[derive(Debug, Clone, PartialEq)]
pub struct NamedType {
    pub name: String,
    pub args: Vec<TypeLiteral>,
    pub span: Span,
}

/// `{ x = $Int  y = $Int }`
#[derive(Debug, Clone, PartialEq)]
pub struct StructTypeBody {
    pub type_params: Vec<String>,
    pub fields: Vec<TypeField>,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TypeField {
    pub name: String,
    pub ty: TypeLiteral,
}

/// `| Some = $T  None = $Unit |`
#[derive(Debug, Clone, PartialEq)]
pub struct EnumTypeBody {
    pub type_params: Vec<String>,
    pub variants: Vec<TypeVariant>,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TypeVariant {
    pub name: String,
    pub ty: TypeLiteral,
}

/// `$A > $B` または `$A > $B > $C`（右結合）
#[derive(Debug, Clone, PartialEq)]
pub struct FnTypeBody {
    /// `($T: ^Show)*` のプロトコル制約
    pub protocols: Vec<ProtocolConstraint>,
    pub param_ty: TypeLiteral,
    pub return_ty: FnReturn,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq)]
pub enum FnReturn {
    Type(TypeLiteral),
    Fn(Box<FnTypeBody>),
}

#[derive(Debug, Clone, PartialEq)]
pub struct ProtocolConstraint {
    pub name: String,
    pub protocol: ProtocolLiteral,
}

// ============================================================
// プロトコル
// ============================================================

/// `^Show + ^Eq`
#[derive(Debug, Clone, PartialEq)]
pub struct ProtocolLiteral {
    pub names: Vec<String>,
    pub span: Span,
}

/// `{ show = $T > $String }`
#[derive(Debug, Clone, PartialEq)]
pub struct ProtocolDefinitionBody {
    pub methods: Vec<ProtocolMethod>,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ProtocolMethod {
    pub name: String,
    pub ty: FnTypeBody,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ProtocolBodyOrLiteral {
    Body(ProtocolDefinitionBody),
    Literal(ProtocolLiteral),
}

// ============================================================
// 式
// ============================================================

#[derive(Debug, Clone, PartialEq)]
pub enum Expr {
    Lit(Literal, Span),
    Var(Vec<String>, Span),       // PeriodAccess: a.b.c → ["a","b","c"]
    If(Box<IfExpr>),
    Call(Box<CallExpr>),
    Block(Box<BlockExpr>),
    Struct(Box<StructLit>),
    Enum(Box<EnumLit>),
    Paren(Box<Expr>, Span),
}

impl Expr {
    pub fn span(&self) -> Span {
        match self {
            Expr::Lit(_, s)     => *s,
            Expr::Var(_, s)     => *s,
            Expr::If(e)         => e.span,
            Expr::Call(e)       => e.span,
            Expr::Block(e)      => e.span,
            Expr::Struct(e)     => e.span,
            Expr::Enum(e)       => e.span,
            Expr::Paren(_, s)   => *s,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct IfExpr {
    pub cond: Expr,
    pub then: Expr,
    pub else_: Expr,
    pub span: Span,
}

/// カリー化適用: `f a b` → `Call(Call(f, a), b)`
#[derive(Debug, Clone, PartialEq)]
pub struct CallExpr {
    pub callee: Expr,
    pub arg: Expr,
    pub span: Span,
}

/// `do { stmt*; final } where { binding* }`
#[derive(Debug, Clone, PartialEq)]
pub struct BlockExpr {
    pub stmts: Vec<BlockStmt>,
    pub final_expr: Expr,
    pub bindings: Vec<Binding>,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq)]
pub enum BlockStmt {
    Expr(Expr),
    Break(Expr, Span),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Binding {
    pub name: String,
    pub ty: Option<TypeLiteral>,
    pub value: Expr,
}

#[derive(Debug, Clone, PartialEq)]
pub struct StructLit {
    pub name: String,
    pub fields: Vec<StructLitField>,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq)]
pub struct StructLitField {
    pub name: String,
    pub value: Expr,
}

#[derive(Debug, Clone, PartialEq)]
pub struct EnumLit {
    pub name: String,
    pub value: Expr,
    pub span: Span,
}

// ============================================================
// トップレベル宣言
// ============================================================

#[derive(Debug, Clone, PartialEq)]
pub enum TopLevel {
    Using(UsingDecl),
    Function(FunctionDecl),
    TypeDef(TypeDef),
    Protocol(ProtocolDef),
}

impl TopLevel {
    pub fn span(&self) -> Span {
        match self {
            TopLevel::Using(d)    => d.span,
            TopLevel::Function(d) => d.span,
            TopLevel::TypeDef(d)  => d.span,
            TopLevel::Protocol(d) => d.span,
        }
    }
}

/// `using foo as f bar from "lib";`
#[derive(Debug, Clone, PartialEq)]
pub struct UsingDecl {
    pub imports: Vec<Import>,
    pub from: String,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Import {
    pub name: String,
    pub alias: Option<String>,
}

/// `add x: $Int y: $Int > $Int is expr;`
#[derive(Debug, Clone, PartialEq)]
pub struct FunctionDecl {
    pub name: String,
    /// プロトコル制約リスト `($T: ^Show)*`
    pub protocol_constraints: Vec<FnProtocolConstraint>,
    pub params: Vec<Param>,
    pub return_ty: TypeLiteral,
    pub body: FunctionBody,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FnProtocolConstraint {
    pub name: String,
    pub body: ProtocolBodyOrLiteral,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Param {
    pub name: String,
    pub ty: TypeLiteral,
}

#[derive(Debug, Clone, PartialEq)]
pub enum FunctionBody {
    Expr(Expr),
    Builtin(String), // `# nativeFn`
}

/// `$Point is { x = $Int y = $Int };`
#[derive(Debug, Clone, PartialEq)]
pub struct TypeDef {
    pub name: String,
    pub ty: TypeLiteral,
    pub span: Span,
}

/// `^Show is { show = $T > $String };`
#[derive(Debug, Clone, PartialEq)]
pub struct ProtocolDef {
    pub name: String,
    pub body: ProtocolBodyOrLiteral,
    pub span: Span,
}

// ============================================================
// プログラム
// ============================================================

#[derive(Debug, Clone, PartialEq)]
pub struct Program {
    pub items: Vec<TopLevel>,
}
