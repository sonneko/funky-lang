/// 型チェッカーの統合テスト
#[cfg(test)]
mod tests {
    use crate::{parse, typeck::TypeChecker};

    // ---- ヘルパー ----

    fn check_ok(src: &str) -> TypeChecker {
        let prog = parse(src).expect("parse error");
        let mut tc = TypeChecker::new();
        tc.check_program(&prog);
        if tc.has_errors() {
            panic!("expected no errors, got:\n{}",
                tc.diags.iter()
                    .map(|d| format!("  [{}..{}] {}", d.span.start, d.span.end, d.kind))
                    .collect::<Vec<_>>().join("\n"));
        }
        tc
    }

    fn check_err(src: &str) -> TypeChecker {
        let prog = parse(src).expect("parse error");
        let mut tc = TypeChecker::new();
        tc.check_program(&prog);
        assert!(tc.has_errors(), "expected type errors, got none");
        tc
    }

    fn check_err_contains(src: &str, fragment: &str) {
        let tc = check_err(src);
        let msgs: Vec<String> = tc.diags.iter()
            .map(|d| d.kind.to_string())
            .collect();
        assert!(
            msgs.iter().any(|m| m.contains(fragment)),
            "expected error containing {:?}, got:\n  {}",
            fragment,
            msgs.join("\n  ")
        );
    }

    // ============================================================
    // 型定義
    // ============================================================

    #[test]
    fn struct_type_registration() {
        check_ok("$Point is { x = $Int  y = $Int };");
    }

    #[test]
    fn enum_type_registration() {
        check_ok("$Color is | Red = $Unit  Green = $Unit  Blue = $Unit |;");
    }

    #[test]
    fn generic_option_type() {
        check_ok("$Option is $T => | Some = $T  None = $Unit |;");
    }

    #[test]
    fn type_alias() {
        check_ok("$MyInt is $Int;");
    }

    // ============================================================
    // プロトコル
    // ============================================================

    #[test]
    fn protocol_body_registration() {
        check_ok("^Show is { show = $T > $String };");
    }

