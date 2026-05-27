export type TokenType =
    | "IDENTIFIER"
    | "TYPE_IDENTIFIER" // $identifier
    | "PROTOCOL_IDENTIFIER" // ^identifier
    | "LITERAL_STRING"
    | "LITERAL_NUMBER"
    | "LITERAL_BOOLEAN"
    | "KEYWORD_USING"
    | "KEYWORD_AS"
    | "KEYWORD_FROM"
    | "KEYWORD_IS"
    | "KEYWORD_IF"
    | "KEYWORD_THEN"
    | "KEYWORD_ELSE"
    | "KEYWORD_DO"
    | "KEYWORD_BREAK"
    | "KEYWORD_WHERE"
    | "SYMBOL_SEMICOLON"
    | "SYMBOL_COLON"
    | "SYMBOL_EQUALS"
    | "SYMBOL_ARROW" // =>
    | "SYMBOL_GREATER" // >
    | "SYMBOL_LESS" // <
    | "SYMBOL_BRACE_OPEN"
    | "SYMBOL_BRACE_CLOSE"
    | "SYMBOL_PAREN_OPEN"
    | "SYMBOL_PAREN_CLOSE"
    | "SYMBOL_PERIOD"
    | "SYMBOL_COMMA"
    | "SYMBOL_PIPE"
    | "SYMBOL_PLUS"
    | "SYMBOL_HASH"
    | "EOF";

export type Token = {
    type: TokenType;
    value: string;
    line: number;
    col: number;
};

const KEYWORDS: Record<string, TokenType> = {
    using: "KEYWORD_USING",
    as: "KEYWORD_AS",
    from: "KEYWORD_FROM",
    is: "KEYWORD_IS",
    if: "KEYWORD_IF",
    then: "KEYWORD_THEN",
    else: "KEYWORD_ELSE",
    do: "KEYWORD_DO",
    break: "KEYWORD_BREAK",
    where: "KEYWORD_WHERE",
};

export class Lexer {
    private source: string;
    private cursor: number = 0;
    private line: number = 1;
    private col: number = 1;

    constructor(source: string) {
        this.source = source;
    }

    private peek(): string {
        return this.source[this.cursor] || "";
    }

    private advance(): string {
        const char = this.peek();
        this.cursor++;
        if (char === "\n") {
            this.line++;
            this.col = 1;
        } else {
            this.col++;
        }
        return char;
    }

    private isWhitespace(char: string): boolean {
        return /\s/.test(char);
    }

    private isAlpha(char: string): boolean {
        return /[a-zA-Z_]/.test(char);
    }

    private isDigit(char: string): boolean {
        return /[0-9]/.test(char);
    }

    private isAlphaNumeric(char: string): boolean {
        return this.isAlpha(char) || this.isDigit(char);
    }

    nextToken(): Token {
        this.skipWhitespace();

        const startLine = this.line;
        const startCol = this.col;

        if (this.cursor >= this.source.length) {
            return { type: "EOF", value: "", line: startLine, col: startCol };
        }

        const char = this.peek();

        if (char === '"') {
            return this.readString();
        }

        if (this.isDigit(char)) {
            return this.readNumber();
        }

        if (char === "$") {
            this.advance();
            const ident = this.readIdentifierBody();
            return { type: "TYPE_IDENTIFIER", value: ident, line: startLine, col: startCol };
        }

        if (char === "^") {
            this.advance();
            const ident = this.readIdentifierBody();
            return { type: "PROTOCOL_IDENTIFIER", value: ident, line: startLine, col: startCol };
        }

        if (this.isAlpha(char)) {
            const ident = this.readIdentifierBody();
            if (ident === "true" || ident === "false") {
                return { type: "LITERAL_BOOLEAN", value: ident, line: startLine, col: startCol };
            }
            if (KEYWORDS[ident]) {
                return { type: KEYWORDS[ident], value: ident, line: startLine, col: startCol };
            }
            return { type: "IDENTIFIER", value: ident, line: startLine, col: startCol };
        }

        this.advance();
        switch (char) {
            case ";": return { type: "SYMBOL_SEMICOLON", value: ";", line: startLine, col: startCol };
            case ":": return { type: "SYMBOL_COLON", value: ":", line: startLine, col: startCol };
            case "=":
                if (this.peek() === ">") {
                    this.advance();
                    return { type: "SYMBOL_ARROW", value: "=>", line: startLine, col: startCol };
                }
                return { type: "SYMBOL_EQUALS", value: "=", line: startLine, col: startCol };
            case ">": return { type: "SYMBOL_GREATER", value: ">", line: startLine, col: startCol };
            case "<": return { type: "SYMBOL_LESS", value: "<", line: startLine, col: startCol };
            case "{": return { type: "SYMBOL_BRACE_OPEN", value: "{", line: startLine, col: startCol };
            case "}": return { type: "SYMBOL_BRACE_CLOSE", value: "}", line: startLine, col: startCol };
            case "(": return { type: "SYMBOL_PAREN_OPEN", value: "(", line: startLine, col: startCol };
            case ")": return { type: "SYMBOL_PAREN_CLOSE", value: ")", line: startLine, col: startCol };
            case ".": return { type: "SYMBOL_PERIOD", value: ".", line: startLine, col: startCol };
            case ",": return { type: "SYMBOL_COMMA", value: ",", line: startLine, col: startCol };
            case "|": return { type: "SYMBOL_PIPE", value: "|", line: startLine, col: startCol };
            case "+": return { type: "SYMBOL_PLUS", value: "+", line: startLine, col: startCol };
            case "#": return { type: "SYMBOL_HASH", value: "#", line: startLine, col: startCol };
        }

        throw new Error(`Unexpected character: ${char} at line ${startLine}, col ${startCol}`);
    }

    private skipWhitespace() {
        while (this.isWhitespace(this.peek())) {
            this.advance();
        }
    }

    private readString(): Token {
        const startLine = this.line;
        const startCol = this.col;
        this.advance(); // skip "
        let value = "";
        while (this.peek() !== '"' && this.cursor < this.source.length) {
            value += this.advance();
        }
        if (this.peek() !== '"') {
            throw new Error(`Unterminated string at line ${startLine}, col ${startCol}`);
        }
        this.advance(); // skip "
        return { type: "LITERAL_STRING", value, line: startLine, col: startCol };
    }

    private readNumber(): Token {
        const startLine = this.line;
        const startCol = this.col;
        let value = "";
        while (this.isDigit(this.peek())) {
            value += this.advance();
        }
        if (this.peek() === ".") {
            value += this.advance();
            while (this.isDigit(this.peek())) {
                value += this.advance();
            }
        }
        return { type: "LITERAL_NUMBER", value, line: startLine, col: startCol };
    }

    private readIdentifierBody(): string {
        let value = "";
        while (this.isAlphaNumeric(this.peek())) {
            value += this.advance();
        }
        return value;
    }

    tokenize(): Token[] {
        const tokens: Token[] = [];
        let token: Token;
        do {
            token = this.nextToken();
            tokens.push(token);
        } while (token.type !== "EOF");
        return tokens;
    }
}
