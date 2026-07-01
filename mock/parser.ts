// ============================================================
// Lexer
// ============================================================

export type TokenKind =
  | "IDENT"
  | "STRING"
  | "NUMBER"
  | "BOOL"
  | "USING" | "AS" | "FROM" | "SEMICOLON"
  | "IS" | "DO" | "WHERE" | "IF" | "THEN" | "ELSE" | "BREAK"
  | "DOLLAR" | "CARET" | "HASH"
  | "ARROW" | "GT" | "LT" | "PLUS" | "EQ"
  | "LPAREN" | "RPAREN"
  | "LBRACE" | "RBRACE"
  | "COLON" | "DOT" | "PIPE" | "COMMA"
  | "EOF";

export interface Token {
  kind: TokenKind;
  value: string;
  pos: number;
}

const KEYWORDS: Record<string, TokenKind> = {
  using: "USING", as: "AS", from: "FROM",
  is: "IS", do: "DO", where: "WHERE",
  if: "IF", then: "THEN", else: "ELSE", break: "BREAK",
  true: "BOOL", false: "BOOL",
};

export class LexError extends Error {
  constructor(message: string, public pos: number) { super(message); }
}

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < src.length) {
    // Skip whitespace
    if (/\s/.test(src[i])) { i++; continue; }

    // Block comments /* */
    if (src[i] === "/" && src[i + 1] === "*") {
      const start = i;
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      if (i >= src.length) throw new LexError("Unterminated block comment", start);
      i += 2;
      continue;
    }

    const pos = i;
    const ch = src[i];

    // Single-char tokens
    const single: Record<string, TokenKind> = {
      ";": "SEMICOLON", ">": "GT", "<": "LT", "+": "PLUS",
      "(": "LPAREN", ")": "RPAREN", "{": "LBRACE", "}": "RBRACE",
      ":": "COLON", ".": "DOT", "|": "PIPE", ",": "COMMA",
      "$": "DOLLAR", "^": "CARET", "#": "HASH",
    };

    if (ch in single) { tokens.push({ kind: single[ch], value: ch, pos }); i++; continue; }

    // "=>" arrow or "="
    if (ch === "=") {
      if (src[i + 1] === ">") { tokens.push({ kind: "ARROW", value: "=>", pos }); i += 2; }
      else { tokens.push({ kind: "EQ", value: "=", pos }); i++; }
      continue;
    }

    // String literal
    if (ch === '"' || ch === "'") {
      const quote = ch; i++;
      let str = "";
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\") { i++; str += src[i] ?? ""; }
        else { str += src[i]; }
        i++;
      }
      if (i >= src.length) throw new LexError("Unterminated string literal", pos);
      i++;
      tokens.push({ kind: "STRING", value: str, pos });
      continue;
    }

    // Number literal
    if (/[0-9]/.test(ch) || (ch === "-" && /[0-9]/.test(src[i + 1] ?? ""))) {
      let num = ch; i++;
      while (i < src.length && /[0-9._]/.test(src[i])) { num += src[i]; i++; }
      tokens.push({ kind: "NUMBER", value: num, pos });
      continue;
    }

    // Identifier or keyword
    if (/[a-zA-Z_]/.test(ch)) {
      let id = ch; i++;
      while (i < src.length && /[a-zA-Z0-9_]/.test(src[i])) { id += src[i]; i++; }
      const kind = KEYWORDS[id] ?? "IDENT";
      tokens.push({ kind, value: id, pos });
      continue;
    }

    throw new LexError(`Unexpected character '${ch}'`, pos);
  }

  tokens.push({ kind: "EOF", value: "", pos: i });
  return tokens;
}

// ============================================================
// AST Node Types
// ============================================================

export type Literal =
  | { kind: "StringLiteral"; value: string }
  | { kind: "NumberLiteral"; value: string }
  | { kind: "BoolLiteral"; value: boolean };

// --- Type Literals ---
export type TypeLiteral =
  | StructTypeBody
  | EnumTypeBody
  | FnTypeBody
  | NamedType;

