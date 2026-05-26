use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct SymbolId(pub usize);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct TypeId(pub usize);

#[derive(Debug, Clone, PartialEq)]
pub struct HirProgram {
    pub top_levels: Vec<HirTopLevel>,
    pub symbols: HashMap<SymbolId, HirSymbol>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum HirTopLevel {
    Function(HirFunction),
    TypeDefinition(HirTypeDefinition),
    ProtocolDefinition(HirProtocolDefinition),
}

#[derive(Debug, Clone, PartialEq)]
pub struct HirSymbol {
    pub name: String,
    pub kind: HirSymbolKind,
}

#[derive(Debug, Clone, PartialEq)]
pub enum HirSymbolKind {
    Function,
    Type,
    Protocol,
    Variable,
}

#[derive(Debug, Clone, PartialEq)]
pub struct HirFunction {
    pub symbol_id: SymbolId,
    pub params: Vec<HirParam>,
    pub return_type: HirType,
    pub body: HirFunctionBody,
    pub protocol_constraints: Vec<HirProtocolConstraint>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct HirParam {
    pub symbol_id: SymbolId,
    pub ty: HirType,
}

#[derive(Debug, Clone, PartialEq)]
pub enum HirFunctionBody {
    Expr(HirExpression),
    Intrinsic(String),
}

#[derive(Debug, Clone, PartialEq)]
pub enum HirExpression {
    If {
        cond: Box<HirExpression>,
        then: Box<HirExpression>,
        els: Box<HirExpression>,
    },
    Loop(Box<HirExpression>),
    Call {
        func: Box<HirExpression>,
        arg: Box<HirExpression>,
    },
    Block(HirBlock),
    Literal(HirLiteral),
    StructLiteral {
        type_id: SymbolId,
        fields: Vec<(String, HirExpression)>,
    },
    EnumLiteral {
        type_id: SymbolId,
        variant: String,
        arg: Box<HirExpression>,
    },
    Variable(SymbolId),
    FieldAccess {
        receiver: Box<HirExpression>,
        field: String,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct HirBlock {
    pub stmts: Vec<HirStmt>,
    pub result: Box<HirExpression>,
    pub bindings: Vec<HirBinding>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum HirStmt {
    Expr(HirExpression),
    Break(HirExpression),
}

#[derive(Debug, Clone, PartialEq)]
pub struct HirBinding {
    pub symbol_id: SymbolId,
    pub ty: Option<HirType>,
    pub expr: HirExpression,
}

#[derive(Debug, Clone, PartialEq)]
pub enum HirLiteral {
    Int(i64),
    Float(f64),
    String(String),
    Bool(bool),
}

#[derive(Debug, Clone, PartialEq)]
pub struct HirTypeDefinition {
    pub symbol_id: SymbolId,
    pub ty: HirType,
}

#[derive(Debug, Clone, PartialEq)]
pub enum HirType {
    Primitive(String),
    Nominal(SymbolId, Vec<HirType>),
    Struct {
        generics: Vec<SymbolId>,
        fields: Vec<(String, HirType)>,
    },
    Enum {
        generics: Vec<SymbolId>,
        variants: Vec<(String, HirType)>,
    },
    Function {
        constraints: Vec<HirProtocolConstraint>,
        param: Box<HirType>,
        result: Box<HirType>,
    },
    GenericVar(SymbolId),
    Error,
}

#[derive(Debug, Clone, PartialEq)]
pub struct HirProtocolDefinition {
    pub symbol_id: SymbolId,
    pub body: HirProtocolBody,
}

#[derive(Debug, Clone, PartialEq)]
pub enum HirProtocolBody {
    Methods(Vec<(String, HirType)>),
    Composition(Vec<SymbolId>),
}

#[derive(Debug, Clone, PartialEq)]
pub struct HirProtocolConstraint {
    pub generic_id: SymbolId,
    pub protocol_id: SymbolId,
}
