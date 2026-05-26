use crate::ast;
use crate::hir::*;
use std::collections::HashMap;

pub struct Lowerer {
    symbols: HashMap<SymbolId, HirSymbol>,
    name_to_id: Vec<HashMap<String, SymbolId>>,
    next_id: usize,
}

impl Lowerer {
    pub fn new() -> Self {
        Self {
            symbols: HashMap::new(),
            name_to_id: vec![HashMap::new()],
            next_id: 0,
        }
    }

    fn next_symbol_id(&mut self) -> SymbolId {
        let id = SymbolId(self.next_id);
        self.next_id += 1;
        id
    }

    fn push_scope(&mut self) {
        self.name_to_id.push(HashMap::new());
    }

    fn pop_scope(&mut self) {
        self.name_to_id.pop();
    }

    fn define_symbol(&mut self, name: String, kind: HirSymbolKind) -> SymbolId {
        let id = self.next_symbol_id();
        self.symbols.insert(id, HirSymbol { name: name.clone(), kind });
        self.name_to_id.last_mut().unwrap().insert(name, id);
        id
    }

    fn resolve_symbol(&self, name: &str) -> Option<SymbolId> {
        for scope in self.name_to_id.iter().rev() {
            if let Some(id) = scope.get(name) {
                return Some(*id);
            }
        }
        None
    }

    pub fn lower_program(&mut self, program: Vec<ast::TopLevel>) -> HirProgram {
        // Pre-pass to define top-level names
        for tl in &program {
            match tl {
                ast::TopLevel::Function(f) => { self.define_symbol(f.name.clone(), HirSymbolKind::Function); }
                ast::TopLevel::TypeDefinition(t) => { self.define_symbol(t.name.clone(), HirSymbolKind::Type); }
                ast::TopLevel::ProtocolDefinition(p) => { self.define_symbol(p.name.clone(), HirSymbolKind::Protocol); }
                ast::TopLevel::Using(_) => {}
            }
        }

        let mut top_levels = Vec::new();
        for tl in program {
            match tl {
                ast::TopLevel::Function(f) => {
                    let id = self.resolve_symbol(&f.name).unwrap();
                    top_levels.push(HirTopLevel::Function(self.lower_function(id, f)));
                }
                ast::TopLevel::TypeDefinition(t) => {
                    let id = self.resolve_symbol(&t.name).unwrap();
                    top_levels.push(HirTopLevel::TypeDefinition(self.lower_type_definition(id, t)));
                }
                ast::TopLevel::ProtocolDefinition(p) => {
                    let id = self.resolve_symbol(&p.name).unwrap();
                    top_levels.push(HirTopLevel::ProtocolDefinition(self.lower_protocol_definition(id, p)));
                }
                ast::TopLevel::Using(_) => {} // Handle imports if needed
            }
        }

        HirProgram {
            top_levels,
            symbols: self.symbols.clone(),
        }
    }

    fn lower_function(&mut self, symbol_id: SymbolId, f: ast::Function) -> HirFunction {
        self.push_scope();

        let mut protocol_constraints = Vec::new();
        for pc in f.protocol_defs {
             let gid = self.define_symbol(pc.name.clone(), HirSymbolKind::Type);
             // Protocol ID resolution would happen here
             if let ast::ProtocolDefinitionBody::Literal(parts) = pc.body {
                 if let Some(pid) = self.resolve_symbol(&parts[0]) {
                     protocol_constraints.push(HirProtocolConstraint { generic_id: gid, protocol_id: pid });
                 }
             }
        }

        let params = f.params.into_iter().map(|p| {
            let id = self.define_symbol(p.name, HirSymbolKind::Variable);
            HirParam { symbol_id: id, ty: self.lower_type(p.ty) }
        }).collect();

        let return_type = self.lower_type(f.return_type);
        let body = match f.body {
            ast::FunctionBody::Expr(e) => HirFunctionBody::Expr(self.lower_expression(e)),
            ast::FunctionBody::Intrinsic(i) => HirFunctionBody::Intrinsic(i),
        };

        self.pop_scope();
        HirFunction {
            symbol_id,
            params,
            return_type,
            body,
            protocol_constraints,
        }
    }

    fn lower_type_definition(&mut self, symbol_id: SymbolId, t: ast::TypeDefinition) -> HirTypeDefinition {
        HirTypeDefinition {
            symbol_id,
            ty: self.lower_type(t.ty),
        }
    }

    fn lower_protocol_definition(&mut self, symbol_id: SymbolId, p: ast::ProtocolDefinition) -> HirProtocolDefinition {
        let body = match p.body {
            ast::ProtocolDefinitionBody::Methods(m) => HirProtocolBody::Methods(m.into_iter().map(|(n, f)| (n, self.lower_type(ast::TypeLiteral::Fn(f)))).collect()),
            ast::ProtocolDefinitionBody::Literal(l) => HirProtocolBody::Composition(l.into_iter().filter_map(|name| self.resolve_symbol(&name)).collect()),
        };
        HirProtocolDefinition { symbol_id, body }
    }

