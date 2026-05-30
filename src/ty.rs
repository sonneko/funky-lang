/// 型チェッカーが扱う「型」の表現。
/// ASTの TypeLiteral とは別に、推論用の正規化された型を定義する。
use std::fmt;

// ============================================================
// 型変数キー (ena::UnifyKey 実装)
// ============================================================

use ena::unify::{EqUnifyValue, InPlaceUnificationTable, UnifyKey};

/// 型変数 `?T0`, `?T1`, ... を表す整数キー
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub struct TyVarId(pub u32);

impl UnifyKey for TyVarId {
    type Value = Option<Ty>;
    fn index(&self) -> u32 { self.0 }
    fn from_index(u: u32) -> Self { TyVarId(u) }
    fn tag() -> &'static str { "TyVar" }
}

impl EqUnifyValue for Ty {}

// ============================================================
// 型
// ============================================================

/// 推論・検査に使う正規化済み型
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Ty {
    // --- プリミティブ ---
    Int,
    Float,
    Bool,
    String,
    Unit,
    Never,

    // --- 複合型 ---
    /// `Foo<T1, T2>` — ユーザー定義の named type (struct/enum/alias)
    Named {
        name: String,
        args: Vec<Ty>,
    },

    /// カリー化された関数型 `A -> B`
    Fn(Box<Ty>, Box<Ty>),

    // --- 型変数 ---
    /// HM推論中の未解決変数 (enaテーブルのキー)
    Var(TyVarId),

    /// 数値専用の型変数: Int または Float のみに解決可能
    /// `42` のような整数リテラルに割り当て、Bool と単一化されるとエラーになる
    NumVar(TyVarId),

    // --- エラー回復用 ---
    Error,
}

impl Ty {
    pub fn fun(param: Ty, ret: Ty) -> Self {
        Ty::Fn(Box::new(param), Box::new(ret))
    }

    /// 多引数カリー化関数型を構築: `[A, B, C] -> R` → `A -> B -> C -> R`
    pub fn curried(params: impl IntoIterator<Item = Ty>, ret: Ty) -> Self {
        let params: Vec<_> = params.into_iter().collect();
        params.into_iter().rev().fold(ret, |acc, p| Ty::fun(p, acc))
    }

    /// 型変数を含むか (occurs check 用)
    pub fn contains_var(&self, id: TyVarId) -> bool {
        match self {
            Ty::Var(v) | Ty::NumVar(v) => *v == id,
            Ty::Fn(a, b) => a.contains_var(id) || b.contains_var(id),
            Ty::Named { args, .. } => args.iter().any(|a| a.contains_var(id)),
            _ => false,
        }
    }

    /// 型変数を型で置換 (shallow)
    pub fn substitute(&self, id: TyVarId, with: &Ty) -> Ty {
        match self {
            Ty::Var(v) | Ty::NumVar(v) if *v == id => with.clone(),
            Ty::Fn(a, b) => Ty::fun(
                a.substitute(id, with),
                b.substitute(id, with),
            ),
            Ty::Named { name, args } => Ty::Named {
                name: name.clone(),
                args: args.iter().map(|a| a.substitute(id, with)).collect(),
            },
            other => other.clone(),
        }
    }

    /// Error を含まない正常な型か
    pub fn is_error(&self) -> bool {
        match self {
            Ty::Error => true,
            Ty::Fn(a, b) => a.is_error() || b.is_error(),
            Ty::Named { args, .. } => args.iter().any(|a| a.is_error()),
            _ => false,
        }
    }
}

impl fmt::Display for Ty {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Ty::Int    => write!(f, "Int"),
            Ty::Float  => write!(f, "Float"),
            Ty::Bool   => write!(f, "Bool"),
            Ty::String => write!(f, "String"),
            Ty::Unit   => write!(f, "Unit"),
            Ty::Never  => write!(f, "Never"),
            Ty::Error  => write!(f, "<error>"),
            Ty::Var(v)    => write!(f, "?t{}", v.0),
            Ty::NumVar(v) => write!(f, "?n{}", v.0),
            Ty::Fn(a, b) => {
                if matches!(a.as_ref(), Ty::Fn(..)) {
                    write!(f, "({}) -> {}", a, b)
                } else {
                    write!(f, "{} -> {}", a, b)
                }
            }
            Ty::Named { name, args } if args.is_empty() => write!(f, "{}", name),
            Ty::Named { name, args } => {
                write!(f, "{}<{}>", name,
                    args.iter().map(|a| a.to_string()).collect::<Vec<_>>().join(", "))
            }
        }
    }
}

// ============================================================
// 型スキーム (∀α. T)  — let多相用
// ============================================================

/// HM の型スキーム: 量化された型変数 + 型本体
#[derive(Clone, Debug)]
pub struct TypeScheme {
    /// 全称量化された変数ID列
    pub quantified: Vec<TyVarId>,
    pub ty: Ty,
}

impl TypeScheme {
    pub fn mono(ty: Ty) -> Self {
        TypeScheme { quantified: vec![], ty }
    }
}

// ============================================================
// 単一化テーブルのラッパー
// ============================================================

/// ena の InPlaceUnificationTable をラップして使いやすくしたもの
pub struct UnifyTable {
    pub table: InPlaceUnificationTable<TyVarId>,
}

