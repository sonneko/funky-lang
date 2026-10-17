{
  function decodeString(raw) {
    let out = "";
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw[i];
      if (c !== "\\") { out += c; continue; }
      const e = raw[++i];
      if (e === "u" && raw[i + 1] === "{") {
        const end = raw.indexOf("}", i + 2);
        const cp = Number.parseInt(raw.slice(i + 2, end), 16);
        if (!Number.isFinite(cp) || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) throw new Error("invalid Unicode scalar escape");
        out += String.fromCodePoint(cp);
        i = end;
      } else {
        out += ({ n: "\n", r: "\r", t: "\t", "\\": "\\", "'": "'", '"': '"' })[e];
      }
    }
    return out;
  }
  function foldCall(head, args) { return args.reduce((callee, arg) => ({ kind: "call", callee, arg }), head); }
}

Program
  = _ body:(decl:TopLevel _ { return decl; })* !. { return { body }; }

TopLevel
  = UsingDecl / TypeDecl / ProtocolDecl / InstanceDecl / FunctionDecl

UsingDecl
  = "using" !IdentPart _ imports:ImportItems? _ "from" !IdentPart _ path:StringToken _ ";"
    { return { kind: "using", imports: imports || [], from: path }; }
ImportItems
  = first:ImportItem rest:(_ ImportItem)* { return [first, ...rest.map(x => x[1])]; }
ImportItem
  = name:Identifier _ alias:("as" !IdentPart _ a:Identifier { return a; })?
    { return alias ? { name, alias } : { name }; }

TypeDecl
  = "$" name:UpperIdentifier _ "is" !IdentPart _ params:(names:TypeParameterNames _ "=>" _ { return names; })? definition:TypeDefinition _ ";"
    { return { kind: "type", name, params: params || [], definition }; }
TypeParameterNames
  = first:TypeParameterName rest:(_ TypeParameterName)* { return [first, ...rest.map(x => x[1])]; }
TypeParameterName
  = "$" name:UpperIdentifier { return name; }
TypeDefinition
  = RecordType / EnumType / TypeExpr
RecordType
  = "{" _ fields:RecordTypeField* _ "}" { return { kind: "record", fields }; }
RecordTypeField
  = name:LowerIdentifier _ "=" _ type:TypeExpr _ { return { name, type }; }
EnumType
  = "|" _ variants:EnumTypeVariant* _ "|" { return { kind: "enum", variants }; }
EnumTypeVariant
  = name:UpperIdentifier _ "=" _ type:TypeExpr _ { return { name, type }; }

TypeExpr
  = TypeFunction / TypeAtom
TypeFunction
  = from:TypeAtom _ ">" _ effect:("!" _ { return true; })? to:TypeExpr
    { return { kind: "function", from, to, effect: !!effect }; }
TypeAtom
  = NamedType / "(" _ type:TypeExpr _ ")" { return type; }
NamedType
  = "$" name:UpperIdentifier args:(_ "<" _ first:TypeAtom rest:(_ TypeAtom)* _ ">" { return [first, ...rest.map(x => x[1])]; })?
    { return { kind: "name", name, args: args || [] }; }

ProtocolDecl
  = "^" name:UpperIdentifier _ "is" !IdentPart _ body:(ProtocolBody / ProtocolComposition) _ ";"
    { return { kind: "protocol", name, body }; }
ProtocolBody
  = "{" _ methods:ProtocolMethod* _ "}" { return { kind: "methods", methods }; }
ProtocolMethod
  = name:LowerIdentifier _ "=" _ type:TypeFunction _ { return { name, type }; }
ProtocolComposition
  = first:ProtocolReference rest:(_ "+" _ ref:ProtocolReference { return ref; })*
    { return { kind: "composition", names: [first, ...rest] }; }
ProtocolReference
  = "^" name:UpperIdentifier { return name; }
ProtocolConstraint
  = first:ProtocolReference rest:(_ "+" _ ref:ProtocolReference { return ref; })*
    { return [first, ...rest]; }
GenericClause
  = first:GenericParameter rest:(_ GenericParameter)* _ "=>" _
    { return [first, ...rest.map(x => x[1])]; }
