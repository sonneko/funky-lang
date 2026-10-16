import { Token } from "./lexer";
import * as AST from "./ast";
export declare class Parser {
    private tokens;
    private cursor;
    constructor(tokens: Token[]);
    private peek;
    private advance;
    private match;
    private expect;
    parseProgram(): AST.Program;
    private parseTopLevel;
    private parseUsing;
    private parseFunction;
    private parseTypeDefinition;
    private parseProtocolDefinition;
    private parseProtocolDefinitionBody;
    private parseProtocolLiteral;
    private parseTypeLiteral;
    private parsePrimaryTypeLiteral;
    private parseStructTypeBody;
    private parseEnumTypeBody;
    private parseFnTypeBody;
    private parseFnTypeBodyTail;
    private parseExpression;
    private parseIfExpression;
    private parseBlockExpression;
    private parseWhereClause;
    private parseCallExpression;
    private isStartOfPrimaryExpression;
    private parsePrimaryOrParenExpression;
    private parsePrimaryExpression;
}
//# sourceMappingURL=parser.d.ts.map