export interface StructTypeBody {
  kind: "StructTypeBody";
  typeParams: string[];
  fields: { name: string; type: TypeLiteral }[];
}

export interface EnumTypeBody {
  kind: "EnumTypeBody";
  typeParams: string[];
  variants: { name: string; type: TypeLiteral }[];
}

export interface FnTypeBody {
  kind: "FnTypeBody";
  protocols: { name: string; protocol: ProtocolLiteral }[];
  paramType: TypeLiteral;
  returnType: TypeLiteral | FnTypeBody;
}

export interface NamedType {
  kind: "NamedType";
  name: string;
  args: TypeLiteral[];
}

// --- Protocol ---
export interface ProtocolDefinitionBody {
  kind: "ProtocolDefinitionBody";
  methods: { name: string; type: FnTypeBody }[];
}

export interface ProtocolLiteral {
  kind: "ProtocolLiteral";
  names: string[];
}

export type ProtocolDefinitionBodyOrLiteral = ProtocolDefinitionBody | ProtocolLiteral;

// --- Expressions ---
export type Expression =
  | IfExpression
  | CallExpression
  | BlockExpression
  | PrimaryExpression
  | ParenExpression;

export interface IfExpression {
  kind: "IfExpression";
  condition: Expression;
  then: Expression;
  else: Expression;
}

export interface CallExpression {
  kind: "CallExpression";
  callee: Expression;
  arg: PrimaryExpression;
}

export interface BlockExpression {
  kind: "BlockExpression";
  stmts: ({ kind: "Stmt"; expr: Expression } | { kind: "Break"; expr: Expression })[];
  final: Expression;
  bindings: { name: string; type: TypeLiteral | null; value: Expression }[];
}

export type PrimaryExpression =
  | Literal
  | StructLiteral
  | PeriodAccess;

export interface StructLiteral {
  kind: "StructLiteral";
  name: string;
  fields: { name: string; value: Expression }[];
}

export interface PeriodAccess {
  kind: "PeriodAccess";
  parts: string[];
}

export interface ParenExpression {
  kind: "ParenExpression";
  expr: Expression;
}

// --- Top Level ---
export interface UsingDecl {
  kind: "UsingDecl";
  imports: { name: string; alias: string | null }[];
  from: string;
}

export interface FunctionDecl {
  kind: "FunctionDecl";
  name: string;
  protocols: { name: string; body: ProtocolDefinitionBody }[];
  params: { name: string; type: TypeLiteral }[];
  returnType: TypeLiteral;
  body: Expression | { kind: "Builtin"; name: string };
}

export interface TypeDefinition {
  kind: "TypeDefinition";
  name: string;
  type: TypeLiteral;
}

export interface ProtocolDefinition {
  kind: "ProtocolDefinition";
  name: string;
  body: ProtocolDefinitionBodyOrLiteral;
}

export type TopLevel = UsingDecl | FunctionDecl | TypeDefinition | ProtocolDefinition;

export interface Program {
  kind: "Program";
  body: TopLevel[];
}

// ============================================================
// Parser
// ============================================================

export class ParseError extends Error {
  constructor(message: string, public pos: number) { super(message); }
}

export class Parser {
  private pos = 0;

  constructor(private tokens: Token[]) { }

  // ---- Helpers ----

  private peek(): Token { return this.tokens[this.pos]; }

  private advance(): Token { return this.tokens[this.pos++]; }

  private at(kind: TokenKind): boolean { return this.peek().kind === kind; }

  private atValue(kind: TokenKind, value: string): boolean {
    const t = this.peek();
    return t.kind === kind && t.value === value;
  }

  private expect(kind: TokenKind): Token {
    const t = this.peek();
    if (t.kind !== kind) {
      throw new ParseError(
        `Expected ${kind} but got ${t.kind} ('${t.value}')`,
        t.pos
      );
    }
    return this.advance();
  }

  private tryConsume(kind: TokenKind): Token | null {
    if (this.at(kind)) return this.advance();
    return null;
  }

  // ---- Program ----

