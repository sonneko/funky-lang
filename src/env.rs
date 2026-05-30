/// 型環境: スコープ付き変数バインディング + 型/プロトコル定義レジストリ
use std::collections::HashMap;
use crate::ty::{Ty, TypeScheme, TyVarId, UnifyTable};

// ============================================================
// 型定義の種類
// ============================================================

/// 型チェッカーが知っている型の実体
#[derive(Clone, Debug)]
pub enum TypeInfo {
    /// struct型 — フィールド名 → 型
    Struct {
        type_params: Vec<String>,
        fields: Vec<(String, Ty)>,
    },
    /// enum型 — バリアント名 → payload型
    Enum {
        type_params: Vec<String>,
        variants: Vec<(String, Ty)>,
    },
    /// 型エイリアス
    Alias {
        type_params: Vec<String>,
        ty: Ty,
    },
}

impl TypeInfo {
    pub fn type_params(&self) -> &[String] {
        match self {
            TypeInfo::Struct { type_params, .. } => type_params,
            TypeInfo::Enum   { type_params, .. } => type_params,
            TypeInfo::Alias  { type_params, .. } => type_params,
        }
    }
}

// ============================================================
// プロトコル情報
// ============================================================

/// プロトコル定義
#[derive(Clone, Debug)]
pub struct ProtocolInfo {
    /// メソッド名 → そのメソッドの型 (型パラメータ T を Ty::Named("Self",[]) で表す)
    pub methods: Vec<(String, Ty)>,
    /// 複合プロトコルの場合、継承元リスト
    pub supers: Vec<String>,
}

// ============================================================
// 変数スコープ (レキシカル)
// ============================================================

/// 一つのスコープフレーム
#[derive(Clone, Debug)]
struct Frame {
    /// 変数名 → 型スキーム
    vars: HashMap<String, TypeScheme>,
}

impl Frame {
    fn new() -> Self {
        Self { vars: HashMap::new() }
    }
}

// ============================================================
// 型環境
// ============================================================

pub struct Env {
    /// スコープスタック (末尾が最内)
    frames: Vec<Frame>,

    /// 型名 → TypeInfo (グローバル)
    pub types: HashMap<String, TypeInfo>,

    /// プロトコル名 → ProtocolInfo (グローバル)
    pub protocols: HashMap<String, ProtocolInfo>,

    /// 関数名 → 型スキーム (グローバル)
    pub globals: HashMap<String, TypeScheme>,
}

impl Env {
    pub fn new() -> Self {
        Self {
            frames: vec![Frame::new()],
            types: HashMap::new(),
            protocols: HashMap::new(),
            globals: HashMap::new(),
        }
    }

    // ---- スコープ管理 ----

    pub fn push_scope(&mut self) {
        self.frames.push(Frame::new());
    }

    pub fn pop_scope(&mut self) {
        assert!(self.frames.len() > 1, "cannot pop root scope");
        self.frames.pop();
    }

    // ---- 変数バインディング ----

    /// 現在スコープに変数を追加
    pub fn bind(&mut self, name: impl Into<String>, scheme: TypeScheme) {
        self.frames.last_mut().unwrap().vars.insert(name.into(), scheme);
    }

    /// 変数をモノ型でバインド
    pub fn bind_mono(&mut self, name: impl Into<String>, ty: Ty) {
        self.bind(name, TypeScheme::mono(ty));
    }

    /// 変数を内側スコープから外側へ順に探索
    pub fn lookup(&self, name: &str) -> Option<&TypeScheme> {
        for frame in self.frames.iter().rev() {
            if let Some(s) = frame.vars.get(name) {
                return Some(s);
            }
        }
        // グローバル関数も探す
        self.globals.get(name)
    }

    // ---- 型登録 ----

    pub fn register_type(&mut self, name: impl Into<String>, info: TypeInfo) {
        self.types.insert(name.into(), info);
    }

    pub fn lookup_type(&self, name: &str) -> Option<&TypeInfo> {
        self.types.get(name)
    }

    // ---- プロトコル登録 ----

    pub fn register_protocol(&mut self, name: impl Into<String>, info: ProtocolInfo) {
        self.protocols.insert(name.into(), info);
    }

    pub fn lookup_protocol(&self, name: &str) -> Option<&ProtocolInfo> {
        self.protocols.get(name)
    }

    // ---- グローバル関数 ----

    pub fn register_global(&mut self, name: impl Into<String>, scheme: TypeScheme) {
        self.globals.insert(name.into(), scheme);
    }

    // ---- 型スキームのインスタンス化 ----
    /// ∀α β. T  →  ?a ?b で置き換えた T を返す

    pub fn instantiate(&self, scheme: &TypeScheme, table: &mut UnifyTable) -> Ty {
        if scheme.quantified.is_empty() {
            return scheme.ty.clone();
        }
        let mut ty = scheme.ty.clone();
        for &qid in &scheme.quantified {
            let fresh = table.new_var();
            if let Ty::Var(fresh_id) = fresh {
                ty = ty.substitute(qid, &Ty::Var(fresh_id));
            }
        }
        ty
    }

    // ---- 汎化 (let多相) ----
    /// 環境中に現れない自由型変数を全称量化する

    pub fn generalize(&self, ty: &Ty, table: &mut UnifyTable) -> TypeScheme {
        let resolved = table.resolve(ty.clone());
        let env_vars = self.free_type_vars(table);
        let free = free_vars_in_ty(&resolved);
        let quantified: Vec<TyVarId> = free
            .into_iter()
            .filter(|v| !env_vars.contains(v))
            .collect();
        TypeScheme { quantified, ty: resolved }
    }

    /// 環境全体の自由型変数を収集
    fn free_type_vars(&self, table: &mut UnifyTable) -> Vec<TyVarId> {
        let mut result = Vec::new();
        for frame in &self.frames {
            for scheme in frame.vars.values() {
                let resolved = table.resolve(scheme.ty.clone());
                let fv = free_vars_in_ty(&resolved);
                for v in fv {
                    if !scheme.quantified.contains(&v) && !result.contains(&v) {
                        result.push(v);
                    }
                }
            }
        }
        result
    }
}

/// 型中の自由型変数を収集 (重複なし、出現順)
pub fn free_vars_in_ty(ty: &Ty) -> Vec<TyVarId> {
    let mut result = Vec::new();
    collect_free(ty, &mut result);
    result
}

fn collect_free(ty: &Ty, out: &mut Vec<TyVarId>) {
    match ty {
        Ty::Var(id) | Ty::NumVar(id) => {
            if !out.contains(id) { out.push(*id); }
        }
        Ty::Fn(a, b) => { collect_free(a, out); collect_free(b, out); }
        Ty::Named { args, .. } => {
            for a in args { collect_free(a, out); }
        }
        _ => {}
    }
}
