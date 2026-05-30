/// 型チェッカー本体
/// HM型推論 (Algorithm W) を ena の UnificationTable で実装。
/// プロトコルの名前衝突は Error として報告する。
use std::collections::HashMap;

use crate::ast::*;
use crate::env::{Env, ProtocolInfo, TypeInfo};
use crate::ty::{Ty, TyVarId, TypeScheme, UnifyError, UnifyTable};

// ============================================================
// 診断 (エラー/警告)
// ============================================================

#[derive(Debug, Clone)]
pub struct Diagnostic {
    pub span: Span,
    pub kind: DiagKind,
}

#[derive(Debug, Clone)]
pub enum DiagKind {
    /// 型不一致
    TypeMismatch { expected: Ty, found: Ty },
    /// 無限型 (occurs check 失敗)
    InfiniteType { var: TyVarId, ty: Ty },
    /// 未定義の変数
    UnboundVar(String),
    /// 未定義の型名
    UnboundType(String),
    /// 未定義のプロトコル
    UnboundProtocol(String),
    /// プロトコル間でメソッド名が衝突するアクセス
    AmbiguousMethod { method: String, protocols: Vec<String> },
    /// 型引数の数が合わない
    TypeArgCount { name: String, expected: usize, found: usize },
    /// プロトコル制約を満たさない
    ProtocolNotSatisfied { ty: Ty, protocol: String },
    /// その他
    Other(String),
}

impl Diagnostic {
    fn error(span: Span, kind: DiagKind) -> Self {
        Self { span, kind }
    }
}

impl std::fmt::Display for DiagKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DiagKind::TypeMismatch { expected, found } =>
                write!(f, "type mismatch: expected `{expected}`, found `{found}`"),
            DiagKind::InfiniteType { var, ty } =>
                write!(f, "infinite type: `?t{}` occurs in `{ty}`", var.0),
            DiagKind::UnboundVar(n) =>
                write!(f, "undefined variable `{n}`"),
            DiagKind::UnboundType(n) =>
                write!(f, "undefined type `{n}`"),
            DiagKind::UnboundProtocol(n) =>
                write!(f, "undefined protocol `{n}`"),
            DiagKind::AmbiguousMethod { method, protocols } =>
                write!(f, "ambiguous method `{method}`: defined in protocols [{}]",
                    protocols.join(", ")),
            DiagKind::TypeArgCount { name, expected, found } =>
                write!(f, "`{name}` expects {expected} type argument(s), found {found}"),
            DiagKind::ProtocolNotSatisfied { ty, protocol } =>
                write!(f, "`{ty}` does not implement protocol `{protocol}`"),
            DiagKind::Other(s) => write!(f, "{s}"),
        }
    }
}

// ============================================================
// 型チェッカー
// ============================================================

pub struct TypeChecker {
    pub env: Env,
    pub table: UnifyTable,
    pub diags: Vec<Diagnostic>,

    /// 式ノードのスパン → 推論された型 (外部から参照可能)
    pub node_types: HashMap<u64, Ty>,
}

impl TypeChecker {
    pub fn new() -> Self {
        let mut checker = Self {
            env: Env::new(),
            table: UnifyTable::new(),
            diags: Vec::new(),
            node_types: HashMap::new(),
        };
        checker.register_builtins();
        checker
    }

    // ---- ビルトイン型・関数の登録 ----

    fn register_builtins(&mut self) {
        // 数値演算 (二項: Int -> Int -> Int)
        for op in &["add", "sub", "mul", "div", "mod_"] {
            let ty = Ty::curried([Ty::Int, Ty::Int], Ty::Int);
            self.env.register_global(*op, TypeScheme::mono(ty));
        }
        // 比較 (Int -> Int -> Bool)
        for op in &["eq", "lt", "gt", "le", "ge", "ne"] {
            let ty = Ty::curried([Ty::Int, Ty::Int], Ty::Bool);
            self.env.register_global(*op, TypeScheme::mono(ty));
        }
        // 論理
        for op in &["and", "or"] {
            let ty = Ty::curried([Ty::Bool, Ty::Bool], Ty::Bool);
            self.env.register_global(*op, TypeScheme::mono(ty));
        }
        let not_ty = Ty::fun(Ty::Bool, Ty::Bool);
        self.env.register_global("not", TypeScheme::mono(not_ty));

        // String 操作
        let concat_ty = Ty::curried([Ty::String, Ty::String], Ty::String);
        self.env.register_global("concat", TypeScheme::mono(concat_ty));
    }

