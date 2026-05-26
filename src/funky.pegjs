Program
  = _ body:TopLevel* _ { return { type: "Program", body: body }; }

TopLevel
  = t:(Using
  / Function
  / TypeDefinition
  / ProtocolDefinition) _ { return t; }

Using
  = "using" _ ids:(Identifier _ ("as" _ Identifier _)?)* "from" _ from:Literal _ ";" {
    return { type: "Using", ids: ids.map(i => ({ id: i[0], as: i[2] ? i[2][2] : null })), from };
  }

Function
  = id:Identifier _ protocols:ProtocolDefList params:ParamDefList _ "is" _ body:(Expression / Intrinsic) _ ";" {
    return { type: "Function", id, protocols, params, body };
  }
  / id:Identifier _ params:ParamDefList _ "is" _ body:(Expression / Intrinsic) _ ";" {
    return { type: "Function", id, protocols: null, params, body };
  }
  / id:Identifier _ protocols:ProtocolDefList params:ParamDefList _ ";" {
    return { type: "FunctionDeclaration", id, protocols, params };
  }
  / id:Identifier _ params:ParamDefList _ ";" {
    return { type: "FunctionDeclaration", id, protocols: null, params };
  }

ProtocolDefList
  = defs:("$" _ Identifier _ ":" _ ProtocolDefinitionBody _)+ "=>" { return defs; }

Intrinsic
  = "#" id:Identifier { return { type: "Intrinsic", id }; }

ParamDefList
  = params:ParamDef* _ ">" _ returnType:TypeLiteral {
    return { params, returnType };
  }

ParamDef
  = _ id:Identifier _ ":" _ type:TypeLiteral {
    return { id, type };
  }

Expression
  = IfExpression
  / LoopExpression
  / BlockExpression
  / CallExpression
  / PrimaryExpression

IfExpression
  = "if" _ condition:Expression _ "then" _ thenBranch:Expression _ "else" _ elseBranch:Expression {
    return { type: "If", condition, thenBranch, elseBranch };
  }

LoopExpression
  = "loop" _ body:Expression { return { type: "Loop", body }; }

CallExpression
  = head:PrimaryExpression tail:(_ PrimaryExpression)* {
    if (tail.length === 0) return head;
    return tail.reduce((acc, curr) => ({
      type: "Call",
      callee: acc,
      argument: curr[1]
    }), head);
  }

BlockExpression
  = "do" _ "{" _ statements:(BlockStatement)* last:Expression _ "}" _ "where" _ "{" _ bindings:Binding* "}" {
    return { type: "Block", statements, last, bindings };
  }

BlockStatement
  = expr:Expression _ ";" { return { type: "ExpressionStatement", expr }; }
  / "break" _ expr:Expression _ { return { type: "BreakStatement", expr }; }

Binding
  = _ id:Identifier _ type:(":" _ TypeLiteral)? _ "=" _ expr:Expression {
    return { id, type: type ? type[2] : null, expr };
  }

PrimaryExpression
  = Literal
  / StructLiteral
  / EnumLiteral
  / PeriodAccess
  / ParenExpression

StructLiteral
  = id:Identifier _ "{" _ fields:(Identifier _ "=" _ Expression _)* "}" {
    return { type: "StructLiteral", id, fields: fields.map(f => ({ name: f[0], value: f[4] })) };
  }

EnumLiteral
  = id:Identifier _ "(" _ expr:Expression _ ")" {
    return { type: "EnumLiteral", id, expr };
  }

ParenExpression
  = "(" _ expr:Expression _ ")" { return expr; }

PeriodAccess
  = head:Identifier tail:("." Identifier)* {
    if (tail.length === 0) return { type: "Identifier", name: head };
    return { type: "PeriodAccess", head, tail: tail.map(t => t[1]) };
  }

TypeDefinition
  = "$" _ id:Identifier _ "is" _ type:TypeLiteral _ ";" {
    return { type: "TypeDefinition", id, type_node: type };
  }

TypeLiteral
  = FnTypeBody
  / NonFnTypeLiteral

NonFnTypeLiteral
  = StructTypeBody
  / EnumTypeBody
  / "$" _ id:Identifier args:("<" _ (TypeLiteral _)* ">")? {
    return { type: "TypeReference", id, args: args ? args[2].map(a => a[0]) : [] };
  }
  / "(" _ t:TypeLiteral _ ")" { return { type: "ParenType", type: t }; }

StructTypeBody
  = typeParams:( ( "$" Identifier _ )* "=>" _ )? "{" _ fields:(Identifier _ "=" _ TypeLiteral _)* "}" {
    return { type: "StructType", typeParams: typeParams ? typeParams[0].map(p => p[1]) : [], fields: fields.map(f => ({ name: f[0], type: f[4] })) };
  }

EnumTypeBody
  = typeParams:( ( "$" Identifier _ )* "=>" _ )? "|" _ variants:( Identifier _ "=" _ TypeLiteral _ )* "|" {
    return { type: "EnumType", typeParams: typeParams ? typeParams[0].map(p => p[1]) : [], variants: variants.map(v => ({ name: v[0], type: v[4] })) };
  }

FnTypeBody
  = protocols:( ( "$" Identifier ":" _ ProtocolLiteral _ )* "=>" _ )? param:NonFnTypeLiteral _ ">" _ ret:TypeLiteral {
    return { type: "FnType", protocols: protocols ? protocols[0].map(p => ({ id: p[1], protocol: p[4] })) : [], param, returnType: ret };
  }

ProtocolDefinition
  = "^" _ id:Identifier _ "is" _ body:ProtocolDefinitionBody _ ";" {
    return { type: "ProtocolDefinition", id, body };
  }

ProtocolDefinitionBody
  = "{" _ methods:(Identifier _ "=" _ FnTypeBody _)* "}" {
    return { type: "ProtocolBody", methods: methods.map(m => ({ name: m[0], type: m[4] })) };
  }
  / ProtocolLiteral

ProtocolLiteral
  = head:("^" _ Identifier) tail:(_ "+" _ "^" _ Identifier)* {
    return { type: "ProtocolLiteral", protocols: [head[2], ...tail.map(t => t[5])] };
  }

Identifier
  = !Reserved head:[a-zA-Z_] tail:[a-zA-Z0-9_]* { return head + tail.join(""); }

Reserved
  = ("using" / "is" / "as" / "from" / "if" / "then" / "else" / "loop" / "do" / "where" / "break") ![a-zA-Z0-9_]

Literal
  = StringLiteral
  / NumberLiteral
  / BooleanLiteral

StringLiteral
  = "\"" chars:[^\"]* "\"" { return { type: "StringLiteral", value: chars.join("") }; }

NumberLiteral
  = digits:[0-9]+ { return { type: "NumberLiteral", value: parseInt(digits.join(""), 10) }; }

BooleanLiteral
  = "true" { return { type: "BooleanLiteral", value: true }; }
  / "false" { return { type: "BooleanLiteral", value: false }; }

_ "whitespace"
  = [ \t\n\r]*