impl UnifyTable {
    pub fn new() -> Self {
        Self { table: InPlaceUnificationTable::new() }
    }

    /// 新鮮な型変数を生成
    pub fn new_var(&mut self) -> Ty {
        let key = self.table.new_key(None);
        Ty::Var(key)
    }

    /// 新鮮な数値型変数を生成 (Int / Float のみに解決可能)
    pub fn new_num_var(&mut self) -> Ty {
        let key = self.table.new_key(None);
        Ty::NumVar(key)
    }

    /// 型変数の現在の値を取得（再帰的に解決）
    pub fn resolve(&mut self, ty: Ty) -> Ty {
        match ty {
            Ty::Var(id) => {
                match self.table.probe_value(id) {
                    Some(resolved) => self.resolve(resolved),
                    None => Ty::Var(id),
                }
            }
            // NumVar も同じテーブルで管理。解決済みなら具体型、未解決なら NumVar を維持
            Ty::NumVar(id) => {
                match self.table.probe_value(id) {
                    Some(resolved) => self.resolve(resolved),
                    None => Ty::NumVar(id),
                }
            }
            Ty::Fn(a, b) => {
                Ty::fun(self.resolve(*a), self.resolve(*b))
            }
            Ty::Named { name, args } => Ty::Named {
                name,
                args: args.into_iter().map(|a| self.resolve(a)).collect(),
            },
            other => other,
        }
    }

    /// 単一化: t1 と t2 を同じ型として扱う
    /// 失敗したら UnifyError を返す
    pub fn unify(&mut self, t1: Ty, t2: Ty) -> Result<(), UnifyError> {
        let t1 = self.resolve(t1);
        let t2 = self.resolve(t2);

        match (t1, t2) {
            // 同一プリミティブ → OK
            (Ty::Int,    Ty::Int)    => Ok(()),
            (Ty::Float,  Ty::Float)  => Ok(()),
            (Ty::Bool,   Ty::Bool)   => Ok(()),
            (Ty::String, Ty::String) => Ok(()),
            (Ty::Unit,   Ty::Unit)   => Ok(()),
            (Ty::Never,  _) | (_, Ty::Never) => Ok(()),  // bottom type
            (Ty::Error,  _) | (_, Ty::Error)  => Ok(()),  // エラー回復: 伝播させない

            // 両方同じ変数 (Var/NumVar) → OK
            (Ty::Var(a),    Ty::Var(b))    if a == b => Ok(()),
            (Ty::NumVar(a), Ty::NumVar(b)) if a == b => Ok(()),

            // NumVar + NumVar (異なる変数) → 一方を他方に束縛
            (Ty::NumVar(a), Ty::NumVar(b)) => {
                self.table.unify_var_value(a, Some(Ty::NumVar(b)))
                    .map_err(|(got, expected)| UnifyError::Mismatch(got, expected))
            }

            // NumVar ← Int/Float: 数値型なので OK
            (Ty::NumVar(id), Ty::Int)   | (Ty::Int,   Ty::NumVar(id)) => {
                self.table.unify_var_value(id, Some(Ty::Int))
                    .map_err(|(got, expected)| UnifyError::Mismatch(got, expected))
            }
            (Ty::NumVar(id), Ty::Float) | (Ty::Float, Ty::NumVar(id)) => {
                self.table.unify_var_value(id, Some(Ty::Float))
                    .map_err(|(got, expected)| UnifyError::Mismatch(got, expected))
            }

            // NumVar ← 非数値型: エラー (Bool 等を数値リテラルとして使おうとした)
            (Ty::NumVar(id), other) | (other, Ty::NumVar(id)) => {
                Err(UnifyError::Mismatch(Ty::NumVar(id), other))
            }

            // Var ← 具体型
            (Ty::Var(id), other) | (other, Ty::Var(id)) => {
                // occurs check
                if other.contains_var(id) {
                    return Err(UnifyError::OccursCheck(id, other));
                }
                self.table.unify_var_value(id, Some(other))
                    .map_err(|(got, expected)| UnifyError::Mismatch(got, expected))
            }

            // 関数型
            (Ty::Fn(a1, b1), Ty::Fn(a2, b2)) => {
                self.unify(*a1, *a2)?;
                self.unify(*b1, *b2)
            }

            // Named type
            (Ty::Named { name: n1, args: a1 }, Ty::Named { name: n2, args: a2 })
                if n1 == n2 && a1.len() == a2.len() =>
            {
                for (x, y) in a1.into_iter().zip(a2) {
                    self.unify(x, y)?;
                }
                Ok(())
            }

            (t1, t2) => Err(UnifyError::Mismatch(t1, t2)),
        }
    }
}

impl Default for UnifyTable {
    fn default() -> Self { Self::new() }
}

// ============================================================
// 単一化エラー
// ============================================================

#[derive(Debug, Clone)]
pub enum UnifyError {
    Mismatch(Ty, Ty),
    OccursCheck(TyVarId, Ty),
}

impl fmt::Display for UnifyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            UnifyError::Mismatch(a, b) =>
                write!(f, "type mismatch: expected `{}`, found `{}`", a, b),
            UnifyError::OccursCheck(v, t) =>
                write!(f, "infinite type: `?t{}` occurs in `{}`", v.0, t),
        }
    }
}