    // ---- エラー記録 ----

    fn emit(&mut self, span: Span, kind: DiagKind) -> Ty {
        self.diags.push(Diagnostic::error(span, kind));
        Ty::Error
    }

    fn emit_unify(&mut self, span: Span, err: UnifyError) -> Ty {
        let kind = match err {
            UnifyError::Mismatch(a, b) => {
                let a = self.table.resolve(a);
                let b = self.table.resolve(b);
                DiagKind::TypeMismatch { expected: a, found: b }
            }
            UnifyError::OccursCheck(v, t) =>
                DiagKind::InfiniteType { var: v, ty: t },
        };
        self.emit(span, kind)
    }

    /// 単一化して失敗したらエラーを記録し Error 型を返す
    fn unify(&mut self, span: Span, t1: Ty, t2: Ty) -> Ty {
        let r1 = self.table.resolve(t1.clone());
        let r2 = self.table.resolve(t2.clone());
        match self.table.unify(r1.clone(), r2.clone()) {
            Ok(()) => r1,
            Err(e) => self.emit_unify(span, e),
        }
    }

    // ---- スパン → u64 キー ----

    fn span_key(span: Span) -> u64 {
        (span.start as u64) * 1_000_000 + span.end as u64
    }

    fn record_type(&mut self, span: Span, ty: Ty) -> Ty {
        let resolved = self.table.resolve(ty.clone());
        self.node_types.insert(Self::span_key(span), resolved);
        ty
    }

    // ==============================================================
    // プログラム全体のチェック
    // ==============================================================

    pub fn check_program(&mut self, program: &Program) {
        // Pass 1: 型定義・プロトコル定義をすべて登録（前方参照を許すため）
        for item in &program.items {
            self.register_decl(item);
        }
        // Pass 2: 関数シグネチャ登録（本体より前に相互再帰を許す）
        for item in &program.items {
            if let TopLevel::Function(f) = item {
                self.register_fn_sig(f);
            }
        }
        // Pass 3: 関数本体の型チェック
        for item in &program.items {
            if let TopLevel::Function(f) = item {
                self.check_fn_body(f);
            }
        }
    }

    // ---- Pass 1: 型・プロトコル登録 ----

    fn register_decl(&mut self, item: &TopLevel) {
        match item {
            TopLevel::TypeDef(td) => self.register_type_def(td),
            TopLevel::Protocol(pd) => self.register_protocol_def(pd),
            _ => {}
        }
    }

    fn register_type_def(&mut self, td: &TypeDef) {
        let info = match &td.ty {
            TypeLiteral::Struct(s) => {
                let fields = s.fields.iter()
                    .map(|f| (f.name.clone(), self.ast_type_to_ty(&f.ty, &s.type_params)))
                    .collect();
                TypeInfo::Struct {
                    type_params: s.type_params.clone(),
                    fields,
                }
            }
            TypeLiteral::Enum(e) => {
                let variants = e.variants.iter()
                    .map(|v| (v.name.clone(), self.ast_type_to_ty(&v.ty, &e.type_params)))
                    .collect();
                TypeInfo::Enum {
                    type_params: e.type_params.clone(),
                    variants,
                }
            }
            other => {
                let ty = self.ast_type_to_ty(other, &[]);
                TypeInfo::Alias { type_params: vec![], ty }
            }
        };
        self.env.register_type(td.name.clone(), info);
    }

    fn register_protocol_def(&mut self, pd: &ProtocolDef) {
        let info = match &pd.body {
            ProtocolBodyOrLiteral::Body(body) => {
                // メソッドの型中の $T → Ty::Named("Self", [])
                let methods = body.methods.iter()
                    .map(|m| {
                        let ty = self.fn_type_body_to_ty(&m.ty, &["Self".to_string()]);
                        (m.name.clone(), ty)
                    })
                    .collect();
                ProtocolInfo { methods, supers: vec![] }
            }
            ProtocolBodyOrLiteral::Literal(lit) => {
                // 複合プロトコル: supers のメソッドを全部マージ
                // ただし名前衝突はここでは記録するのみ（使用時にチェック）
                ProtocolInfo { methods: vec![], supers: lit.names.clone() }
            }
        };
        self.env.register_protocol(pd.name.clone(), info);
    }