    fn lower_type(&mut self, ty: ast::TypeLiteral) -> HirType {
        match ty {
            ast::TypeLiteral::Reference { name, args } => {
                if let Some(id) = self.resolve_symbol(&name) {
                    HirType::Nominal(id, args.into_iter().map(|a| self.lower_type(a)).collect())
                } else {
                    HirType::Primitive(name)
                }
            }
            ast::TypeLiteral::Struct(s) => {
                self.push_scope();
                let generics = s.generics.into_iter().map(|g| self.define_symbol(g, HirSymbolKind::Type)).collect();
                let fields = s.fields.into_iter().map(|(n, t)| (n, self.lower_type(t))).collect();
                self.pop_scope();
                HirType::Struct { generics, fields }
            }
            ast::TypeLiteral::Enum(e) => {
                self.push_scope();
                let generics = e.generics.into_iter().map(|g| self.define_symbol(g, HirSymbolKind::Type)).collect();
                let variants = e.variants.into_iter().map(|(n, t)| (n, self.lower_type(t))).collect();
                self.pop_scope();
                HirType::Enum { generics, variants }
            }
            ast::TypeLiteral::Fn(f) => {
                HirType::Function {
                    constraints: vec![], // Handle constraints
                    param: Box::new(self.lower_type(*f.param_ty)),
                    result: Box::new(self.lower_type(*f.return_ty)),
                }
            }
        }
    }

    fn lower_expression(&mut self, expr: ast::Expression) -> HirExpression {
        match expr {
            ast::Expression::If { cond, then, els } => HirExpression::If {
                cond: Box::new(self.lower_expression(*cond)),
                then: Box::new(self.lower_expression(*then)),
                els: Box::new(self.lower_expression(*els)),
            },
            ast::Expression::Loop(e) => HirExpression::Loop(Box::new(self.lower_expression(*e))),
            ast::Expression::Call { func, arg } => HirExpression::Call {
                func: Box::new(self.lower_expression(*func)),
                arg: Box::new(self.lower_expression(*arg)),
            },
            ast::Expression::Block(b) => {
                self.push_scope();
                let bindings = b.bindings.into_iter().map(|bi| {
                    let id = self.define_symbol(bi.name, HirSymbolKind::Variable);
                    HirBinding { symbol_id: id, ty: bi.ty.map(|t| self.lower_type(t)), expr: self.lower_expression(bi.expr) }
                }).collect();
                let stmts = b.stmts.into_iter().map(|s| match s {
                    ast::BlockStmt::Expr(e) => HirStmt::Expr(self.lower_expression(e)),
                    ast::BlockStmt::Break(e) => HirStmt::Break(self.lower_expression(e)),
                }).collect();
                let result = Box::new(self.lower_expression(*b.result));
                self.pop_scope();
                HirExpression::Block(HirBlock { stmts, result, bindings })
            }
            ast::Expression::Primary(p) => match p {
                ast::PrimaryExpression::Literal(l) => HirExpression::Literal(match l {
                    ast::Literal::Int(i) => HirLiteral::Int(i),
                    ast::Literal::Float(f) => HirLiteral::Float(f),
                    ast::Literal::String(s) => HirLiteral::String(s),
                    ast::Literal::Bool(b) => HirLiteral::Bool(b),
                }),
                ast::PrimaryExpression::StructLiteral { name, fields } => {
                    let type_id = self.resolve_symbol(&name).unwrap_or(SymbolId(0));
                    HirExpression::StructLiteral { type_id, fields: fields.into_iter().map(|(n, e)| (n, self.lower_expression(e))).collect() }
                }
                ast::PrimaryExpression::EnumLiteral { name, arg } => {
                    let type_id = self.resolve_symbol(&name).unwrap_or(SymbolId(0));
                    HirExpression::EnumLiteral { type_id, variant: name, arg: Box::new(self.lower_expression(*arg)) }
                }
                ast::PrimaryExpression::PeriodAccess(parts) => {
                    let mut res = if let Some(id) = self.resolve_symbol(&parts[0]) {
                        HirExpression::Variable(id)
                    } else {
                        HirExpression::Literal(HirLiteral::String(parts[0].clone()))
                    };
                    for field in parts.into_iter().skip(1) {
                        res = HirExpression::FieldAccess { receiver: Box::new(res), field };
                    }
                    res
                }
            }
            ast::Expression::Paren(e) => self.lower_expression(*e),
        }
    }
}
