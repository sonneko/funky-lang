export interface Program { body: TopLevel[] }
export interface UsingDecl { kind: "using"; imports: { name: string; alias?: string }[]; from: string }
export interface TypeDecl { kind: "type"; name: string; params: string[]; definition: TypeDefinition }
export interface ProtocolDecl { kind: "protocol"; name: string; body: { kind: "methods"; methods: { name: string; type: TypeNode }[] } | { kind: "composition"; names: string[] } }
export interface InstanceDecl { kind: "instance"; params: TypeParameter[]; protocol: string; target: TypeNode; methods: { name: string; params: string[]; body: Expr }[] }
export interface FunctionDecl { kind: "function"; name: string; typeParams: TypeParameter[]; params: { name: string; type: TypeNode }[]; returnType: TypeNode; effect: boolean; body: Expr | { kind: "native"; name: string } }
export type TopLevel = UsingDecl | TypeDecl | ProtocolDecl | InstanceDecl | FunctionDecl;
export interface TypeParameter { name: string; constraints: string[] }
export type TypeNode =
  | { kind: "name"; name: string; args: TypeNode[] }
  | { kind: "function"; from: TypeNode; to: TypeNode; effect: boolean }
  | { kind: "record"; fields: { name: string; type: TypeNode }[] }
  | { kind: "enum"; variants: { name: string; type: TypeNode }[] };
export type TypeDefinition = TypeNode;
export type Expr =
  | { kind: "int"; raw: string }
  | { kind: "float"; raw: string }
  | { kind: "string"; value: string }
  | { kind: "bool"; value: boolean }
  | { kind: "unit" }
  | { kind: "name"; name: string }
  | { kind: "field"; object: Expr; name: string }
  | { kind: "call"; callee: Expr; arg: Expr }
  | { kind: "list"; items: Expr[] }
  | { kind: "record"; name: string; fields: { name: string; value: Expr }[] }
  | { kind: "variant"; name: string; payload?: Expr }
  | { kind: "if"; condition: Expr; then: Expr; else: Expr }
  | { kind: "lambda"; typeParams: TypeParameter[]; params: { name: string; type: TypeNode }[]; returnType: TypeNode; effect: boolean; body: Expr }
  | { kind: "match"; value: Expr; arms: MatchArm[] }
  | { kind: "for"; name: string; values: Expr; body: Expr }
  | { kind: "do"; statements: DoStatement[]; final: Expr; where: WhereBinding[] };
export type Pattern =
  | { kind: "wildcard" }
  | { kind: "bind"; name: string }
  | { kind: "literal"; value: string | boolean | null; literalType: "int" | "float" | "string" | "bool" | "unit" }
  | { kind: "variant"; name: string; payload?: Pattern }
  | { kind: "record"; name: string; fields: { name: string; pattern: Pattern }[] };
export interface MatchArm { pattern: Pattern; body: Expr }
export type DoStatement =
  | { kind: "bind"; name: string; type?: TypeNode; value: Expr }
  | { kind: "expression"; value: Expr }
  | { kind: "break"; value: Expr };
export interface WhereBinding { name: string; type?: TypeNode; value: Expr }