    // ---- Pass 2: 関数シグネチャ登録 ----

    fn register_fn_sig(&mut self, f: &FunctionDecl) {
        // 型パラメータ名 → 新鮮な型変数 の対応表を作る
        let type_param_names: Vec<String> = f.protocol_constraints.iter()
            .map(|c| c.name.clone())
            .collect();

        // 型パラメータを Ty::Named(name, []) として扱う（推論変数として後で単一化）
        let param_tys: Vec<Ty> = f.params.iter()
            .map(|p| self.ast_type_to_ty(&p.ty, &type_param_names))
            .collect();
        let ret_ty = self.ast_type_to_ty(&f.return_ty, &type_param_names);

        let fn_ty = Ty::curried(param_tys.iter().cloned(), ret_ty);

        // 型パラメータに対応する型変数を量化
        // （シグネチャ登録時は単純に汎化: 実際の制約チェックは本体で）
        let scheme = TypeScheme {
            quantified: vec![], // 外部呼び出し時はインスタンス化は不要（モノ型として扱う）
            ty: fn_ty,
        };
        self.env.register_global(f.name.clone(), scheme);
    }

    // ---- Pass 3: 関数本体の型チェック ----

    fn check_fn_body(&mut self, f: &FunctionDecl) {
        self.env.push_scope();

        // 型パラメータ名 (プロトコル制約)
        let type_param_names: Vec<String> = f.protocol_constraints.iter()
            .map(|c| c.name.clone())
            .collect();

        // パラメータを現スコープにバインド
        for p in &f.params {
            let ty = self.ast_type_to_ty(&p.ty, &type_param_names);
            self.env.bind_mono(p.name.clone(), ty);
        }

        let expected_ret = self.ast_type_to_ty(&f.return_ty, &type_param_names);

        match &f.body {
            FunctionBody::Builtin(_) => {
                // ビルトインは本体チェック不要
            }
            FunctionBody::Expr(expr) => {
                let found = self.infer_expr(expr);
                let found_resolved = self.table.resolve(found.clone());
                let expected_resolved = self.table.resolve(expected_ret.clone());
                if !found_resolved.is_error() && !expected_resolved.is_error() {
                    self.unify(expr.span(), expected_resolved, found_resolved);
                }
            }
        }

        // プロトコル制約の検証
        for c in &f.protocol_constraints {
            self.check_protocol_constraint(&c.name, &c.body, f.span);
        }

        self.env.pop_scope();
    }

    /// `$T: ^Show` の制約が意味的に正しいかチェック
    fn check_protocol_constraint(
        &mut self,
        _type_param: &str,
        body: &ProtocolBodyOrLiteral,
        span: Span,
    ) {
        match body {
            ProtocolBodyOrLiteral::Literal(lit) => {
                for pname in &lit.names {
                    if self.env.lookup_protocol(pname).is_none() {
                        self.emit(span, DiagKind::UnboundProtocol(pname.clone()));
                    }
                }
            }
            ProtocolBodyOrLiteral::Body(_) => {
                // インラインプロトコル定義は常にOK
            }
        }
    }

    // ==============================================================
    // 式の型推論 (Algorithm W)
    // ==============================================================

    pub fn infer_expr(&mut self, expr: &Expr) -> Ty {
        let ty = match expr {
            Expr::Lit(lit, span) => self.infer_literal(lit, *span),
            Expr::Var(parts, span) => self.infer_var(parts, *span),
            Expr::If(e) => self.infer_if(e),
            Expr::Call(e) => self.infer_call(e),
            Expr::Block(e) => self.infer_block(e),
            Expr::Struct(e) => self.infer_struct_lit(e),
            Expr::Enum(e) => self.infer_enum_lit(e),
            Expr::Paren(inner, _) => self.infer_expr(inner),
        };
        let ty = self.table.resolve(ty);
        self.record_type(expr.span(), ty.clone());
        ty
    }