  parseProgram(): Program {
    const body: TopLevel[] = [];
    while (!this.at("EOF")) {
      body.push(this.parseTopLevel());
    }
    return { kind: "Program", body };
  }

  private parseTopLevel(): TopLevel {
    const t = this.peek();

    if (t.kind === "USING") return this.parseUsing();
    if (t.kind === "DOLLAR") return this.parseTypeDefinition();
    if (t.kind === "CARET") return this.parseProtocolDefinition();
    if (t.kind === "IDENT") return this.parseFunctionDecl();

    throw new ParseError(`Unexpected token at top level: ${t.kind} ('${t.value}')`, t.pos);
  }

  // ---- Using ----
  // <using> ::= "using" ( <identifier> ( "as" <identifier> )? )* "from" <literal> ";"

  private parseUsing(): UsingDecl {
    this.expect("USING");
    const imports: { name: string; alias: string | null }[] = [];

    while (!this.at("FROM") && !this.at("EOF")) {
      const name = this.expect("IDENT").value;
      let alias: string | null = null;
      if (this.at("AS")) { this.advance(); alias = this.expect("IDENT").value; }
      imports.push({ name, alias });
    }

    this.expect("FROM"); // "from"
    const source = this.parseLiteralNode();
    if (source.kind !== "StringLiteral") {
      throw new ParseError("Expected string literal after 'from'", this.peek().pos);
    }
    this.expect("SEMICOLON");
    return { kind: "UsingDecl", imports, from: source.value };
  }

  // ---- Type Definition ----
  // <type_definition> ::= "$" <identifier> "is" <type_literal> ";"

  private parseTypeDefinition(): TypeDefinition {
    this.expect("DOLLAR");
    const name = this.expect("IDENT").value;
    this.expect("IS");
    const type = this.parseTypeLiteral();
    this.expect("SEMICOLON");
    return { kind: "TypeDefinition", name, type };
  }

  // ---- Protocol Definition ----
  // <protocol_definition> ::= "^" <identifier> "is" <protocol_definition_body> ";"

  private parseProtocolDefinition(): ProtocolDefinition {
    this.expect("CARET");
    const name = this.expect("IDENT").value;
    this.expect("IS");
    const body = this.parseProtocolDefinitionBody();
    this.expect("SEMICOLON");
    return { kind: "ProtocolDefinition", name, body };
  }

  // <protocol_definition_body> ::= "{" ( <identifier> "=" <fn_type_body> )* "}" | <protocol_literal>

  private parseProtocolDefinitionBody(): ProtocolDefinitionBodyOrLiteral {
    if (this.at("LBRACE")) {
      this.advance();
      const methods: { name: string; type: FnTypeBody }[] = [];
      while (!this.at("RBRACE") && !this.at("EOF")) {
        const name = this.expect("IDENT").value;
        this.expect("EQ");
        const type = this.parseFnTypeBody();
        methods.push({ name, type });
      }
      this.expect("RBRACE");
      return { kind: "ProtocolDefinitionBody", methods };
    }
    return this.parseProtocolLiteral();
  }

  // <protocol_literal> ::= "^" <identifier> ( "+" "^" <identifier> )*

  private parseProtocolLiteral(): ProtocolLiteral {
    this.expect("CARET");
    const names: string[] = [this.expect("IDENT").value];
    while (this.at("PLUS")) {
      this.advance();
      this.expect("CARET");
      names.push(this.expect("IDENT").value);
    }
    return { kind: "ProtocolLiteral", names };
  }

  // ---- Function Declaration ----
  // <function> ::= <identifier> <protocol_def_list>? <param_def_list> "is" ( <expression> | "#" <identifier> ) ";"
  // <protocol_def_list> ::= ( "$" <identifier> ":" <protocol_definition_body> )* "=>"
  // <param_def_list> ::= <param_def>* ">" <type_literal>
  // <param_def> ::= <identifier> ":" <type_literal>

