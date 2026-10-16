import { Token, TokenType } from "./lexer";
import * as AST from "./ast";
export class Parser {
    tokens;
    cursor = 0;
    constructor(tokens) {
        this.tokens = tokens;
    }
    peek() {
        return this.tokens[this.cursor];
    }
    advance() {
        return this.tokens[this.cursor++];
    }
    match(type) {
        if (this.peek().type === type) {
            this.advance();
            return true;
        }
        return false;
    }
    expect(type, message) {
        if (this.peek().type === type) {
            return this.advance();
        }
        throw new Error(`${message} (Found ${this.peek().type} '${this.peek().value}' at ${this.peek().line}:${this.peek().col})`);
    }
    parseProgram() {
        const topLevels = [];
        while (this.peek().type !== "EOF") {
            topLevels.push(this.parseTopLevel());
        }
        return { type: "Program", topLevels };
    }
    parseTopLevel() {
        const token = this.peek();
        if (token.type === "KEYWORD_USING") {
            return this.parseUsing();
        }
        else if (token.type === "TYPE_IDENTIFIER") {
            return this.parseTypeDefinition();
        }
        else if (token.type === "PROTOCOL_IDENTIFIER") {
            return this.parseProtocolDefinition();
        }
        else {
            return this.parseFunction();
        }
    }
    parseUsing() {
        this.expect("KEYWORD_USING", "Expected 'using'");
        const imports = [];
        while (this.peek().type === "IDENTIFIER") {
            const identifier = this.advance().value;
            let alias;
            if (this.match("KEYWORD_AS")) {
                alias = this.expect("IDENTIFIER", "Expected alias after 'as'").value;
            }
            imports.push({ identifier, alias });
        }
        this.expect("KEYWORD_FROM", "Expected 'from'");
        const from = this.expect("LITERAL_STRING", "Expected string literal after 'from'").value;
        this.expect("SYMBOL_SEMICOLON", "Expected ';' after using statement");
        return { type: "Using", imports, from };
    }
    parseFunction() {
        const name = this.expect("IDENTIFIER", "Expected function name").value;
        let protocolDefs;
        // Check for protocol_def_list: ( "$" identifier: protocol_definition_body )* "=>"
        // This is tricky because it starts with $, same as param_def might if we were unlucky,
        // but param_def starts with identifier.
        if (this.peek().type === "TYPE_IDENTIFIER") {
            const defs = [];
            while (this.peek().type === "TYPE_IDENTIFIER") {
                const typeVar = this.advance().value;
                this.expect("SYMBOL_COLON", "Expected ':' after type variable in protocol def list");
                const body = this.parseProtocolDefinitionBody();
                defs.push({ typeVar, body });
            }
            this.expect("SYMBOL_ARROW", "Expected '=>' after protocol def list");
            protocolDefs = { type: "ProtocolDefList", defs };
        }
        const params = [];
        while (this.peek().type === "IDENTIFIER") {
            const pName = this.advance().value;
            this.expect("SYMBOL_COLON", "Expected ':' after parameter name");
            const pType = this.parseTypeLiteral();
            params.push({ type: "ParamDef", name: pName, typeLiteral: pType });
        }
        this.expect("SYMBOL_GREATER", "Expected '>' before return type");
        const returnType = this.parseTypeLiteral();
        this.expect("KEYWORD_IS", "Expected 'is' before function body");
        let body;
        if (this.match("SYMBOL_HASH")) {
            const intrinsicName = this.expect("IDENTIFIER", "Expected intrinsic name after '#'").value;
            body = { type: "Intrinsic", name: intrinsicName };
        }
        else {
            body = this.parseExpression();
        }
        this.expect("SYMBOL_SEMICOLON", "Expected ';' after function definition");
        return {
            type: "FunctionDef",
            name,
            protocolDefs,
            params,
            returnType,
            body
        };
    }
    parseTypeDefinition() {
        const nameToken = this.expect("TYPE_IDENTIFIER", "Expected type identifier");
        this.expect("KEYWORD_IS", "Expected 'is' after type identifier");
        const typeLiteral = this.parseTypeLiteral();
        this.expect("SYMBOL_SEMICOLON", "Expected ';' after type definition");
        return { type: "TypeDefinition", name: nameToken.value, typeLiteral };
    }
    parseProtocolDefinition() {
        const nameToken = this.expect("PROTOCOL_IDENTIFIER", "Expected protocol identifier");
        this.expect("KEYWORD_IS", "Expected 'is' after protocol identifier");
        const body = this.parseProtocolDefinitionBody();
        this.expect("SYMBOL_SEMICOLON", "Expected ';' after protocol definition");
        return { type: "ProtocolDefinition", name: nameToken.value, body };
    }
    parseProtocolDefinitionBody() {
        if (this.peek().type === "SYMBOL_BRACE_OPEN") {
            this.advance();
            const methods = [];
            while (this.peek().type === "IDENTIFIER") {
                const name = this.advance().value;
                this.expect("SYMBOL_EQUALS", "Expected '=' after method name");
                const type = this.parseFnTypeBody();
                methods.push({ name, type });
            }
            this.expect("SYMBOL_BRACE_CLOSE", "Expected '}' after protocol body");
            return { type: "ProtocolBody", methods };
        }
        else {
            return this.parseProtocolLiteral();
        }
    }
    parseProtocolLiteral() {
        const protocols = [];
        protocols.push(this.expect("PROTOCOL_IDENTIFIER", "Expected protocol identifier").value);
        while (this.match("SYMBOL_PLUS")) {
            protocols.push(this.expect("PROTOCOL_IDENTIFIER", "Expected protocol identifier after '+'").value);
        }
        return { type: "ProtocolLiteral", protocols };
    }
    parseTypeLiteral() {
        // Lookahead to distinguish between struct/enum/fn types
        const token = this.peek();
        if (token.type === "SYMBOL_BRACE_OPEN") {
            return this.parseStructTypeBody();
        }
        else if (token.type === "SYMBOL_PIPE") {
            return this.parseEnumTypeBody();
        }
        else if (token.type === "TYPE_IDENTIFIER") {
            // Could be NamedType or start of StructTypeBody/EnumTypeBody/FnTypeBody if it has type params
            // But wait, the grammar says:
            // <struct_type_body> ::= (( "$" <identifier> )* "=>" )? "{" (<identifier> "=" <type_literal>)* "}"
            // This means if it starts with $ident, we need to check if it's followed by => or { or | or just ends there.
            // Let's try to parse type parameters if they exist
            const typeParams = [];
            const snapshot = this.cursor;
            try {
                while (this.peek().type === "TYPE_IDENTIFIER") {
                    typeParams.push(this.advance().value);
                }
                if (this.match("SYMBOL_ARROW")) {
                    // It's definitely a body with type params
                    if (this.peek().type === "SYMBOL_BRACE_OPEN") {
                        const struct = this.parseStructTypeBody();
                        struct.typeParams = typeParams;
                        return struct;
                    }
                    else if (this.peek().type === "SYMBOL_PIPE") {
                        const enu = this.parseEnumTypeBody();
                        enu.typeParams = typeParams;
                        return enu;
                    }
                    else {
                        // Must be FnTypeBody?
                        // <fn_type_body> ::= ( ( "$" <identifier> ":" <protocol_literal> )* "=>" )? <type_literal> ">" ( <fn_type_body> | <type_literal> )
                        // Wait, my typeParams logic is for struct/enum. Fn type has constraints.
                    }
                }
            }
            catch (e) { }
            this.cursor = snapshot;
            // If it's just a named type
            const name = this.advance().value;
            let typeArgs;
            if (this.match("SYMBOL_LESS")) {
                typeArgs = [];
                while (this.peek().type !== "SYMBOL_GREATER") {
                    typeArgs.push(this.parseTypeLiteral());
                }
                this.expect("SYMBOL_GREATER", "Expected '>' after type arguments");
            }
            const namedType = { type: "NamedType", name, typeArgs };
            // Check if it's the start of a function type: NamedType ">" ...
            if (this.peek().type === "SYMBOL_GREATER") {
                return this.parseFnTypeBodyTail(namedType);
            }
            return namedType;
        }
        else {
            // FnTypeBody can also start with any TypeLiteral
            const first = this.parsePrimaryTypeLiteral();
            if (this.peek().type === "SYMBOL_GREATER") {
                return this.parseFnTypeBodyTail(first);
            }
            return first;
        }
    }
    parsePrimaryTypeLiteral() {
        const token = this.peek();
        if (token.type === "SYMBOL_BRACE_OPEN") {
            return this.parseStructTypeBody();
        }
        else if (token.type === "SYMBOL_PIPE") {
            return this.parseEnumTypeBody();
        }
        else if (token.type === "TYPE_IDENTIFIER") {
            const name = this.advance().value;
            let typeArgs;
            if (this.match("SYMBOL_LESS")) {
                typeArgs = [];
                while (this.peek().type !== "SYMBOL_GREATER") {
                    typeArgs.push(this.parseTypeLiteral());
                }
                this.expect("SYMBOL_GREATER", "Expected '>' after type arguments");
            }
            return { type: "NamedType", name, typeArgs };
        }
        throw new Error(`Unexpected token in type literal: ${token.type}`);
    }
    parseStructTypeBody() {
        this.expect("SYMBOL_BRACE_OPEN", "Expected '{'");
        const fields = [];
        while (this.peek().type === "IDENTIFIER") {
            const name = this.advance().value;
            this.expect("SYMBOL_EQUALS", "Expected '=' after field name");
            const typeLiteral = this.parseTypeLiteral();
            fields.push({ name, typeLiteral });
        }
        this.expect("SYMBOL_BRACE_CLOSE", "Expected '}'");
        return { type: "StructTypeBody", fields };
    }
    parseEnumTypeBody() {
        this.expect("SYMBOL_PIPE", "Expected '|'");
        const variants = [];
        while (this.peek().type === "IDENTIFIER") {
            const name = this.advance().value;
            this.expect("SYMBOL_EQUALS", "Expected '=' after variant name");
            const typeLiteral = this.parseTypeLiteral();
            variants.push({ name, typeLiteral });
        }
        this.expect("SYMBOL_PIPE", "Expected '|'");
        return { type: "EnumTypeBody", variants };
    }
    parseFnTypeBody() {
        // ( ( "$" <identifier> ":" <protocol_literal> )* "=>" )? <type_literal> ">" ( <fn_type_body> | <type_literal> )
        let typeConstraints;
        const snapshot = this.cursor;
        if (this.peek().type === "TYPE_IDENTIFIER") {
            typeConstraints = [];
            while (this.peek().type === "TYPE_IDENTIFIER") {
                const typeVar = this.advance().value;
                this.expect("SYMBOL_COLON", "Expected ':'");
                const protocol = this.parseProtocolLiteral();
                typeConstraints.push({ typeVar, protocol });
            }
            if (!this.match("SYMBOL_ARROW")) {
                this.cursor = snapshot;
                typeConstraints = undefined;
            }
        }
        const paramType = this.parseTypeLiteral();
        return this.parseFnTypeBodyTail(paramType, typeConstraints);
    }
    parseFnTypeBodyTail(paramType, typeConstraints) {
        this.expect("SYMBOL_GREATER", "Expected '>'");
        const returnType = this.parseTypeLiteral();
        return {
            type: "FnTypeBody",
            typeConstraints,
            paramType,
            returnType
        };
    }
    parseExpression() {
        const token = this.peek();
        if (token.type === "KEYWORD_IF") {
            return this.parseIfExpression();
        }
        else if (token.type === "KEYWORD_DO") {
            return this.parseBlockExpression();
        }
        else {
            return this.parseCallExpression();
        }
    }
    parseIfExpression() {
        this.expect("KEYWORD_IF", "Expected 'if'");
        const condition = this.parseExpression();
        this.expect("KEYWORD_THEN", "Expected 'then'");
        const thenBranch = this.parseExpression();
        this.expect("KEYWORD_ELSE", "Expected 'else'");
        const elseBranch = this.parseExpression();
        return { type: "IfExpression", condition, thenBranch, elseBranch };
    }
    parseBlockExpression() {
        this.expect("KEYWORD_DO", "Expected 'do'");
        this.expect("SYMBOL_BRACE_OPEN", "Expected '{'");
        const body = [];
        while (true) {
            if (this.match("KEYWORD_BREAK")) {
                const expression = this.parseExpression();
                body.push({ type: "Break", expression });
                this.expect("SYMBOL_SEMICOLON", "Expected ';' after break");
            }
            else {
                const expr = this.parseExpression();
                if (this.match("SYMBOL_SEMICOLON")) {
                    body.push(expr);
                }
                else {
                    // This must be the last expression
                    this.expect("SYMBOL_BRACE_CLOSE", "Expected '}' or ';' after expression");
                    const whereBindings = this.parseWhereClause();
                    return { type: "BlockExpression", body, lastExpression: expr, whereBindings };
                }
            }
        }
    }
    parseWhereClause() {
        this.expect("KEYWORD_WHERE", "Expected 'where'");
        this.expect("SYMBOL_BRACE_OPEN", "Expected '{'");
        const bindings = [];
        while (this.peek().type === "IDENTIFIER") {
            const name = this.advance().value;
            let typeLiteral;
            if (this.match("SYMBOL_COLON")) {
                typeLiteral = this.parseTypeLiteral();
            }
            this.expect("SYMBOL_EQUALS", "Expected '='");
            const expression = this.parseExpression();
            bindings.push({ type: "WhereBinding", name, typeLiteral, expression });
        }
        this.expect("SYMBOL_BRACE_CLOSE", "Expected '}'");
        return bindings;
    }
    parseCallExpression() {
        let expr = this.parsePrimaryOrParenExpression();
        while (true) {
            const token = this.peek();
            // Call expression is <expression> <primary_expression>
            // We need to decide if the next token starts a primary expression.
            if (this.isStartOfPrimaryExpression(token)) {
                const arg = this.parsePrimaryExpression();
                expr = {
                    type: "CallExpression",
                    callee: expr,
                    argument: arg
                };
            }
            else {
                break;
            }
        }
        return expr;
    }
    isStartOfPrimaryExpression(token) {
        return (token.type === "LITERAL_STRING" ||
            token.type === "LITERAL_NUMBER" ||
            token.type === "LITERAL_BOOLEAN" ||
            token.type === "IDENTIFIER");
    }
    parsePrimaryOrParenExpression() {
        if (this.peek().type === "SYMBOL_PAREN_OPEN") {
            this.advance();
            const expr = this.parseExpression();
            this.expect("SYMBOL_PAREN_CLOSE", "Expected ')'");
            return { type: "ParenExpression", expression: expr };
        }
        return this.parsePrimaryExpression();
    }
    parsePrimaryExpression() {
        const token = this.peek();
        if (token.type === "LITERAL_STRING" || token.type === "LITERAL_NUMBER" || token.type === "LITERAL_BOOLEAN") {
            this.advance();
            let value = token.value;
            if (token.type === "LITERAL_NUMBER")
                value = Number(token.value);
            if (token.type === "LITERAL_BOOLEAN")
                value = token.value === "true";
            return { type: "Literal", value };
        }
        if (token.type === "IDENTIFIER") {
            const name = this.advance().value;
            if (this.match("SYMBOL_BRACE_OPEN")) {
                const fields = [];
                while (this.peek().type === "IDENTIFIER") {
                    const fName = this.advance().value;
                    this.expect("SYMBOL_EQUALS", "Expected '='");
                    const fExpr = this.parseExpression();
                    fields.push({ name: fName, expression: fExpr });
                }
                this.expect("SYMBOL_BRACE_CLOSE", "Expected '}'");
                return { type: "StructLiteral", name, fields };
            }
            else if (this.match("SYMBOL_PAREN_OPEN")) {
                const expr = this.parseExpression();
                this.expect("SYMBOL_PAREN_CLOSE", "Expected ')'");
                return { type: "EnumLiteral", name, expression: expr };
            }
            else {
                const identifiers = [name];
                while (this.match("SYMBOL_PERIOD")) {
                    identifiers.push(this.expect("IDENTIFIER", "Expected identifier after '.'").value);
                }
                return { type: "PeriodAccess", identifiers };
            }
        }
        throw new Error(`Expected primary expression, found ${token.type} '${token.value}'`);
    }
}
//# sourceMappingURL=parser.js.map