    // ---- リテラル ----

    fn infer_literal(&mut self, lit: &Literal, _span: Span) -> Ty {
        match lit {
            Literal::String(_) => Ty::String,
            Literal::Number(s) => {
                if s.contains('.') {
                    // 小数点あり → Float として確定
                    Ty::Float
                } else {
                    // 整数リテラル → NumVar を生成
                    // NumVar は Int/Float のみに解決可能で Bool とは単一化できない
                    // これにより `if 42 then ...` はエラーになり、
                    // `Vec2 { x = 0 }` の Float フィールドへの代入は OK になる
                    self.table.new_num_var()
                }
            }
            Literal::Bool(_) => Ty::Bool,
        }
    }

    // ---- 変数 / フィールドアクセス ----

    fn infer_var(&mut self, parts: &[String], span: Span) -> Ty {
        if parts.is_empty() {
            return self.emit(span, DiagKind::Other("empty var".into()));
        }

        // 先頭の識別子を変数として解決
        let base_ty = match self.env.lookup(&parts[0]) {
            Some(scheme) => {
                let scheme = scheme.clone();
                self.env.instantiate(&scheme, &mut self.table)
            }
            None => {
                return self.emit(span, DiagKind::UnboundVar(parts[0].clone()));
            }
        };

        // フィールドアクセス: a.b.c
        if parts.len() == 1 {
            return base_ty;
        }
        self.resolve_field_chain(base_ty, &parts[1..], span)
    }

    fn resolve_field_chain(&mut self, mut ty: Ty, fields: &[String], span: Span) -> Ty {
        for field_name in fields {
            ty = self.table.resolve(ty.clone());
            ty = self.access_field(ty, field_name, span);
        }
        ty
    }

    fn access_field(&mut self, ty: Ty, field: &str, span: Span) -> Ty {
        let ty = self.table.resolve(ty);
        match &ty {
            Ty::Named { name, args } => {
                let name = name.clone();
                let args = args.clone();
                match self.env.lookup_type(&name).cloned() {
                    Some(TypeInfo::Struct { type_params, fields }) => {
                        // フィールドを探す
                        if let Some((_, field_ty)) =
                            fields.iter().find(|(n, _)| n == field)
                        {
                            // 型パラメータを実際の引数で置換
                            self.substitute_type_params(
                                field_ty.clone(),
                                &type_params,
                                &args,
                            )
                        } else {
                            // プロトコルメソッドアクセスをチェック
                            self.check_protocol_method_access(&name, field, span)
                        }
                    }
                    Some(TypeInfo::Enum { .. }) => {
                        // enum のフィールドアクセスは .tag と .value のみ
                        match field {
                            "tag" => Ty::String,
                            "value" => self.table.new_var(), // payload型は未知
                            _ => self.emit(span, DiagKind::Other(
                                format!("enum `{}` has no field `{}`", name, field)
                            )),
                        }
                    }
                    _ => {
                        self.emit(span, DiagKind::Other(
                            format!("type `{}` has no field `{}`", name, field)
                        ))
                    }
                }
            }
            Ty::Var(_) => {
                // 未解決変数: フィールド型も変数のまま
                self.table.new_var()
            }
            Ty::Error => Ty::Error,
            other => {
                let other = other.clone();
                self.emit(span, DiagKind::Other(
                    format!("type `{}` does not support field access", other)
                ))
            }
        }
    }

    /// プロトコルメソッドアクセス: 複数プロトコルで同名メソッドがあればエラー
    fn check_protocol_method_access(
        &mut self,
        _type_name: &str,
        method: &str,
        span: Span,
    ) -> Ty {
        // メソッドを持つプロトコルをすべて収集
        let matching: Vec<String> = self.env.protocols.iter()
            .filter(|(_, info)| info.methods.iter().any(|(n, _)| n == method))
            .map(|(name, _)| name.clone())
            .collect();

        match matching.len() {
            0 => self.emit(span, DiagKind::Other(
                format!("no method `{}` found in any protocol", method)
            )),
            1 => {
                // 唯一のプロトコルのメソッド型を返す
                let proto_name = &matching[0];
                let method_ty = self.env.protocols[proto_name]
                    .methods.iter()
                    .find(|(n, _)| n == method)
                    .map(|(_, ty)| ty.clone())
                    .unwrap();
                method_ty
            }
            _ => {
                // 複数プロトコルで定義 → 曖昧エラー
                self.emit(span, DiagKind::AmbiguousMethod {
                    method: method.to_string(),
                    protocols: matching,
                })
            }
        }
    }