  private parseFunctionDecl(): FunctionDecl {
    const name = this.expect("IDENT").value;

    // Protocol def list: ($Ident: body)* =>
    const protocols: { name: string; body: ProtocolDefinitionBody }[] = [];
    // Look ahead: is there a protocol def list?
    if (this.isProtocolDefListStart()) {
      while (this.at("DOLLAR") && this.tokens[this.pos + 1]?.kind === "IDENT"
        && this.tokens[this.pos + 2]?.kind === "COLON") {
        this.advance(); // $
        const pName = this.expect("IDENT").value;
        this.expect("COLON");
        const rawBody = this.parseProtocolDefinitionBody();
        let body: ProtocolDefinitionBody;
        if (rawBody.kind === "ProtocolDefinitionBody") {
          body = rawBody;
        } else {
          body = { kind: "ProtocolDefinitionBody", methods: [] };
          (body as any).literal = rawBody;
        }
        protocols.push({ name: pName, body });
        // After each constraint, check if we're done (=> comes next)
        if (this.at("ARROW")) break;
      }
      this.expect("ARROW");
    }

    // Param def list: (ident ":" type)* ">" type
    const params: { name: string; type: TypeLiteral }[] = [];
    while (this.at("IDENT") && this.tokens[this.pos + 1]?.kind === "COLON") {
      const pName = this.advance().value;
      this.expect("COLON");
      const pType = this.parseTypeLiteral(true); // insideFnParam: don't eat > as fn arrow
      params.push({ name: pName, type: pType });
    }
    this.expect("GT");
    const returnType = this.parseTypeLiteral();

    this.expect("IS");

    let body: Expression | { kind: "Builtin"; name: string };
    if (this.at("HASH")) {
      this.advance();
      body = { kind: "Builtin", name: this.expect("STRING").value };
    } else {
      body = this.parseExpression();
    }

    this.expect("SEMICOLON");
    return { kind: "FunctionDecl", name, protocols, params, returnType, body };
  }

  // Protocol def list starts if we see ($ident:^) or ($ident:{)
  private isProtocolDefListStart(): boolean {
    if (!this.at("DOLLAR")) return false;
    let i = this.pos;
    // Scan all $ident: body entries, then check for =>
    while (this.tokens[i]?.kind === "DOLLAR" && this.tokens[i + 1]?.kind === "IDENT"
      && this.tokens[i + 2]?.kind === "COLON") {
      // Must be followed by a protocol literal (^) or body ({)
      const after = this.tokens[i + 3]?.kind;
      if (after !== "CARET" && after !== "LBRACE") return false;
      // Skip past this constraint by finding end of body
      // Simple heuristic: just confirm the first one looks valid
      return true;
    }
    return false;
  }

  // Force protocol definition body to be ProtocolDefinitionBody (not literal)
  private parseProtocolDefinitionBodyAsBody(): ProtocolDefinitionBody {
    const result = this.parseProtocolDefinitionBody();
    if (result.kind !== "ProtocolDefinitionBody") {
      throw new ParseError("Expected protocol definition body (not literal)", this.peek().pos);
    }
    return result;
  }

  // ---- Type Literals ----
  // <type_literal> ::= <struct_type_body> | <enum_type_body> | <fn_type_body> | "$" <identifier> ( "<" <type_literal>* ">" )?
  // insideFnParam: when true, don't try to extend named type with ">" (fn arrow)

  private parseTypeLiteral(insideFnParam = false): TypeLiteral {
    const t = this.peek();

    // Check struct/enum with type params first (they start with $ident too)
    if (this.isStructTypeBodyStart()) return this.parseStructTypeBody();
    if (this.isEnumTypeBodyStart()) return this.parseEnumTypeBody();

    if (t.kind === "DOLLAR") {
      this.advance();
      const name = this.expect("IDENT").value;
      const args: TypeLiteral[] = [];
      if (this.at("LT")) {
        this.advance();
        while (!this.at("GT") && !this.at("EOF")) {
          args.push(this.parseTypeLiteral(true)); // inside <> never extend with >
        }
        this.expect("GT");
      }
      const namedT: NamedType = { kind: "NamedType", name, args };
      if (!insideFnParam && this.at("GT")) {
        this.advance();
        const returnType = this.isFnTypeContinuation()
          ? this.parseFnTypeBody()
          : this.parseTypeLiteral();
        return { kind: "FnTypeBody", protocols: [], paramType: namedT, returnType };
      }
      return namedT;
    }

    if (this.isFnTypeProtocolStart()) return this.parseFnTypeBody();

    throw new ParseError(`Expected type literal, got ${t.kind} ('${t.value}')`, t.pos);
  }

