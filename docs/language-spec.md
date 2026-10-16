# Funky 実用仕様案 — Draft 0.2

> **これは実装済み仕様ではなく、Funky を数百行程度のスクリプトにも使えるようにするための提案である。**
> 形式文法は [`grammar.ebnf`](grammar.ebnf)。現行の Rust パーサー／VM がこの文書の全機能を受け付けるわけではない。

この案の基準は、現行 Rust VM で実行できる `examples/sample.funky` と README の記法である。Draft 0.2 の提案例は `examples/draft-0.2/` に分けてある。ブラウザーの Playground には別世代の TypeScript 試作文法が混在しているため、たとえば `loop` や `where` の区切り方はそのまま規範にせず、ここで一貫した形に整理する。Web の説明は「構造的型付け」と呼ぶ一方、現在の Rust 型チェッカー／VM は宣言名でレコード型を区別する。この案では実装済み側に合わせて名目的な互換性を採用し、暗黙の幅サブタイピングを約束しない。

## 1. 変えないもの、足すもの

Funky の芯は、記号を増やすことではなく、少ない記号に役割を背負わせることにある。この案でも次は変えない。

- 型名は `$Point`、プロトコル名は `^Show`、ホスト関数は `# nativeAdd` と、名前の前置記号で役割を見せる。
- 宣言は `is` で本体につなぎ、型と関数の矢印には `>`、型パラメーターの導入には `=>` を使う。
- 関数適用は空白による左結合・カリー化。`add 20 22` は `((add 20) 22)`。
- `+` や `==` などの通常の中置演算子は導入しない。`add 20 22`、`eq x y`、`not ready` のように、演算も名前のある関数として読む。
- `if/then/else`、名前付きレコード、`| ... |` の列挙型、`do { ... } where { ... }` を中心にする。
- 変数への再代入は導入しない。値は不変で、反復はコレクション関数か `for` で表す。

実用性のために提案する追加は、明示的なジェネリック関数、クロージャー `fn`、網羅性検査付き `match`、不変 `List`、`Result` と標準ライブラリー、モジュールリンク、有限コレクション用 `for`、そして副作用を示す `>!` である。構文上の核を残したまま、「書けるが、運用時に困る」部分を補う狙いだ。

### 現行実装との境界

| 項目 | このリポジトリの Rust 版 | Draft 0.2 の提案 |
|---|---|---|
| `if`、カリー化呼び出し、レコード／列挙型、`do/where`、`break` | 対応 | 構文を維持し、`break` を明文化。`where` の評価規則は改善 |
| `where` の束縛区切り | セミコロンなし | セミコロンを任意化し、旧来の隣接記法も許可 |
| `$` 型、`^` プロトコル、`#` native の宣言 | 一部対応 | 文法・制約を整理し、instance を追加 |
| `$Unit` 型 | 型検査の型として対応 | `()` の値リテラルを追加 |
| 型エイリアス宣言 | 構文あり | 透過的 alias として意味を固定 |
| ブロックコメント | 対応 | `//` 行コメントと数値字句規則を追加 |
| 無制約ジェネリック関数 | 未対応 | `$T =>` を追加 |
| `match`、パターン、網羅性検査 | 未対応 | 追加 |
| クロージャー、リスト、`for` | 未対応 | 追加 |
| `using` による実ファイルのリンク | 宣言の解析のみ | 相対パスと標準モジュールを定義 |
| 副作用型と標準 I/O | 未対応 | `>!` と capability 付き `std/io` を提案 |

したがって、以下のコード例は **将来の目標構文** であり、現在の `cargo run` で動くという意味ではない。

## 2. 字句・表記規則