    // ---- if-then-else ----

    fn infer_if(&mut self, e: &IfExpr) -> Ty {
        let cond_ty = self.infer_expr(&e.cond);
        self.unify(e.cond.span(), Ty::Bool, cond_ty);

        let then_ty = self.infer_expr(&e.then);
        let else_ty = self.infer_expr(&e.else_);

        let then_r = self.table.resolve(then_ty.clone());
        let else_r = self.table.resolve(else_ty.clone());

        if then_r.is_error() || else_r.is_error() {
            return Ty::Error;
        }
        self.unify(e.span, then_r, else_r)
    }

    // ---- 関数適用 (カリー化) ----
    // f a  →  f: A -> B, a: A  ⊢  B

    fn infer_call(&mut self, e: &CallExpr) -> Ty {
        let callee_ty = self.infer_expr(&e.callee);
        let arg_ty = self.infer_expr(&e.arg);

        let ret_var = self.table.new_var();
        let expected_fn_ty = Ty::fun(arg_ty.clone(), ret_var.clone());

        let callee_r = self.table.resolve(callee_ty.clone());
        let expected_r = self.table.resolve(expected_fn_ty.clone());

        if callee_r.is_error() || arg_ty.is_error() {
            return Ty::Error;
        }

        self.unify(e.span, callee_r, expected_r);
        self.table.resolve(ret_var)
    }

    // ---- do-where ブロック ----

    fn infer_block(&mut self, e: &BlockExpr) -> Ty {
        self.env.push_scope();

        // where 節のバインディングを先に評価（letrec 的に）
        // 依存関係追跡は省略 — まず型変数を割り当ててから本体を推論
        let mut binding_vars: Vec<(String, Ty)> = Vec::new();
        for b in &e.bindings {
            // 型アノテーションがあればそれを使い、なければ新鮮な型変数
            let ty = if let Some(ann) = &b.ty {
                self.ast_type_to_ty(ann, &[])
            } else {
                self.table.new_var()
            };
            self.env.bind_mono(b.name.clone(), ty.clone());
            binding_vars.push((b.name.clone(), ty));
        }

        // バインディングの値を推論して単一化
        for (b, (_, expected_ty)) in e.bindings.iter().zip(binding_vars.iter()) {
            let val_ty = self.infer_expr(&b.value);
            let val_r = self.table.resolve(val_ty);
            let exp_r = self.table.resolve(expected_ty.clone());
            if !val_r.is_error() && !exp_r.is_error() {
                self.unify(b.value.span(), exp_r, val_r);
            }
        }

        // ステートメントを順に処理
        let mut last_break_ty: Option<Ty> = None;
        for stmt in &e.stmts {
            match stmt {
                BlockStmt::Expr(expr) => {
                    self.infer_expr(expr);
                }
                BlockStmt::Break(expr, span) => {
                    let ty = self.infer_expr(expr);
                    let ty_r = self.table.resolve(ty);
                    if let Some(prev) = last_break_ty.take() {
                        let prev_r = self.table.resolve(prev);
                        last_break_ty = Some(self.unify(*span, prev_r, ty_r));
                    } else {
                        last_break_ty = Some(ty_r);
                    }
                }
            }
        }

        // 最終式
        let final_ty = self.infer_expr(&e.final_expr);
        let final_r = self.table.resolve(final_ty);

        // break があれば break の型と final の型を単一化
        let result_ty = if let Some(break_ty) = last_break_ty {
            let break_r = self.table.resolve(break_ty);
            if !break_r.is_error() && !final_r.is_error() {
                self.unify(e.final_expr.span(), break_r, final_r)
            } else {
                final_r
            }
        } else {
            final_r
        };

        self.env.pop_scope();
        result_ty
    }

