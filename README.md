# funky-lang

Rust 製の小さな関数型言語です。ソースを解析・型検査し、検証済みバイトコードへコンパイルして、明示的な呼び出しフレームを持つスタック VM で実行します。

## すぐに試す

Rust stable が必要です。

```bash
cargo test
cargo run -- examples/sample.funky
```

`main` が返した値が表示されます。CLI には次のサブコマンドもあります。

```bash
cargo run -- check examples/sample.funky
cargo run -- compile examples/sample.funky -o /tmp/sample.fbc
cargo run -- run /tmp/sample.fbc --entry main --fuel 10000000
cargo run -- disassemble /tmp/sample.fbc
cargo run -- repl
```

サブコマンドを省略してソースファイルを渡すと、`run FILE` と同じ動作です。`--no-typecheck` を `run` / `compile` に指定すると型検査を省略できますが、コンパイル時の名前・レイアウト検証と VM の実行時チェックは残ります。

## パイプライン

```text
UTF-8 source → lexer → parser / AST → HM type checker → bytecode compiler
                                                   → bytecode verifier → VM
```

- **Lexer / Parser**: Span 付き AST、文字列エスケープ、ブロックコメント、宣言・式を解析します。
- **型チェッカー**: `ena` の Union-Find 単一化を使った Hindley–Milner 型推論、関数の相互再帰、基本的な構造体・列挙型検査を行います。
- **コンパイラ**: ローカル変数を固定スロットへ割り当て、識別子をシンボル番号に intern し、カリー化呼び出し・分岐・ブロック・構造体・列挙型をバイトコードへ変換します。
- **VM**: 単一オペランドスタックと明示的なコールフレームを使用します。整数演算はオーバーフローを検出し、命令 fuel・最大コール深度・スタック上限を設定できます。
- **`.fbc`**: `serde` / `bincode` 形式のバージョン付きバイトコードです。ロード時にシンボル・型・ジャンプ先・ローカル・スタック効果を検証します。形式はバージョン間で安定した交換フォーマットではありません。

## 言語の例

```funky
$Point is { x = $Int  y = $Int };

/* 標準 VM の nativeAdd を使った関数 */
add x: $Int  y: $Int > $Int is # nativeAdd;

sumPoint p: $Point > $Int is add p.x p.y;

factorial n: $Int > $Int is
  if le n 1 then 1 else mul n (factorial (sub n 1));

main > $Int is sumPoint Point { x = 20  y = 22 };
```

言語の関数適用は左結合・カリー化です。`add 20 22` は `((add 20) 22)` としてコンパイルされ、部分適用した関数値も扱えます。括弧付きの関数引数も利用できます。列挙バリアントは `Some(42)` のように先頭大文字で書きます。標準関数は `add`, `sub`, `mul`, `div`, `mod_`, `eq`, `lt`, `gt`, `le`, `ge`, `ne`, `and`, `or`, `not`, `concat` です。比較・算術関数はソース上では通常の関数として呼び出します。

## Rust API

```rust
use funkylang::{compile_source, Value, Vm};

let bytecode = compile_source("main > $Int is add 20 22;").expect("compile");
let mut vm = Vm::new(bytecode).expect("verified bytecode");
let answer = vm.run("main").expect("run");
assert_eq!(answer, Value::Int(42));
```

ホストアプリケーションは `Vm::register_native("hostFunction", callback)` で `# hostFunction` に対応する native 関数を登録できます。実行する入口は `Vm::run`、引数付き呼び出しは `Vm::call` です。

## Draft 0.2 TypeScript prototype

Rust 版とは別に、Draft 0.2 の機能を試す TypeScript コンパイラー試作を `mock/` に実装しています。Rust CLI の動作は変更しません。Node.js 22.6 以降で `npm ci`、`npm test`、`npm run check:prototype` を実行できます。使い方と現状の制約は [`mock/README.md`](mock/README.md) を参照してください。Draft 0.2 の標準モジュールには対応しますが、Funky ファイル間の `using` と instance 発見だけは未実装です。

## 現在の対応範囲

- 型定義、構造体・列挙型リテラル、フィールドアクセス
- 整数・浮動小数点数・文字列・真偽値・Unit
- if/then/else、do/where、break
- カリー化・部分適用・再帰・遅延評価／メモ化されるトップレベル定数
- VM 標準 native と、Rust から登録する native 関数
- ソース実行、バイトコード保存・読込・逆アセンブル、式単位の REPL

`using` と protocol は現在フロントエンド／型チェッカーの宣言です。`using` によるモジュールのリンク、protocol の動的メソッドディスパッチ、パターンマッチ、クロージャ式はまだ実装していません。プロトコルメソッド本体を実行する用途ではなく、`# nativeName` または通常の関数を使ってください。REPL の各行は独立した式として実行され、行をまたぐ定義の永続化はしません。