- 識別子は ASCII。値・関数・フィールドは小文字始まり、型・列挙バリアント・プロトコルは大文字始まりとする。名前は大文字小文字を区別する。先頭の `_` は module-private 宣言を表し、単独の `_` はパターン専用で値名にはできない。
- 空白と改行はトークンを分けるだけで、インデントに意味はない。コメントは `// ...` と `/* ... */`。ブロックコメントは入れ子にしない。
- 文字列は不変の UTF-8 文字列で、`'...'` または `"..."` と書く。改行は `\n`、タブは `\t`、Unicode scalar は `\u{...}` で表す。標準の文字数関数は UTF-8 byte 数ではなく Unicode scalar 数を数える。
- 整数は符号付き 64-bit、浮動小数点数は IEEE 754 binary64。`-3` は負の数リテラルであって、`-` という中置演算子ではない。`3` と `3.0` は別の型で、暗黙の数値変換はしない。
- トップレベル宣言と `do` の逐次文は `;` で終える。レコードの型フィールド／初期化子は、現行例と同じく `x = ... y = ...` と並べ、カンマを要求しない。リスト要素には式の境界を明確にするためカンマを使う。
- `where` の各束縛は `;` で区切ってよい。省略する場合、次の `name =` または `name: Type =` が次の束縛の開始となる。読みやすさのため、複数行の `where` ではセミコロンを推奨する。
- レコード／列挙型／プロトコルのメンバーも、原則としてカンマやセミコロンを挟まない。同じ括弧の深さで次のメンバー開始（`field =`、`Variant =`、`method =`）が現れたら、その直前で値／型が終わる。値の中に同じ形が出る複雑な式は括弧で囲む。この小さな lookahead が、空白だけで列挙する Funky らしさを保つ。

## 3. 型と値

### 3.1 基本型

組み込み型は `$Int`、`$Float`、`$Bool`、`$String`、`$Unit`、`$Never`。`$Unit` の値は `()` と書く。空タプル以外のタプル構文は設けず、複数の値は名前付きレコードで表す。

`$Any` のような暗黙の動的型は設けない。動的なデータを扱う入口は、たとえば JSON を `$Json` の列挙型として扱い、`match` で各場合を検査する。

### 3.2 名前付きデータ型

レコードと列挙型の見た目は現行どおり。

```funky
$Point is { x = $Int  y = $Int };
$Option is $T => | Some = $T  None = $Unit |;
$Result is $Ok $Err => | Ok = $Ok  Err = $Err |;
```

型定義は前方参照できる。名前付きレコード／列挙型は**名目的**に区別する。同じフィールド構成でも `$Point` と `$Pixel` を暗黙に交換しない。フィールド名とバリアントの形は定義で検査するが、それだけで型同一性を決めるわけではない。`$Alias is $Point;` のような型エイリアスは透過的で、新しい nominal type は作らない。型注釈やリテラルの型名に alias を使っても、実体は元の型と同じ。

レコードリテラルは `Point { x = 1 y = 2 }` のように型名を付ける。全フィールドをちょうど一度ずつ初期化し、順序は型定義と異なってよい。列挙バリアント名は module 内で一意とし、衝突は型名が異なってもエラーにする。これは `Some(value)` のような短い構築子を保つための、意図的な制約である。

ジェネリック型の定義では `$T $U =>` のように型変数を先に並べ、型の利用側では `$Result<$String $String>` のように `<...>` で渡す。型引数は空白で区切る。関数型を型引数に入れる場合は括弧で囲む（例: `$List<($Int > $String)>`）。

列挙型の各バリアントは payload を一つ持つ。payload が `$Unit` のバリアントは `None` のように括弧なしで構築・照合できる。その他は `Some(value)` の形を使う。`None(())` のように Unit を明示する形も許す。大文字始まりの `Name(...)`／`Name` は列挙構築子として名前解決し、該当バリアントがない場合はエラーにする。関数名は小文字始まりなので、曖昧さを残さない。

`$Option` と `$Result` は標準 prelude の型とし、概念上は上記の定義と同じである。`Some`／`None`／`Ok`／`Err` の構築子も暗黙に利用できる。失敗可能な処理は例外でなく `Result` を返す。

### 3.3 List

`$List<$T>` は標準の不変な有限列で、リテラルは `[a, b, c]`。空リスト `[]` の型を決められない場合は、束縛の型注釈などで補う。

```funky
numbers > $List<$Int> is [1, 2, 3];
```

添字演算子は設けない。`at index values` は 0 始まりで `$Option<$T>` を返し、範囲外を panic にしない。`range start end` は整数の半開区間 `[start, end)`。`map transform values`、`filter predicate values`、`foldLeft step initial values`、`range` などを標準関数として提供し、これらは左から右へ要素を処理する。List の要素と並び順は不変であり、更新系の関数は新しい List を返す。

## 4. 関数、ジェネリクス、適用

関数宣言では引数名・引数型・戻り値型を書く。型注釈の中の関数型を引数に置く場合は括弧で囲む（例: `transform: ($A > $B)`）。宣言の `>` が戻り値の境界を示すためである。

```funky
add x: $Int y: $Int > $Int is # nativeAdd;
factorial n: $Int > $Int is
  if le n 1 then 1 else mul n (factorial (sub n 1));
```