    // ---- struct リテラル ----

    fn infer_struct_lit(&mut self, e: &StructLit) -> Ty {
        // 型レジストリから struct 情報を取得
        match self.env.lookup_type(&e.name).cloned() {
            Some(TypeInfo::Struct { type_params, fields }) => {
                // 型パラメータに対応する新鮮な型変数を生成
                let type_args: Vec<Ty> = type_params.iter()
                    .map(|_| self.table.new_var())
                    .collect();

                // 各フィールドを検査
                let fields_snapshot: Vec<(String, Ty)> = fields.clone();
                for lit_field in &e.fields {
                    let val_ty = self.infer_expr(&lit_field.value);
                    let val_r = self.table.resolve(val_ty);

                    match fields_snapshot.iter().find(|(n, _)| *n == lit_field.name) {
                        Some((_, field_ty)) => {
                            let expected = self.substitute_type_params(
                                field_ty.clone(), &type_params, &type_args,
                            );
                            let expected_r = self.table.resolve(expected);
                            if !val_r.is_error() {
                                self.unify(lit_field.value.span(), expected_r, val_r);
                            }
                        }
                        None => {
                            self.emit(e.span, DiagKind::Other(
                                format!("struct `{}` has no field `{}`", e.name, lit_field.name)
                            ));
                        }
                    }
                }

                // 未指定フィールドのチェック
                for (field_name, _) in &fields_snapshot {
                    if !e.fields.iter().any(|f| &f.name == field_name) {
                        self.emit(e.span, DiagKind::Other(
                            format!("missing field `{}` in `{}` literal", field_name, e.name)
                        ));
                    }
                }

                Ty::Named { name: e.name.clone(), args: type_args }
            }
            Some(_) => {
                self.emit(e.span, DiagKind::Other(
                    format!("`{}` is not a struct type", e.name)
                ))
            }
            None => {
                self.emit(e.span, DiagKind::UnboundType(e.name.clone()))
            }
        }
    }

    // ---- enum リテラル: `Some(42)` ----

    fn infer_enum_lit(&mut self, e: &EnumLit) -> Ty {
        let val_ty = self.infer_expr(&e.value);
        let val_r = self.table.resolve(val_ty);

        // バリアント名からどの enum 型か逆引き
        let found: Vec<(String, TypeInfo)> = self.env.types.iter()
            .filter(|(_, info)| matches!(info,
                TypeInfo::Enum { variants, .. }
                if variants.iter().any(|(n, _)| n == &e.name)
            ))
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();

        match found.len() {
            0 => {
                // 未知のバリアント → エラーだが Unit ペイロードとして処理
                self.emit(e.span, DiagKind::UnboundType(e.name.clone()))
            }
            1 => {
                let (enum_name, info) = &found[0];
                if let TypeInfo::Enum { type_params, variants } = info {
                    let type_args: Vec<Ty> = type_params.iter()
                        .map(|_| self.table.new_var())
                        .collect();

                    if let Some((_, payload_ty)) =
                        variants.iter().find(|(n, _)| n == &e.name)
                    {
                        let expected = self.substitute_type_params(
                            payload_ty.clone(), type_params, &type_args,
                        );
                        let expected_r = self.table.resolve(expected);
                        if !val_r.is_error() {
                            self.unify(e.value.span(), expected_r, val_r);
                        }
                    }
                    Ty::Named { name: enum_name.clone(), args: type_args }
                } else {
                    unreachable!()
                }
            }
            _ => {
                // 複数の enum 型にバリアントが存在 → 曖昧
                let names: Vec<_> = found.iter().map(|(n, _)| n.clone()).collect();
                self.emit(e.span, DiagKind::Other(
                    format!("ambiguous variant `{}`: found in types [{}]",
                        e.name, names.join(", "))
                ))
            }
        }
    }

    // ==============================================================
    // AST 型リテラル → Ty への変換
    // ==============================================================