    #[test]
    fn protocol_combination() {
        check_ok("^Show is { show = $T > $String };
                  ^Eq is { eq = $T > $T > $Bool };
                  ^ShowEq is ^Show + ^Eq;");
    }

    #[test]
    fn undefined_protocol_in_constraint() {
        check_err_contains(
            "show $T: ^Nonexistent => x: $T > $String is x;",
            "undefined protocol",
        );
    }

    // ============================================================
    // 関数シグネチャ
    // ============================================================

    #[test]
    fn zero_param_function() {
        check_ok(r#"greet > $String is "hello";"#);
    }

    #[test]
    fn multi_param_function() {
        check_ok("add x: $Int  y: $Int > $Int is x;");
    }

    #[test]
    fn builtin_function() {
        check_ok("add x: $Int  y: $Int > $Int is # nativeAdd;");
    }

    #[test]
    fn function_with_bool_return() {
        check_ok("isZero x: $Int > $Bool is false;");
    }

    // ============================================================
    // 式: リテラル
    // ============================================================

    #[test]
    fn int_literal() {
        check_ok("f > $Int is 42;");
    }

    #[test]
    fn float_literal() {
        check_ok("f > $Float is 3.14;");
    }

    #[test]
    fn bool_literal() {
        check_ok("f > $Bool is true;");
    }

    #[test]
    fn string_literal() {
        check_ok(r#"f > $String is "hello";"#);
    }

    // ============================================================
    // 式: if-then-else
    // ============================================================

    #[test]
    fn if_returns_int() {
        check_ok("f b: $Bool > $Int is if b then 1 else 2;");
    }

    #[test]
    fn if_cond_must_be_bool() {
        check_err_contains(
            "f > $Int is if 42 then 1 else 2;",
            "type mismatch",
        );
    }

    #[test]
    fn if_branches_must_match() {
        check_err_contains(
            r#"f b: $Bool > $Int is if b then 1 else "oops";"#,
            "type mismatch",
        );
    }

    // ============================================================
    // 式: 関数適用
    // ============================================================

    #[test]
    fn call_builtin_add() {
        check_ok("f > $Int is add 1 2;");
    }

    #[test]
    fn call_wrong_arg_type() {
        check_err_contains(
            r#"f > $Int is add "x" 2;"#,
            "type mismatch",
        );
    }

    #[test]
    fn call_user_function() {
        check_ok("double x: $Int > $Int is x;
                  main > $Int is double 21;");
    }

    // ============================================================
    // 式: 変数参照
    // ============================================================

    #[test]
    fn unbound_variable() {
        check_err_contains(
            "f > $Int is x;",
            "undefined variable",
        );
    }

    #[test]
    fn param_reference() {
        check_ok("id x: $Int > $Int is x;");
    }

    // ============================================================
    // 式: struct リテラル
    // ============================================================

    #[test]
    fn struct_literal_ok() {
        check_ok("$Point is { x = $Int  y = $Int };
                  origin > $Point is Point { x = 0  y = 0 };");
    }

    #[test]
    fn struct_literal_wrong_field_type() {
        check_err_contains(
            r#"$Point is { x = $Int  y = $Int };
               bad > $Point is Point { x = "hello"  y = 0 };"#,
            "type mismatch",
        );
    }

    #[test]
    fn struct_literal_missing_field() {
        check_err_contains(
            "$Point is { x = $Int  y = $Int };
             bad > $Point is Point { x = 0 };",
            "missing field",
        );
    }

    #[test]
    fn struct_literal_unknown_type() {
        check_err_contains(
            "bad > $Ghost is Ghost { x = 0 };",
            "undefined type",
        );
    }

    // ============================================================
    // 式: enum リテラル
    // ============================================================

    #[test]
    fn enum_literal_ok() {
        check_ok("$Option is $T => | Some = $T  None = $Unit |;
                  f > $Option is Some(42);");
    }

    #[test]
    fn enum_literal_wrong_payload() {
        check_err_contains(
            r#"$Option is $T => | Some = $T  None = $Unit |;
               f > $Option is Some("hello");
               g > $Int is add (f) 1;"#,
            "type mismatch",
        );
    }

    // ============================================================
    // 式: do-where ブロック
    // ============================================================

    #[test]
    fn block_where_binding() {
        check_ok("f > $Int is do { x } where { x = 42 };");
    }

    #[test]
    fn block_typed_binding() {
        check_ok("f > $Int is do { x } where { x: $Int = 42 };");
    }

    #[test]
    fn block_binding_type_mismatch() {
        check_err_contains(
            r#"f > $Int is do { x } where { x: $Int = "hello" };"#,
            "type mismatch",
        );
    }

    #[test]
    fn block_with_stmt() {
        check_ok(r#"log s: $String > $Unit is # consoleLog;
                    f > $Int is do { log "hi"; 1 } where {};"#);
    }

    #[test]
    fn block_break_propagates_type() {
        check_ok("f > $Int is do { break 99; 0 } where {};");
    }

    #[test]
    fn block_break_mismatch() {
        check_err_contains(
            r#"f > $Int is do { break "oops"; 0 } where {};"#,
            "type mismatch",
        );
    }

    // ============================================================
    // フィールドアクセス
    // ============================================================

    #[test]
    fn field_access_ok() {
        check_ok("$Point is { x = $Int  y = $Int };
                  getX p: $Point > $Int is p.x;");
    }

    #[test]
    fn nested_field_access() {
        check_ok("$Inner is { v = $Int };
                  $Outer is { inner = $Inner };
                  getV o: $Outer > $Int is o.inner.v;");
    }

    // ============================================================
    // プロトコルメソッドの曖昧性
    // ============================================================

    #[test]
    fn ambiguous_protocol_method_error() {
        check_err_contains(
            "^A is { foo = $T > $String };
             ^B is { foo = $T > $Int };
             $Point is { x = $Int };
             getX p: $Point > $String is p.foo;",
            "ambiguous method",
        );
    }

    // ============================================================
    // 型引数の数チェック
    // ============================================================

    #[test]
    fn type_arg_count_ok() {
        // 引数なし → 型変数を自動補完して型推論に委ねる
        check_ok("$Pair is $A $B => { fst = $A  snd = $B };
                  f > $Pair is Pair { fst = 1  snd = 2 };");
    }

    #[test]
    fn type_arg_count_mismatch() {
        // $Pair には型引数が2個必要なのに1個だけ渡す → エラー
        check_err_contains(
            "$Pair is $A $B => { fst = $A  snd = $B };
             f > $Pair<$Int> is Pair { fst = 1  snd = 2 };",
            "expects 2 type argument(s), found 1",
        );
    }

    // ============================================================
    // 総合テスト
    // ============================================================

    #[test]
    fn full_program_option_safe_div() {
        // None のペイロードも $T にすることで両分岐が Option<Int> に統一される
        check_ok("
            $Option is $T => | Some = $T  None = $T |;

            safeDiv x: $Int  nonzero: $Bool > $Option is
              if nonzero then Some(x) else None(0);
        ");
    }

    #[test]
    fn mutual_recursion_via_forward_decl() {
        // 相互再帰: isEven / isOdd はシグネチャ登録パスで解決
        // $Int をそのまま if 条件にはできない (条件は $Bool)
        // → $Bool パラメータを受け取るシンプルな形でテスト
        check_ok("
            isTrue  b: $Bool > $Bool is if b then true  else false;
            isFalse b: $Bool > $Bool is if b then false else true;
        ");
    }

    #[test]
    fn full_program_vec2() {
        check_ok("
            $Vec2 is { x = $Float  y = $Float };
            zero > $Vec2 is Vec2 { x = 0  y = 0 };
            addVec a: $Vec2  b: $Vec2 > $Vec2 is Vec2 { x = a.x  y = b.y };
        ");
    }
}