引数は空白で連ね、カリー化される。`add 2` は部分適用された関数。複雑な引数は括弧で囲む。式の優先順位は関数適用だけであり、`add x (mul y 2)` のように構造を括弧で見せる。呼び出しでは callee と引数を左から右へ評価する。List 要素とレコード初期化子もソース順に評価する。`and` と `or` も通常の eager な関数であり、短絡評価が必要なら `if` を使う。

無制約の型変数を関数の宣言で導入できる。

```funky
identity $T => value: $T > $T is value;
map $A $B => transform: ($A > $B) values: $List<$A> > $List<$B> is ...;
```

関数の型変数は呼び出しごとに新しく推論される。型変数は `$` 付きで宣言し、宣言されていない型名はエラーとする。戻り値型と引数型は必須で、関数本体はその型に対して検査する。

クロージャーは `fn` で作る。パラメーターと戻り値型は名前付き関数と同様に明示し、外側の不変な値を捕捉できる。

```funky
using map from "std/list";
incremented > $List<$Int> is map (fn n: $Int > $Int is add n 1) [1, 2, 3];
```

トップレベルで引数がない宣言（`answer > $Int is ...;`）は関数呼び出しではなく、遅延評価され一度だけ memoize される値とする。強制評価中に循環した場合は診断可能な実行時エラーにする。通常の関数値が必要なら `fn` を使う。`fn` は一つ以上の引数を取る。`main` もゼロ引数の値であり、実行ホストは `main > $Unit`（または `>! $Unit`）を終了コード 0、`main > $Int`（または `>! $Int`）の 0〜255 をプロセス終了コードとして扱う。範囲外の整数は実行時エラー。値を標準出力へ暗黙に印字せず、`printLine` を明示する（現行 CLI の「Unit 以外を印字」とは異なる提案）。全トップレベル関数の型は本体検査より先に登録されるため、相互再帰できる。

## 5. 式と制御フロー

### `if`

`if condition then a else b` は式であり、条件は `$Bool`、両方の枝の型は一致しなければならない。`if` にも暗黙の truthy/falsy 変換はない。入れ子の `if` では `else` は最も近い未対応の `if` に結び付く。分岐を明確にしたい場合は括弧を使う。

### `match`

列挙型を安全に分解するため、`match value is { ... }` を追加する。枝は `| pattern => expression;` の形で並べる。

```funky
using IoError ioErrorMessage printLine from "std/io";

reportReadResult result: $Result<$String $IoError> >! $Unit is
  match result is {
    | Ok(text) => printLine text;
    | Err(problem) => printLine (ioErrorMessage problem);
  };
```

パターンには `_`、小文字の束縛名、リテラル、列挙バリアント、名前付きレコードを使える。`Some(x)` は payload を束縛し、`None` は Unit payload のバリアントを照合する。レコードパターンは型名と列挙したフィールドを検査し、残りのフィールドは無視する。枝内の束縛はその枝の中だけで有効。パターンガードと `or` パターンは初版の範囲外とする。

`match` は網羅的でなければならない。閉じた列挙型なら全バリアント、`$Bool` なら `true` と `false`、それ以外の開いた値の型なら `_` または束縛パターンが必要。重複・到達不能な枝は診断する。全ての枝は同じ型を返す。

### `do` / `where` / `break`

`do` は式の順序と局所束縛を一箇所に置く。最後の式がブロックの値で、`where {}` は空でも省略しない。

```funky
do {
  printLine "start";
  answer <- add 20 22;
  answer
} where {
  label: $String = "calculation";
};
```

`<-` は右辺をその場で一度評価し、左の不変な名前を**以降の文**で使えるようにする。右辺は純粋式でも副作用式でもよい。`where` の束縛はブロック全体から相互に参照できる再帰的な束縛群で、純粋な式だけを置く。値は必要時に評価され一度 memoize される。強制評価中の循環は実行時エラー。`where` の並び順は実行順を意味しない。副作用の順番が必要なら `do` の文に書く。なお、現行 Rust コンパイラーは `where` の値をブロック先頭で順に評価する。この案の遅延・memoize 規則は、そのままの仕様記述ではなく、トップレベル定数と整合させるための明示的な変更案である。束縛型はグループ内で単相とし、別の型で再利用したい値は型注釈またはトップレベルのジェネリック関数に分ける。

`break expression;` はループ脱出ではなく、**最内側の `do` 式を値付きで早期終了する**。実行された `break` の値と、通常時の最後の式は同じ型でなければならない。これは既存の Funky の `break` の意味を保つ意図的な癖である。

