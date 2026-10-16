export type Program = {
    type: "Program";
    topLevels: TopLevel[];
};

export type TopLevel = Using | FunctionDef | TypeDefinition | ProtocolDefinition;

export type Using = {
    type: "Using";
    imports: { identifier: string; alias?: string }[];
    from: string;
};

export type FunctionDef = {
    type: "FunctionDef";
    name: string;
    protocolDefs?: ProtocolDefList;
    params: ParamDef[];
    returnType: TypeLiteral;
    body: Expression | { type: "Intrinsic"; name: string };
};

export type ProtocolDefList = {
    type: "ProtocolDefList";
    defs: { typeVar: string; body: ProtocolDefinitionBody }[];
};

export type ParamDef = {
    type: "ParamDef";
    name: string;
    typeLiteral: TypeLiteral;
};

export type Expression =
    | IfExpression
    | CallExpression
    | BlockExpression
    | PrimaryExpression
    | ParenExpression;

export type IfExpression = {
    type: "IfExpression";
    condition: Expression;
    thenBranch: Expression;
    elseBranch: Expression;
};

export type CallExpression = {
    type: "CallExpression";
    callee: Expression;
    argument: Expression;
};

export type BlockExpression = {
    type: "BlockExpression";
    body: (Expression | { type: "Break"; expression: Expression })[];
    lastExpression: Expression;
    whereBindings: WhereBinding[];
};

export type WhereBinding = {
    type: "WhereBinding";
    name: string;
    typeLiteral?: TypeLiteral;
    expression: Expression;
};

export type PrimaryExpression =
    | Literal
    | StructLiteral
    | EnumLiteral
    | PeriodAccess;

export type Literal = {
    type: "Literal";
    value: string | number | boolean;
};

export type StructLiteral = {
    type: "StructLiteral";
    name: string;
    fields: { name: string; expression: Expression }[];
};

export type EnumLiteral = {
    type: "EnumLiteral";
    name: string;
    expression: Expression;
};

export type PeriodAccess = {
    type: "PeriodAccess";
    identifiers: string[];
};

export type ParenExpression = {
    type: "ParenExpression";
    expression: Expression;
};

export type TypeDefinition = {
    type: "TypeDefinition";
    name: string;
    typeLiteral: TypeLiteral;
};

export type TypeLiteral =
    | StructTypeBody
    | EnumTypeBody
    | FnTypeBody
    | NamedType;

export type StructTypeBody = {
    type: "StructTypeBody";
    typeParams?: string[];
    fields: { name: string; typeLiteral: TypeLiteral }[];
};

export type EnumTypeBody = {
    type: "EnumTypeBody";
    typeParams?: string[];
    variants: { name: string; typeLiteral: TypeLiteral }[];
};

export type FnTypeBody = {
    type: "FnTypeBody";
    typeConstraints?: { typeVar: string; protocol: ProtocolLiteral }[];
    paramType: TypeLiteral;
    returnType: TypeLiteral;
};

export type NamedType = {
    type: "NamedType";
    name: string;
    typeArgs?: TypeLiteral[];
};

export type ProtocolDefinition = {
    type: "ProtocolDefinition";
    name: string;
    body: ProtocolDefinitionBody;
};

export type ProtocolDefinitionBody =
    | { type: "ProtocolBody"; methods: { name: string; type: FnTypeBody }[] }
    | ProtocolLiteral;

export type ProtocolLiteral = {
    type: "ProtocolLiteral";
    protocols: string[];
};