GenericParameter
  = "$" name:UpperIdentifier constraints:(_ ":" _ c:ProtocolConstraint { return c; })?
    { return { name, constraints: constraints || [] }; }

InstanceDecl
  = "instance" !IdentPart _ typeParams:GenericClause? _ "^" protocol:UpperIdentifier _ "for" !IdentPart _ target:NamedType _ "is" !IdentPart _ "{" _ methods:MethodImplementation* _ "}" _ ";"
    { return { kind: "instance", params: typeParams || [], protocol, target, methods }; }
MethodImplementation
  = _ name:LowerIdentifier params:(_ p:LowerIdentifier { return p; })+ _ "is" !IdentPart _ body:Expr _ ";"
    { return { name, params, body }; }

FunctionDecl
  = name:LowerIdentifier _ typeParams:GenericClause? params:Parameter* _ ">" _ effect:("!" _ { return true; })? returnType:TypeExpr _ "is" !IdentPart _ body:FunctionBody _ ";"
    { return { kind: "function", name, typeParams: typeParams || [], params, returnType, effect: !!effect, body }; }
Parameter
  = name:LowerIdentifier _ ":" _ type:TypeAtom _ { return { name, type }; }
FunctionBody
  = "#" _ name:Identifier { return { kind: "native", name }; }
  / Expr

Expr
  = IfExpr / MatchExpr / DoExpr / ForExpr / LambdaExpr / Application
IfExpr
  = "if" !IdentPart _ condition:Expr _ "then" !IdentPart _ yes:Expr _ "else" !IdentPart _ no:Expr
    { return { kind: "if", condition, then: yes, else: no }; }
MatchExpr
  = "match" !IdentPart _ value:Expr _ "is" !IdentPart _ "{" _ arms:MatchArm+ _ "}"
    { return { kind: "match", value, arms }; }
MatchArm
  = "|" _ pattern:Pattern _ "=>" _ body:Expr _ ";" _ { return { pattern, body }; }
ForExpr
  = "for" !IdentPart _ name:LowerIdentifier _ "in" !IdentPart _ values:Expr _ "do" !IdentPart _ body:Expr
    { return { kind: "for", name, values, body }; }
LambdaExpr
  = "fn" !IdentPart _ typeParams:GenericClause? params:Parameter+ _ ">" _ effect:("!" _ { return true; })? returnType:TypeExpr _ "is" !IdentPart _ body:Expr
    { return { kind: "lambda", typeParams: typeParams || [], params, returnType, effect: !!effect, body }; }
DoExpr
  = "do" !IdentPart _ "{" _ statements:DoStatement* final:Expr _ "}" _ "where" !IdentPart _ "{" _ where:WhereBindings? _ "}"
    { return { kind: "do", statements, final, where: where || [] }; }
DoStatement
  = BindStatement / BreakStatement / ExpressionStatement
BindStatement
  = name:LowerIdentifier _ type:(":" _ t:TypeExpr { return t; })? _ "<-" _ value:Expr _ ";" _
    { return { kind: "bind", name, type, value }; }
BreakStatement
  = "break" !IdentPart _ value:Expr _ ";" _ { return { kind: "break", value }; }
ExpressionStatement
  = value:Expr _ ";" _ { return { kind: "expression", value }; }
WhereBindings
  = first:WhereBinding rest:(_ ";"? _ binding:WhereBinding { return binding; })* _ ";"?
    { return [first, ...rest]; }
WhereBinding
  = name:LowerIdentifier _ type:(":" _ t:TypeExpr { return t; })? _ "=" _ value:Expr
    { return { name, type, value }; }

Application
  = head:Postfix rest:(_ !MemberStart arg:Postfix { return arg; })*
    { return foldCall(head, rest); }
MemberStart
  = LowerIdentifier _ "="
Postfix
  = head:Primary rest:(_ "." _ name:LowerIdentifier { return name; })*
    { return rest.reduce((object, name) => ({ kind: "field", object, name }), head); }
Primary
  = ListLiteral / RecordLiteral / UnitLiteral / Literal / EnumConstructor / IdentifierExpr / Parenthesized
ListLiteral
  = "[" _ items:(ExprList / "" { return []; }) _ "]" { return { kind: "list", items }; }
