# funky-lang

カスタム言語のVMパイプラインをRustで実装するプロジェクト。

## クレート構成

```
src/
  ast.rs      — ASTノード定義（Span・型・式・宣言）
  lexer.rs    — Lexer（トークナイザ）
  parser.rs   — 再帰下降パーサー
  lib.rs      — クレートルート
  main.rs     — CLI エントリーポイント
```

## ビルドと実行

```bash
# ビルド
cargo build

# テスト
cargo test

# サンプル実行
cargo run -- examples/sample.lang
```

## 現在の実装状況

- [x] **Lexer** — `/* */` コメント、文字列エスケープ、全トークン種別
- [x] **AST** — Span付き全ノード定義
- [x] **Parser** — 再帰下降、型リテラル・式・宣言を全網羅
- [ ] Phase 1: 型チェッカー (HM型推論)
- [ ] Phase 2: IR設計と変換
- [ ] Phase 3: バイトコード生成
- [ ] Phase 4: VMスタックマシン
- [ ] Phase 5: 最適化・REPL・デバッガ

## 言語文法の要点

```
program     = top_level*
top_level   = using | function | type_def | protocol_def

using       = "using" (ident ("as" ident)?)* "from" string ";"
type_def    = "$" ident "is" type_literal ";"
protocol    = "^" ident "is" proto_body ";"
function    = ident proto_params? params ">" type "is" (expr | "#" ident) ";"

type_literal = "$" ident ("<" type* ">")? | struct_type | enum_type | fn_type
struct_type  = ("$" ident)* "=>"? "{" (ident "=" type)* "}"
enum_type    = ("$" ident)* "=>"? "|" (ident "=" type)* "|"
fn_type      = ("$" ident ":" "^" ident)* "=>"? type ">" (fn_type | type)

expr         = if_expr | call_expr | block_expr | primary | paren
call_expr    = expr primary+        -- 左結合カリー化適用
block_expr   = "do" "{" stmt* expr "}" "where" "{" binding* "}"
```