### `for`

有限の List を左から順に走査するため、式 `for item in values do body` を追加する。`body` は `$Unit` を返し、`for` 式も `$Unit` を返す。値の変換には `map`、副作用を伴う逐次処理には `for` を使う。ループ変数は各反復の間だけ有効で、再代入や `continue` はない。`break` は `for` ではなく最内側 `do` を終了する。

## 6. 副作用 — `>!`

通常の `>` は純粋関数の矢印。副作用のある呼び出しには `>!` を使う。`>` と `!` は別トークンなので、空白を挟んでも同じ意味だが、標準表記は詰めた `>!` とする。

```funky
printLine text: $String >! $Unit is # stdPrintLine;
readText path: $String >! $Result<$String $IoError> is # stdReadText;
```

関数型でも同じ位置に `!` を置く。`$A > $B` は純粋関数、`$A >! $B` は呼び出し時に外界へ作用する関数である。関数型の矢印は右結合。多引数宣言では最後の引数を渡した時点で効果が発生する。たとえば `writeText path content >! $Result<...>` の `writeText path` という部分適用だけでは書き込みを行わない。純粋関数を要求する `map` に効果的なクロージャーは渡せない。

純粋関数から副作用関数を呼ぶことはできない。`!` は効果を隠す印ではなく、呼び出し元にも伝播させる型情報である。`if`／`match`／`for`／`do` の効果は含まれる式から伝播する。`where` 束縛に効果を許さないため、遅延評価が I/O 順序を勝手に変えることもない。

ゼロ引数の効果的なトップレベル値（`main >! $Unit is ...;`）は、選択された entry として一度評価される。`# nativeName` はホストが登録した関数にだけ結び付け、I/O などの効果を持つ native には必ず `>!` を付ける。標準モジュールへのアクセス自体もホスト capability で許可・拒否できる。

整数の加減乗除は checked 64-bit 演算とし、整数除算は 0 方向への切り捨て。オーバーフローとゼロ除算は実行時エラーとし、一般の例外として catch する機能は設けない。I/O など予測可能な失敗は `Result` で扱い、VM の fuel／stack 上限などホスト由来の停止条件とは区別する。

## 7. プロトコルと instance

プロトコルは必要な関数の型を記述する。各メソッドの先頭引数は `$Self` とし、`$Self` はその instance が対象とする型を表す予約された型変数である。instance の実装は名前付きプロトコルに対して静的に結び付け、実行時の動的探索は行わない。

以下の `^Eq` 宣言は prelude のインターフェース形を示すもので、通常のモジュールで再宣言するものではない。prelude はこの protocol と制約付き関数 `eq` を提供する。

```funky
^Eq is { equal = $Self > $Self > $Bool };
eq $T: ^Eq => left: $T right: $T > $Bool is equal left right;
```

```funky
using concat intToString from "std/text";

^Show is { show = $Self > $String };

$Point is { x = $Int  y = $Int };
instance ^Show for $Point is {
  show point is concat (intToString point.x) (concat "," (intToString point.y));
};

showValue $T: ^Show => value: $T > $String is show value;
```

instance 内のメソッドはプロトコルの引数数・型・効果・戻り値型を満たさなければならない。メソッド名は関数として呼び出せるが、制約付きジェネリック関数では型検査器が instance を選び、コンパイラーが辞書を静的に渡す。

同じ `(protocol, target type)` の instance は一つだけ。衝突を避けるため、instance を定義するモジュールは、そのプロトコルか対象型の少なくとも一方を所有しなければならない（orphan rule）。`^A + ^B` は制約の合成であり、対応する両方の instance が必要。現在の制約から同名メソッドを複数解決できる場合は曖昧さとして拒否し、暗黙の優先順位を設けない。

## 8. モジュールと標準ライブラリー

prelude は暗黙に使える。基本型、`Option`／`Result`／`List`、`^Eq` と基本の数値・論理関数は `using` なしで利用できる。`std/io` などの標準モジュールの関数は明示的に import する。

`using name as alias from "path";` はモジュールから名前付き宣言を取り込む。対象は関数・型・プロトコル・列挙構築子で、import 後は unqualified name として使う。パスは import 元のファイルからの相対 `.funky` パスか、`std/io` のような標準モジュール名。`using from "path";` は名前を開かずに依存をリンクする。モジュールの instance は、そのモジュールの型／プロトコル宣言を利用したときに候補となる。モジュールは宣言のみを持ち、ロード時にトップレベルの命令を実行しない。循環 import と同名の未 alias import はエラーにする。先頭が `_` の宣言はそのモジュール内だけで使える。

