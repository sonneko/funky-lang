const KEYWORDS = {
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
    source;
    cursor = 0;
    line = 1;
    col = 1;
    constructor(source) {
        this.source = source;
    }
    peek() {
        return this.source[this.cursor] || "";
    }
    advance() {
        const char = this.peek();
        this.cursor++;
        if (char === "\n") {
            this.line++;
            this.col = 1;
        }
        else {
            this.col++;
        }
        return char;
    }
    isWhitespace(char) {
        return /\s/.test(char);
    }
    isAlpha(char) {
        return /[a-zA-Z_]/.test(char);
    }
    isDigit(char) {
        return /[0-9]/.test(char);
    }
    isAlphaNumeric(char) {
        return this.isAlpha(char) || this.isDigit(char);
    }
    nextToken() {
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
    skipWhitespace() {
        while (this.isWhitespace(this.peek())) {
            this.advance();
        }
    }
    readString() {
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
    readNumber() {
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
    readIdentifierBody() {
        let value = "";
        while (this.isAlphaNumeric(this.peek())) {
            value += this.advance();
        }
        return value;
    }
    tokenize() {
        const tokens = [];
        let token;
        do {
            token = this.nextToken();
            tokens.push(token);
        } while (token.type !== "EOF");
        return tokens;
    }
}
//# sourceMappingURL=lexer.js.map