ExprList
  = first:Expr rest:(_ "," _ expr:Expr { return expr; })* _ ","?
    { return [first, ...rest]; }
RecordLiteral
  = name:UpperIdentifier _ "{" _ fields:RecordField* _ "}"
    { return { kind: "record", name, fields }; }
RecordField
  = name:LowerIdentifier _ "=" _ value:Expr _ { return { name, value }; }
UnitLiteral
  = "(" _ ")" { return { kind: "unit" }; }
Literal
  = value:StringToken { return { kind: "string", value }; }
  / NumberToken
  / "true" !IdentPart { return { kind: "bool", value: true }; }
  / "false" !IdentPart { return { kind: "bool", value: false }; }
NumberToken
  = raw:$(("-"? Digits ("." Digits Exponent? / Exponent)?))
    { return raw.includes(".") || /[eE]/.test(raw) ? { kind: "float", raw } : { kind: "int", raw }; }
StringToken
  = raw:$('"' DoubleChar* '"' / "'" SingleChar* "'") { return decodeString(raw); }
DoubleChar
  = Escape / !('"' / "\\" / "\r" / "\n") .
SingleChar
  = Escape / !("'" / "\\" / "\r" / "\n") .
Escape
  = "\\" ("n" / "r" / "t" / "\\" / "'" / '"' / "u{" HexDigit+ "}")
Exponent
  = [eE] [+-]? Digits
Digits
  = [0-9] ("_"? [0-9])*
EnumConstructor
  = name:UpperIdentifier payload:("(" _ value:Expr _ ")" { return value; })?
    { return { kind: "variant", name, payload }; }
IdentifierExpr
  = name:Identifier { return { kind: "name", name }; }
Parenthesized
  = "(" _ value:Expr _ ")" { return value; }

Pattern
  = WildcardPattern / UnitPattern / LiteralPattern / RecordPattern / EnumPattern / BindPattern / ParenthesizedPattern
WildcardPattern
  = "_" !IdentPart { return { kind: "wildcard" }; }
UnitPattern
  = "(" _ ")" { return { kind: "literal", value: null, literalType: "unit" }; }
LiteralPattern
  = s:StringToken { return { kind: "literal", value: s, literalType: "string" }; }
  / n:NumberToken { return { kind: "literal", value: n.raw, literalType: n.kind }; }
  / "true" !IdentPart { return { kind: "literal", value: true, literalType: "bool" }; }
  / "false" !IdentPart { return { kind: "literal", value: false, literalType: "bool" }; }
RecordPattern
  = name:UpperIdentifier _ "{" _ fields:FieldPatternList? _ "}"
    { return { kind: "record", name, fields: fields || [] }; }
FieldPatternList
  = first:FieldPattern rest:(_ FieldPattern)* { return [first, ...rest.map(x => x[1])]; }
FieldPattern
  = name:LowerIdentifier _ "=" _ pattern:Pattern _ { return { name, pattern }; }
EnumPattern
  = name:UpperIdentifier payload:("(" _ pattern:Pattern _ ")" { return pattern; })?
    { return { kind: "variant", name, payload }; }
BindPattern
  = name:LowerIdentifier { return { kind: "bind", name }; }
ParenthesizedPattern
  = "(" _ pattern:Pattern _ ")" { return pattern; }

Identifier
  = LowerIdentifier / UpperIdentifier
LowerIdentifier
  = !Keyword name:$([a-z] [A-Za-z0-9_]* / "_" [a-z] [A-Za-z0-9_]*) { return name; }
UpperIdentifier
  = name:$([A-Z] [A-Za-z0-9_]* / "_" [A-Z] [A-Za-z0-9_]*) { return name; }
IdentPart
  = [A-Za-z0-9_]
Keyword
  = ("using" / "as" / "from" / "is" / "do" / "where" / "if" / "then" / "else" / "break" / "match" / "for" / "in" / "fn" / "instance" / "true" / "false") !IdentPart
HexDigit
  = [0-9a-fA-F]

_ = (Whitespace / LineComment / BlockComment)*
Whitespace
  = [ \t\r\n]+
LineComment
  = "//" [^\r\n]* ("\r\n" / [\r\n])?
BlockComment
  = "/*" (!"*/" .)* "*/"