数百行スクリプトに必要な最小標準ライブラリー案:

| モジュール | 提案する関数（概略型） |
|---|---|
| `std/io` | `$IoError` 型、`arguments >! $List<$String>`、`printLine text: $String >! $Unit`、`readText path: $String >! $Result<$String $IoError>`、`writeText path: $String content: $String >! $Result<$Unit $IoError>`、`ioErrorMessage error: $IoError > $String` |
| `std/text` | `concat left: $String right: $String > $String`、`stringLength text: $String > $Int`、`intToString n: $Int > $String`、`floatToString n: $Float > $String`、`trim text: $String > $String`、`split separator: $String text: $String > $List<$String>`、`join separator: $String parts: $List<$String> > $String` |
| `std/list` | `length $T => values: $List<$T> > $Int`、`map $A $B => transform: ($A > $B) values: $List<$A> > $List<$B>`、`filter $T => predicate: ($T > $Bool) values: $List<$T> > $List<$T>`、`foldLeft $A $B => step: ($B > $A > $B) initial: $B values: $List<$A> > $B`、`at $T => index: $Int values: $List<$T> > $Option<$T>`、`range start: $Int end: $Int > $List<$Int>` |
| `std/json` | `$Json` と `$JsonError`、`parseJson text: $String > $Result<$Json $JsonError>`、`stringify value: $Json > $String`、`jsonField key: $String object: $Json > $Option<$Json>` |

`std/json` の値モデルは、たとえば次の閉じた列挙型で表せる。

```funky
$JsonEntry is { key = $String  value = $Json };
$Json is | Null = $Unit  Boolean = $Bool  Number = $Float  Text = $String
          Array = $List<$Json>  Object = $List<$JsonEntry> |;
```

`arguments`、ファイル操作、標準出力は効果を持つ。I/O の失敗は `$Result` で返し、`$IoError` の表示には `ioErrorMessage` のような標準関数を使う。JSON の object は順序を保つフィールド列として扱い、JSON の各型は `match` で分ける。ファイルシステムや標準出力をどこまで許すかは、実行ホストが capability として決める。

コアの数値・論理関数は名前付きのままにする。整数には `add`、`sub`、`mul`、`div`、`mod_`、大小比較には `lt`、`le`、`gt`、`ge` を用意する。浮動小数点には `addF`、`subF`、`mulF`、`divF`、`ltF` などの明示名を用意し、暗黙の数値 overloading や中置演算子を導入しない。等値比較 `eq` は `^Eq` 制約を持つジェネリック関数とし、基本型と要素型が `^Eq` を満たす `List`／`Option`／`Result` に標準 instance を提供する。

## 9. 最小スクリプト例

以下は提案する `std/io` と `Result` を使う例。

```funky
using readText printLine ioErrorMessage from "std/io";

main >! $Unit is
  do {
    contents <- readText "input.txt";
    match contents is {
      | Ok(text) => printLine text;
      | Err(problem) => printLine (ioErrorMessage problem);
    };
    ()
  } where {};
```

ここで重要なのは構文の量ではなく、I/O の位置（`>!` と `do`）、失敗の形（`Result`）、分岐の完全性（`match`）がコードから読み取れること。純粋な変換は通常の関数として別に書き、ファイルアクセスなどの境界だけを効果的にする。

## 10. 実装時の優先順位

仕様全部を一度に実装する必要はない。スクリプト用途の最小到達点は次の順がよい。

1. この EBNF の字句・文法を実装し、構文エラー位置と重複宣言を検査する。
2. 無制約ジェネリクス、`List`、`Option`／`Result`、クロージャー、網羅性検査付き `match` を型検査・VM まで通す。
3. `using` の相対パス解決、標準 prelude、`std/io` と `std/text` を提供する。
4. `>!` の効果検査、`<-`、`for` を加え、純粋コードから I/O が漏れないことを検査する。
5. プロトコル instance と静的辞書渡しを足す。プロトコルの動的 dispatch は導入しない。

これで、構文の手触りは保ちながら、読み込み・変換・分岐・集約・書き出しを一つのファイル内で組み立てられる。可変状態、例外の常用、巨大な演算子表、暗黙の動的型を持ち込まず、Funky らしい制約を実用性に変える案である。