  // Struct starts when we see "{" directly, or "$" ident ... "=>" "{"
  private isStructTypeBodyStart(): boolean {
    if (this.at("LBRACE")) return true;
    // Scan: ($ident)+ => {
    let i = this.pos;
    let count = 0;
    while (this.tokens[i]?.kind === "DOLLAR" && this.tokens[i + 1]?.kind === "IDENT"
      // Make sure it's not a protocol constraint ($ident: ^...)
      && this.tokens[i + 2]?.kind !== "COLON") {
      i += 2; count++;
    }
    return count > 0 && this.tokens[i]?.kind === "ARROW" && this.tokens[i + 1]?.kind === "LBRACE";
  }

  private isEnumTypeBodyStart(): boolean {
    if (this.at("PIPE")) return true;
    // Scan: ($ident)+ => |
    let i = this.pos;
    let count = 0;
    while (this.tokens[i]?.kind === "DOLLAR" && this.tokens[i + 1]?.kind === "IDENT"
      && this.tokens[i + 2]?.kind !== "COLON") {
      i += 2; count++;
    }
    return count > 0 && this.tokens[i]?.kind === "ARROW" && this.tokens[i + 1]?.kind === "PIPE";
  }

  // <struct_type_body> ::= (( "$" <identifier> )* "=>" )? "{" (<identifier> "=" <type_literal>)* "}"

  private parseStructTypeBody(): StructTypeBody {
    const typeParams = this.parseOptionalTypeParams();
    this.expect("LBRACE");
    const fields: { name: string; type: TypeLiteral }[] = [];
    while (!this.at("RBRACE") && !this.at("EOF")) {
      const name = this.expect("IDENT").value;
      this.expect("EQ");
      const type = this.parseTypeLiteral();
      fields.push({ name, type });
    }
    this.expect("RBRACE");
    return { kind: "StructTypeBody", typeParams, fields };
  }

  // <enum_type_body> ::= (( "$" <identifier> )* "=>" )? "|" ( <identifier> "=" <type_literal> )* "|"

  private parseEnumTypeBody(): EnumTypeBody {
    const typeParams = this.parseOptionalTypeParams();
    this.expect("PIPE");
    const variants: { name: string; type: TypeLiteral }[] = [];
    while (!this.at("PIPE") && !this.at("EOF")) {
      const name = this.expect("IDENT").value;
      this.expect("EQ");
      const type = this.parseTypeLiteral();
      variants.push({ name, type });
      if (!this.at("PIPE")) {
        this.expect("COMMA");
      } else {
        this.tryConsume("COMMA");
      }
    }
    this.expect("PIPE");
    return { kind: "EnumTypeBody", typeParams, variants };
  }

  // Parse optional ( "$" ident )* "=>"
  private parseOptionalTypeParams(): string[] {
    // Check if there's a type param list: one or more "$" ident followed by "=>"
    // We need lookahead to decide
    const saved = this.pos;
    const params: string[] = [];
    while (this.at("DOLLAR")) {
      this.advance();
      if (!this.at("IDENT")) { this.pos = saved; return []; }
      params.push(this.advance().value);
    }
    if (params.length > 0 && this.at("ARROW")) {
      this.advance(); // consume =>
      return params;
    }
    // Wasn't a type param list; roll back
    this.pos = saved;
    return [];
  }

  // <fn_type_body> ::= ( ( "$" <identifier> ":" <protocol_literal> )* "=>" )? <type_literal> ">" ( <fn_type_body> | <type_literal> )

