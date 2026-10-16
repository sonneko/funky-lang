import { Token, TokenType } from "./lexer.js";
import * as AST from "./ast.js";

export class Parser {
    private tokens: Token[];
    private cursor: number = 0;

    constructor(tokens: Token[]) {
        this.tokens = tokens;
    }

    private peek(): Token {
        return this.tokens[this.cursor];
    }

    private advance(): Token {
        return this.tokens[this.cursor++];
    }

    private match(type: TokenType): boolean {
        if (this.peek().type === type) {
            this.advance();
            return true;
        }
        return false;
    }

    private expect(type: TokenType, message: string): Token {
        if (this.peek().type === type) {
            return this.advance();
        }
        throw new Error(`${message} (Found ${this.peek().type} '${this.peek().value}' at ${this.peek().line}:${this.peek().col})`);
    }

    parseProgram(): AST.Program {
        const topLevels: AST.TopLevel[] = [];
        while (this.peek().type !== "EOF") {
            topLevels.push(this.parseTopLevel());
        }
        return { type: "Program", topLevels };
    }

    private parseTopLevel(): AST.TopLevel {
        const token = this.peek();
        if (token.type === "KEYWORD_USING") {
            return this.parseUsing();
        } else if (token.type === "TYPE_IDENTIFIER") {
            return this.parseTypeDefinition();
        } else if (token.type === "PROTOCOL_IDENTIFIER") {
            return this.parseProtocolDefinition();
        } else {
            return this.parseFunction();
        }
    }

