#[derive(Debug, Clone, PartialEq)]
pub enum TopLevel {
    Using(Using),
    Function(Function),
    TypeDefinition(TypeDefinition),
    ProtocolDefinition(ProtocolDefinition),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Using {
    pub name: String,
    pub alias: Option<String>,
    pub from: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Function {
    pub name: String,
    pub protocol_defs: Vec<ProtocolConstraint>,
    pub params: Vec<ParamDef>,
    pub return_type: TypeLiteral,
    pub body: FunctionBody,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ProtocolConstraint {
    pub name: String,
    pub body: ProtocolDefinitionBody,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParamDef {
    pub name: String,
    pub ty: TypeLiteral,
}

#[derive(Debug, Clone, PartialEq)]
pub enum FunctionBody {
    Expr(Expression),
    Intrinsic(String),
}

#[derive(Debug, Clone, PartialEq)]
pub enum Expression {
    If {
        cond: Box<Expression>,
        then: Box<Expression>,
        els: Box<Expression>,
    },
    Loop(Box<Expression>),
    Call {
        func: Box<Expression>,
        arg: Box<Expression>,
    },
    Block(BlockExpression),
    Primary(PrimaryExpression),
    Paren(Box<Expression>),
}

#[derive(Debug, Clone, PartialEq)]
pub struct BlockExpression {
    pub stmts: Vec<BlockStmt>,
    pub result: Box<Expression>,
    pub bindings: Vec<Binding>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum BlockStmt {
    Expr(Expression),
    Break(Expression),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Binding {
    pub name: String,
    pub ty: Option<TypeLiteral>,
    pub expr: Expression,
}

#[derive(Debug, Clone, PartialEq)]
pub enum PrimaryExpression {
    Literal(Literal),
    StructLiteral {
        name: String,
        fields: Vec<(String, Expression)>,
    },
    EnumLiteral {
        name: String,
        arg: Box<Expression>,
    },
    PeriodAccess(Vec<String>),
}

#[derive(Debug, Clone, PartialEq)]
pub enum Literal {
    Int(i64),
    Float(f64),
    String(String),
    Bool(bool),
}

#[derive(Debug, Clone, PartialEq)]
pub struct TypeDefinition {
    pub name: String,
    pub ty: TypeLiteral,
}

#[derive(Debug, Clone, PartialEq)]
pub enum TypeLiteral {
    Struct(StructTypeBody),
    Enum(EnumTypeBody),
    Fn(FnTypeBody),
    Reference {
        name: String,
        args: Vec<TypeLiteral>,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct StructTypeBody {
    pub generics: Vec<String>,
    pub fields: Vec<(String, TypeLiteral)>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct EnumTypeBody {
    pub generics: Vec<String>,
    pub variants: Vec<(String, TypeLiteral)>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FnTypeBody {
    pub constraints: Vec<ProtocolConstraint>,
    pub param_ty: Box<TypeLiteral>,
    pub return_ty: Box<TypeLiteral>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ProtocolDefinition {
    pub name: String,
    pub body: ProtocolDefinitionBody,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ProtocolDefinitionBody {
    Methods(Vec<(String, FnTypeBody)>),
    Literal(Vec<String>), // ^A + ^B
}