  private parseFnTypeBody(): FnTypeBody {
    // Optional protocol constraints: ($ident: ^proto)* =>
    const protocols: { name: string; protocol: ProtocolLiteral }[] = [];
    if (this.isFnTypeProtocolStart()) {
      while (this.at("DOLLAR") && this.tokens[this.pos + 1]?.kind === "IDENT"
        && this.tokens[this.pos + 2]?.kind === "COLON") {
        this.advance(); // $
        const name = this.expect("IDENT").value;
        this.expect("COLON");
        const protocol = this.parseProtocolLiteral();
        protocols.push({ name, protocol });
      }
      this.expect("ARROW");
    }

    // paramType must start with $ (named type) — fn types take named types as params
    const paramType = this.parseNamedTypeOnly();
    this.expect("GT");

    // Return type is either another fn_type_body or a type_literal
    const returnType = this.isFnTypeContinuation()
      ? this.parseFnTypeBody()
      : this.parseTypeLiteral();

    return { kind: "FnTypeBody", protocols, paramType, returnType };
  }

  // Parse only a named type ($Ident<...>?) without fn-type extension
  private parseNamedTypeOnly(): TypeLiteral {
    return this.parseTypeLiteral(true); // insideFnParam prevents eating >
  }

  // Detect: ($ident: ^...)* =>
  private isFnTypeProtocolStart(): boolean {
    if (!this.at("DOLLAR")) return false;
    const t1 = this.tokens[this.pos + 1];
    const t2 = this.tokens[this.pos + 2];
    return t1?.kind === "IDENT" && t2?.kind === "COLON" &&
      this.tokens[this.pos + 3]?.kind === "CARET";
  }

  // After parsing a type literal, is there a ">" indicating a fn type?
  private isFnTypeContinuation(): boolean {
    // Look for a fn type body: starts with ($ident: ^ ...) => or $ident or { or | or ...
    // Simply: the return type itself could be a fn type if the next token starts one.
    // For now, check if we see another fn_type_body opener (protocol constraints)
    // This is called after ">" so we check if the next content looks like a fn type body
    return this.isFnTypeProtocolStart();
  }

  // ---- Expressions ----
  // Call expressions are left-recursive: expr primary_expr
  // We parse a base expression then try to extend with call

  parseExpression(): Expression {
    return this.parseCallExpression();
  }

  private parseCallExpression(): Expression {
    let expr = this.parseBaseExpression();

    // Call expression: left-associative application
    while (this.isPrimaryExpressionStart()) {
      const arg = this.parsePrimaryExpression();
      expr = { kind: "CallExpression", callee: expr, arg } satisfies CallExpression;
    }

    return expr;
  }

  private isPrimaryExpressionStart(): boolean {
    const t = this.peek();
    return (
      t.kind === "STRING" ||
      t.kind === "NUMBER" ||
      t.kind === "BOOL" ||
      t.kind === "IDENT" ||
      t.kind === "LPAREN"
    );
  }

  private parseBaseExpression(): Expression {
    const t = this.peek();

    // if-then-else
    if (t.kind === "IF") return this.parseIfExpression();

    // block do { ... } where { ... }
    if (t.kind === "DO") return this.parseBlockExpression();

    return this.parsePrimaryExpression();
  }

  private parseIfExpression(): IfExpression {
    this.expect("IF");
    const condition = this.parseExpression();
    this.expect("THEN");
    const then = this.parseExpression();
    this.expect("ELSE");
    const els = this.parseExpression();
    return { kind: "IfExpression", condition, then, else: els };
  }

  // <block_expression> ::= "do" "{" ( <expression> ";" | "break" <expression> )* <expression> "}" "where" "{" ( <identifier> ( ":" <type_literal> ) "=" <expression> )* "}"