    private parseUsing(): AST.Using {
        this.expect("KEYWORD_USING", "Expected 'using'");
        const imports: { identifier: string; alias?: string }[] = [];
        while (this.peek().type === "IDENTIFIER") {
            const identifier = this.advance().value;
            let alias: string | undefined;
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

    private parseFunction(): AST.FunctionDef {
        const name = this.expect("IDENTIFIER", "Expected function name").value;

        let protocolDefs: AST.ProtocolDefList | undefined;
        if (this.peek().type === "TYPE_IDENTIFIER") {
            const snapshot = this.cursor;
            const defs: { typeVar: string; body: AST.ProtocolDefinitionBody }[] = [];
            while (this.peek().type === "TYPE_IDENTIFIER") {
                const typeVar = this.advance().value;
                if (this.match("SYMBOL_COLON")) {
                    const body = this.parseProtocolDefinitionBody();
                    defs.push({ typeVar, body });
                } else {
                    break;
                }
            }
            if (defs.length > 0 && this.match("SYMBOL_ARROW")) {
                protocolDefs = { type: "ProtocolDefList", defs };
            } else {
                this.cursor = snapshot;
            }
        }

        const params: AST.ParamDef[] = [];
        while (this.peek().type === "IDENTIFIER") {
            const pName = this.advance().value;
            this.expect("SYMBOL_COLON", "Expected ':' after parameter name");
            const pType = this.parseTypeLiteralInternal(true);
            params.push({ type: "ParamDef", name: pName, typeLiteral: pType });
        }

        this.expect("SYMBOL_GREATER", "Expected '>' before return type");
        const returnType = this.parseTypeLiteralInternal(true);

        this.expect("KEYWORD_IS", "Expected 'is' before function body");

        let body: AST.Expression | { type: "Intrinsic"; name: string };
        if (this.match("SYMBOL_HASH")) {
            const intrinsicName = this.expect("IDENTIFIER", "Expected intrinsic name after '#'").value;
            body = { type: "Intrinsic", name: intrinsicName };
        } else {
            body = this.parseExpression();
        }

        if (this.peek().type === "SYMBOL_SEMICOLON") {
            this.advance();
        }

        return {
            type: "FunctionDef",
            name,
            protocolDefs,
            params,
            returnType,
            body
        };
    }

    private parseTypeDefinition(): AST.TypeDefinition {
        const nameToken = this.expect("TYPE_IDENTIFIER", "Expected type identifier");
        const name = nameToken.value;

        const typeParams: string[] = [];
        while (this.peek().type === "TYPE_IDENTIFIER") {
            typeParams.push(this.advance().value);
        }

        this.expect("KEYWORD_IS", "Expected 'is' after type identifier");
        const typeLiteral = this.parseTypeLiteral();

        if (typeParams.length > 0) {
            if (typeLiteral.type === "StructTypeBody" || typeLiteral.type === "EnumTypeBody") {
                typeLiteral.typeParams = typeParams;
            }
        }

        this.expect("SYMBOL_SEMICOLON", "Expected ';' after type definition");
        return { type: "TypeDefinition", name, typeLiteral };
    }

    private parseProtocolDefinition(): AST.ProtocolDefinition {
        const nameToken = this.expect("PROTOCOL_IDENTIFIER", "Expected protocol identifier");
        this.expect("KEYWORD_IS", "Expected 'is' after protocol identifier");
        const body = this.parseProtocolDefinitionBody();
        this.expect("SYMBOL_SEMICOLON", "Expected ';' after protocol definition");
        return { type: "ProtocolDefinition", name: nameToken.value, body };
    }

    private parseProtocolDefinitionBody(): AST.ProtocolDefinitionBody {
        if (this.peek().type === "SYMBOL_BRACE_OPEN") {
            this.advance();
            const methods: { name: string; type: AST.FnTypeBody }[] = [];
            while (this.peek().type === "IDENTIFIER") {
                const name = this.advance().value;
                this.expect("SYMBOL_EQUALS", "Expected '=' after method name");
                const type = this.parseFnTypeBody();
                methods.push({ name, type });
            }
            this.expect("SYMBOL_BRACE_CLOSE", "Expected '}' after protocol body");
            return { type: "ProtocolBody", methods };
        } else {
            return this.parseProtocolLiteral();
        }
    }

    private parseProtocolLiteral(): AST.ProtocolLiteral {
        const protocols: string[] = [];
        protocols.push(this.expect("PROTOCOL_IDENTIFIER", "Expected protocol identifier").value);
        while (this.match("SYMBOL_PLUS")) {
            protocols.push(this.expect("PROTOCOL_IDENTIFIER", "Expected protocol identifier after '+'").value);
        }
        return { type: "ProtocolLiteral", protocols };
    }

    private parseTypeLiteral(): AST.TypeLiteral {
        return this.parseTypeLiteralInternal(false);
    }

    private parseTypeLiteralInternal(isBase: boolean): AST.TypeLiteral {
        const token = this.peek();
        let current: AST.TypeLiteral;

        if (token.type === "SYMBOL_BRACE_OPEN") {
            current = this.parseStructTypeBody();
        } else if (token.type === "SYMBOL_PIPE") {
            current = this.parseEnumTypeBody();
        } else if (token.type === "TYPE_IDENTIFIER") {
            const snapshot = this.cursor;
            const typeParams: string[] = [];
            while (this.peek().type === "TYPE_IDENTIFIER") {
                typeParams.push(this.advance().value);
            }
            if (this.match("SYMBOL_ARROW")) {
                if (this.peek().type === "SYMBOL_BRACE_OPEN") {
                    const struct = this.parseStructTypeBody();
                    struct.typeParams = typeParams;
                    current = struct;
                } else if (this.peek().type === "SYMBOL_PIPE") {
                    const enu = this.parseEnumTypeBody();
                    enu.typeParams = typeParams;
                    current = enu;
                } else {
                     this.cursor = snapshot;
                     current = this.parseNamedType();
                }
            } else {
                this.cursor = snapshot;
                current = this.parseNamedType();
            }
        } else {
            throw new Error(`Unexpected token in type literal: ${token.type} '${token.value}' at ${token.line}:${token.col}`);
        }

        if (!isBase && this.peek().type === "SYMBOL_GREATER") {
            if (this.tokens[this.cursor+1] && this.tokens[this.cursor+1].type === "KEYWORD_IS") {
                return current;
            }
            return this.parseFnTypeBodyTail(current);
        }
        return current;
    }

    private parseNamedType(): AST.NamedType {
        const name = this.expect("TYPE_IDENTIFIER", "Expected type identifier").value;
        let typeArgs: AST.TypeLiteral[] | undefined;
        if (this.match("SYMBOL_LESS")) {
            typeArgs = [];
            while (this.peek().type !== "SYMBOL_GREATER") {
                typeArgs.push(this.parseTypeLiteral());
            }
            this.expect("SYMBOL_GREATER", "Expected '>' after type arguments");
        }
        return { type: "NamedType", name, typeArgs };
    }

    private parseStructTypeBody(): AST.StructTypeBody {
        this.expect("SYMBOL_BRACE_OPEN", "Expected '{'");
        const fields: { name: string; typeLiteral: AST.TypeLiteral }[] = [];
        while (this.peek().type === "IDENTIFIER") {
            const name = this.advance().value;
            this.expect("SYMBOL_EQUALS", "Expected '=' after field name");
            const typeLiteral = this.parseTypeLiteral();
            fields.push({ name, typeLiteral });
        }
        this.expect("SYMBOL_BRACE_CLOSE", "Expected '}'");
        return { type: "StructTypeBody", fields };
    }

    private parseEnumTypeBody(): AST.EnumTypeBody {
        this.expect("SYMBOL_PIPE", "Expected '|'");
        const variants: { name: string; typeLiteral: AST.TypeLiteral }[] = [];
        while (this.peek().type === "IDENTIFIER") {
            const name = this.advance().value;
            this.expect("SYMBOL_EQUALS", "Expected '=' after variant name");
            const typeLiteral = this.parseTypeLiteral();
            variants.push({ name, typeLiteral });
        }
        this.expect("SYMBOL_PIPE", "Expected '|'");
        return { type: "EnumTypeBody", variants };
    }

    private parseFnTypeBody(): AST.FnTypeBody {
        let typeConstraints: { typeVar: string; protocol: AST.ProtocolLiteral }[] | undefined;

        const snapshot = this.cursor;
        if (this.peek().type === "TYPE_IDENTIFIER") {
            typeConstraints = [];
            while (this.peek().type === "TYPE_IDENTIFIER") {
                const typeVar = this.advance().value;
                if (this.match("SYMBOL_COLON")) {
                    const protocol = this.parseProtocolLiteral();
                    typeConstraints.push({ typeVar, protocol });
                } else {
                    break;
                }
            }
            if (typeConstraints.length > 0 && this.match("SYMBOL_ARROW")) {
                // OK
            } else {
                this.cursor = snapshot;
                typeConstraints = undefined;
            }
        }

        const paramType = this.parseTypeLiteral();
        return this.parseFnTypeBodyTail(paramType, typeConstraints);
    }

    private parseFnTypeBodyTail(paramType: AST.TypeLiteral, typeConstraints?: { typeVar: string; protocol: AST.ProtocolLiteral }[]): AST.FnTypeBody {
        this.expect("SYMBOL_GREATER", "Expected '>'");
        const returnType = this.parseTypeLiteral();
        return {
            type: "FnTypeBody",
            typeConstraints,
            paramType,
            returnType
        };
    }

    private parseExpression(): AST.Expression {
        const token = this.peek();
        if (token.type === "KEYWORD_IF") {
            return this.parseIfExpression();
        } else if (token.type === "KEYWORD_DO") {
            return this.parseBlockExpression();
        } else {
            return this.parseCallExpression();
        }
    }

    private parseIfExpression(): AST.IfExpression {
        this.expect("KEYWORD_IF", "Expected 'if'");
        const condition = this.parseExpression();
        this.expect("KEYWORD_THEN", "Expected 'then'");
        const thenBranch = this.parseExpression();
        this.expect("KEYWORD_ELSE", "Expected 'else'");
        const elseBranch = this.parseExpression();
        return { type: "IfExpression", condition, thenBranch, elseBranch };
    }

    private parseBlockExpression(): AST.BlockExpression {
        this.expect("KEYWORD_DO", "Expected 'do'");
        this.expect("SYMBOL_BRACE_OPEN", "Expected '{'");
        const body: (AST.Expression | { type: "Break"; expression: AST.Expression })[] = [];

        while (true) {
            const token = this.peek();
            if (token.type === "KEYWORD_BREAK") {
                this.advance();
                const expression = this.parseExpression();
                body.push({ type: "Break", expression });
                this.expect("SYMBOL_SEMICOLON", "Expected ';' after break");
            } else if (token.type === "SYMBOL_BRACE_CLOSE") {
                 throw new Error("Empty block expression body");
            } else {
                const expr = this.parseExpression();
                if (this.match("SYMBOL_SEMICOLON")) {
                    body.push(expr);
                } else {
                    this.expect("SYMBOL_BRACE_CLOSE", "Expected '}' or ';' after expression");
                    const whereBindings = this.parseWhereClause();
                    return { type: "BlockExpression", body, lastExpression: expr, whereBindings };
                }
            }
        }
    }

    private parseWhereClause(): AST.WhereBinding[] {
        this.expect("KEYWORD_WHERE", "Expected 'where'");
        this.expect("SYMBOL_BRACE_OPEN", "Expected '{'");
        const bindings: AST.WhereBinding[] = [];
        while (this.peek().type === "IDENTIFIER") {
            const name = this.advance().value;
            let typeLiteral: AST.TypeLiteral | undefined;
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

    private parseCallExpression(): AST.Expression {
        let expr = this.parsePrimaryOrParenExpression();

        while (true) {
            const token = this.peek();
            if (this.isStartOfPrimaryExpression(token)) {
                if (token.type === "IDENTIFIER" && this.tokens[this.cursor+1] && (this.tokens[this.cursor+1].type === "SYMBOL_EQUALS" || this.tokens[this.cursor+1].type === "SYMBOL_COLON")) {
                    break;
                }
                const arg = this.parsePrimaryExpression();
                expr = {
                    type: "CallExpression",
                    callee: expr,
                    argument: arg
                };
            } else {
                break;
            }
        }
        return expr;
    }

    private isStartOfPrimaryExpression(token: Token): boolean {
        return (
            token.type === "LITERAL_STRING" ||
            token.type === "LITERAL_NUMBER" ||
            token.type === "LITERAL_BOOLEAN" ||
            token.type === "IDENTIFIER" ||
            token.type === "SYMBOL_PAREN_OPEN"
        );
    }

    private parsePrimaryOrParenExpression(): AST.Expression {
        if (this.peek().type === "SYMBOL_PAREN_OPEN") {
            this.advance();
            const expr = this.parseExpression();
            this.expect("SYMBOL_PAREN_CLOSE", "Expected ')'");
            return { type: "ParenExpression", expression: expr };
        }
        return this.parsePrimaryExpression();
    }

    private parsePrimaryExpression(): AST.PrimaryExpression {
        const token = this.peek();
        if (token.type === "LITERAL_STRING" || token.type === "LITERAL_NUMBER" || token.type === "LITERAL_BOOLEAN") {
            this.advance();
            let value: string | number | boolean = token.value;
            if (token.type === "LITERAL_NUMBER") value = Number(token.value);
            if (token.type === "LITERAL_BOOLEAN") value = token.value === "true";
            return { type: "Literal", value };
        }

        if (token.type === "IDENTIFIER") {
            const name = this.advance().value;
            if (this.peek().type === "SYMBOL_BRACE_OPEN") {
                this.advance();
                const fields: { name: string; expression: AST.Expression }[] = [];
                while (this.peek().type === "IDENTIFIER") {
                    const fName = this.advance().value;
                    this.expect("SYMBOL_EQUALS", "Expected '='");
                    const fExpr = this.parseExpression();
                    fields.push({ name: fName, expression: fExpr });
                }
                this.expect("SYMBOL_BRACE_CLOSE", "Expected '}'");
                return { type: "StructLiteral", name, fields };
            } else if (this.peek().type === "SYMBOL_PAREN_OPEN") {
                this.advance();
                const expr = this.parseExpression();
                this.expect("SYMBOL_PAREN_CLOSE", "Expected ')'");
                return { type: "EnumLiteral", name, expression: expr };
            } else {
                const identifiers = [name];
                while (this.match("SYMBOL_PERIOD")) {
                    identifiers.push(this.expect("IDENTIFIER", "Expected identifier after '.'").value);
                }
                return { type: "PeriodAccess", identifiers };
            }
        }

        throw new Error(`Expected primary expression, found ${token.type} '${token.value}' at ${token.line}:${token.col}`);
    }
}
