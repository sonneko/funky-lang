# Draft 0.2 の例

ここにある `.funky` ファイルは、[`../../docs/language-spec.md`](../../docs/language-spec.md) で提案した Draft 0.2 の記法を示すための例です。クロージャー、`match`、List、モジュールリンク、`>!` などを含むため、現行の Rust パーサー／VM ではまだ実行できません。

- `01-records-and-currying.funky` — 名前付きデータ、ジェネリック型、部分適用
- `02-collections.funky` — `List`、高階関数、`foldLeft`
- `03-file-processing.funky` — `std/io`、`Result`、`match`、`for`
- `04-protocols.funky` — `^Show` の instance、prelude の `^Eq`
- `05-json-config.funky` — JSON、`Option`／`Result` のパターン分岐
- `modules/` — 相対パス import と import alias

現行 VM で実行できる既存例は、親ディレクトリの `sample.funky` に残しています。