  private parseBlockExpression(): BlockExpression {
    this.expect("DO");
    this.expect("LBRACE");

    const stmts: BlockExpression["stmts"] = [];
    let final!: Expression;

    // We must parse statements until we find the final expression (no trailing ";")
    // Strategy: parse an expression; if ";" follows, it's a stmt; if "}" follows, it's final.
    while (!this.at("RBRACE") && !this.at("EOF")) {
      if (this.at("BREAK")) {
        this.advance();
        const expr = this.parseExpression();
        stmts.push({ kind: "Break", expr });
        this.expect("SEMICOLON");
      } else {
        const expr = this.parseExpression();
        if (this.at("SEMICOLON")) {
          this.advance();
          stmts.push({ kind: "Stmt", expr });
        } else {
          // final expression
          final = expr;
          break;
        }
      }
    }

    if (!final) throw new ParseError("Block must have a final expression", this.peek().pos);
    this.expect("RBRACE");
    this.expect("WHERE");
    this.expect("LBRACE");

    const bindings: BlockExpression["bindings"] = [];
    while (!this.at("RBRACE") && !this.at("EOF")) {
      const name = this.expect("IDENT").value;
      let type: TypeLiteral | null = null;
      if (this.at("COLON")) {
        this.advance();
        type = this.parseTypeLiteral();
      }
      this.expect("EQ");
      const value = this.parseExpression();
      this.expect("SEMICOLON");
      bindings.push({ name, type, value });
    }

    this.expect("RBRACE");
    return { kind: "BlockExpression", stmts, final, bindings };
  }

  private parseParenExpression(): ParenExpression {
    this.expect("LPAREN");
    const expr = this.parseExpression();
    this.expect("RPAREN");
    return { kind: "ParenExpression", expr };
  }

  // <primary_expression> ::= <literal> | <struct_literal> | <enum_literal> | <period_access>

  private parsePrimaryExpression(): PrimaryExpression {
    const t = this.peek();

    if (t.kind === "STRING" || t.kind === "NUMBER" || t.kind === "BOOL") {
      return this.parseLiteralNode();
    }

    if (t.kind === "LPAREN") {
      return { ...this.parseParenExpression(), parts: [] } as any;
    }

    if (t.kind === "IDENT") {
      // Look ahead: struct literal = ident "{"
      if (this.tokens[this.pos + 1]?.kind === "LBRACE") {
        return this.parseStructLiteral();
      }
      // Period access or plain identifier
      return this.parsePeriodAccess();
    }

    throw new ParseError(`Expected primary expression, got ${t.kind} ('${t.value}')`, t.pos);
  }

  private parseLiteralNode(): Literal {
    const t = this.peek();
    if (t.kind === "STRING") { this.advance(); return { kind: "StringLiteral", value: t.value }; }
    if (t.kind === "NUMBER") { this.advance(); return { kind: "NumberLiteral", value: t.value }; }
    if (t.kind === "BOOL") { this.advance(); return { kind: "BoolLiteral", value: t.value === "true" }; }
    throw new ParseError(`Expected literal, got ${t.kind}`, t.pos);
  }

  // <struct_literal> ::= <identifier> "{" ( <identifier> "=" <expression> )* "}"

  private parseStructLiteral(): StructLiteral {
    const name = this.expect("IDENT").value;
    this.expect("LBRACE");
    const fields: { name: string; value: Expression }[] = [];
    while (!this.at("RBRACE") && !this.at("EOF")) {
      const fname = this.expect("IDENT").value;
      this.expect("EQ");
      const fval = this.parseExpression();
      fields.push({ name: fname, value: fval });
      if (!this.at("RBRACE")) {
        this.expect("COMMA");
      } else {
        this.tryConsume("COMMA");
      }
    }
    this.expect("RBRACE");
    return { kind: "StructLiteral", name, fields };
  }

  // <period_access> ::= <identifier> ( "." <identifier> )*

  private parsePeriodAccess(): PeriodAccess {
    const parts: string[] = [this.expect("IDENT").value];
    while (this.at("DOT")) {
      this.advance();
      parts.push(this.expect("IDENT").value);
    }
    return { kind: "PeriodAccess", parts };
  }
}

// ============================================================
// Public API
// ============================================================

export function parse(src: string): Program {
  const tokens = tokenize(src);
  const parser = new Parser(tokens);
  return parser.parseProgram();
}
