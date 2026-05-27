export type TokenType = "IDENTIFIER" | "TYPE_IDENTIFIER" | "PROTOCOL_IDENTIFIER" | "LITERAL_STRING" | "LITERAL_NUMBER" | "LITERAL_BOOLEAN" | "KEYWORD_USING" | "KEYWORD_AS" | "KEYWORD_FROM" | "KEYWORD_IS" | "KEYWORD_IF" | "KEYWORD_THEN" | "KEYWORD_ELSE" | "KEYWORD_DO" | "KEYWORD_BREAK" | "KEYWORD_WHERE" | "SYMBOL_SEMICOLON" | "SYMBOL_COLON" | "SYMBOL_EQUALS" | "SYMBOL_ARROW" | "SYMBOL_GREATER" | "SYMBOL_LESS" | "SYMBOL_BRACE_OPEN" | "SYMBOL_BRACE_CLOSE" | "SYMBOL_PAREN_OPEN" | "SYMBOL_PAREN_CLOSE" | "SYMBOL_PERIOD" | "SYMBOL_COMMA" | "SYMBOL_PIPE" | "SYMBOL_PLUS" | "SYMBOL_HASH" | "EOF";
export type Token = {
    type: TokenType;
    value: string;
    line: number;
    col: number;
};
export declare class Lexer {
    private source;
    private cursor;
    private line;
    private col;
    constructor(source: string);
    private peek;
    private advance;
    private isWhitespace;
    private isAlpha;
    private isDigit;
    private isAlphaNumeric;
    nextToken(): Token;
    private skipWhitespace;
    private readString;
    private readNumber;
    private readIdentifierBody;
    tokenize(): Token[];
}
//# sourceMappingURL=lexer.d.ts.map