    pub fn ast_type_to_ty(&mut self, ty: &TypeLiteral, type_params: &[String]) -> Ty {
        match ty {
            TypeLiteral::Named(n) => {
                // 型パラメータ名は Ty::Named(name, []) として扱う
                if n.args.is_empty() && type_params.contains(&n.name) {
                    return Ty::Named { name: n.name.clone(), args: vec![] };
                }
                match n.name.as_str() {
                    "Int"    => return Ty::Int,
                    "Float"  => return Ty::Float,
                    "Bool"   => return Ty::Bool,
                    "String" => return Ty::String,
                    "Unit"   => return Ty::Unit,
                    "Never"  => return Ty::Never,
                    _ => {}
                }
                let explicit_args: Vec<Ty> = n.args.iter()
                    .map(|a| self.ast_type_to_ty(a, type_params))
                    .collect();

                // 型引数の処理:
                //   - 明示的に引数あり → 数チェック
                //   - 引数なし + ジェネリック型定義あり → 新鮮な型変数を自動補完
                let args = if let Some(info) = self.env.lookup_type(&n.name).cloned() {
                    let expected = info.type_params().len();
                    if !explicit_args.is_empty() {
                        // 明示的引数の数チェック
                        if explicit_args.len() != expected {
                            self.emit(n.span, DiagKind::TypeArgCount {
                                name: n.name.clone(),
                                expected,
                                found: explicit_args.len(),
                            });
                        }
                        explicit_args
                    } else if expected > 0 {
                        // 引数省略 → 新鮮な型変数で補完 (HM の型引数推論)
                        (0..expected).map(|_| self.table.new_var()).collect()
                    } else {
                        explicit_args
                    }
                } else {
                    explicit_args
                };
                Ty::Named { name: n.name.clone(), args }
            }
            TypeLiteral::Struct(s) => {
                // 匿名 struct 型リテラルは Named として生成されないので
                // インライン展開するしかない: 各フィールドの型だけ変換
                // （ASTの TypeLiteral::Struct は型定義内でしか現れない想定）
                let _ = s;
                self.table.new_var() // フォールバック
            }
            TypeLiteral::Enum(e) => {
                let _ = e;
                self.table.new_var()
            }
            TypeLiteral::Fn(f) => {
                self.fn_type_body_to_ty(f, type_params)
            }
        }
    }

    pub fn fn_type_body_to_ty(&mut self, f: &FnTypeBody, type_params: &[String]) -> Ty {
        // プロトコル制約の型パラメータ名を追加
        let mut all_params: Vec<String> = type_params.to_vec();
        for c in &f.protocols {
            if !all_params.contains(&c.name) {
                all_params.push(c.name.clone());
            }
        }

        let param_ty = self.ast_type_to_ty(&f.param_ty, &all_params);
        let ret_ty = match &f.return_ty {
            FnReturn::Type(t) => self.ast_type_to_ty(t, &all_params),
            FnReturn::Fn(inner) => self.fn_type_body_to_ty(inner, &all_params),
        };
        Ty::fun(param_ty, ret_ty)
    }

    // ---- 型パラメータの置換ヘルパー ----

    fn substitute_type_params(
        &self,
        mut ty: Ty,
        params: &[String],
        args: &[Ty],
    ) -> Ty {
        for (param, arg) in params.iter().zip(args.iter()) {
            ty = substitute_named(&ty, param, arg);
        }
        ty
    }

    // ---- 診断サマリ ----

    pub fn has_errors(&self) -> bool {
        !self.diags.is_empty()
    }

    pub fn error_count(&self) -> usize {
        self.diags.len()
    }
}

impl Default for TypeChecker {
    fn default() -> Self { Self::new() }
}

// ============================================================
// 補助: Named型パラメータを Ty で置換
// ============================================================

fn substitute_named(ty: &Ty, param: &str, arg: &Ty) -> Ty {
    match ty {
        Ty::Named { name, args } if name == param && args.is_empty() => arg.clone(),
        Ty::Named { name, args } => Ty::Named {
            name: name.clone(),
            args: args.iter().map(|a| substitute_named(a, param, arg)).collect(),
        },
        Ty::Fn(a, b) => Ty::fun(
            substitute_named(a, param, arg),
            substitute_named(b, param, arg),
        ),
        other => other.clone(),
    }
}

// テストモジュールをインクルード
#[cfg(test)]
#[path = "typeck_tests.rs"]
mod tests;
