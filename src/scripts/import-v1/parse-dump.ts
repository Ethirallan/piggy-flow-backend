/** One row of a dumped table: column → value as text (numbers too), or null. */
export type DumpRow = Record<string, string | null>;

export class DumpParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`dump line ${line}: ${message}`);
  }
}

// MySQL string escapes (\% and \_ keep their backslash, as MySQL does).
const ESCAPES: Record<string, string> = {
  '0': '\0',
  "'": "'",
  '"': '"',
  b: '\b',
  n: '\n',
  r: '\r',
  t: '\t',
  Z: '\x1a',
  '\\': '\\',
  '%': '\\%',
  _: '\\_',
};

const INSERT = /^INSERT\s+INTO\b/i;
const CREATE_TABLE = /^CREATE\s+TABLE\b/i;
// Statements that carry no rows and are skipped; anything else is an error.
const SKIPPED =
  /^(SET|START\s+TRANSACTION|COMMIT|ROLLBACK|ALTER\s+TABLE|DROP\s+TABLE|LOCK\s+TABLES|UNLOCK\s+TABLES|CREATE\s+DATABASE|USE)\b/i;

const NUMBER = /^-?\d+(\.\d+)?([eE][-+]?\d+)?/;

/**
 * Reads the rows of a phpMyAdmin / mysqldump SQL dump: `CREATE TABLE` names
 * and `INSERT INTO \`t\` (cols) VALUES (…), (…);` rows. Every other statement
 * and comment is skipped. Strict: anything it doesn't understand inside an
 * INSERT is an error with the line it's on.
 */
export function parseDump(sql: string): Map<string, DumpRow[]> {
  return new Parser(sql).parse();
}

class Parser {
  private pos = 0;
  private line = 1;
  private readonly tables = new Map<string, DumpRow[]>();

  constructor(private readonly sql: string) {}

  parse(): Map<string, DumpRow[]> {
    for (;;) {
      this.skipSpaceAndComments();
      if (this.pos >= this.sql.length) {
        return this.tables;
      }
      const rest = this.sql.slice(this.pos, this.pos + 64);
      const insert = INSERT.exec(rest);
      const create = CREATE_TABLE.exec(rest);
      if (insert) {
        this.advance(insert[0].length);
        this.insert();
      } else if (create) {
        this.advance(create[0].length);
        this.skipSpace();
        this.rowsOf(this.identifier());
        this.skipStatement();
      } else if (SKIPPED.test(rest)) {
        this.skipStatement();
      } else {
        const words = rest.split(/\s+/).slice(0, 2).join(' ');
        throw new DumpParseError(`unsupported statement "${words}"`, this.line);
      }
    }
  }

  private rowsOf(table: string): DumpRow[] {
    let rows = this.tables.get(table);
    if (!rows) {
      rows = [];
      this.tables.set(table, rows);
    }
    return rows;
  }

  private insert(): void {
    this.skipSpace();
    const rows = this.rowsOf(this.identifier());
    this.skipSpace();
    this.expect('(');
    const columns: string[] = [];
    for (;;) {
      this.skipSpace();
      const column = this.identifier();
      if (columns.includes(column)) {
        throw new DumpParseError(
          `column "${column}" is listed twice`,
          this.line,
        );
      }
      columns.push(column);
      this.skipSpace();
      if (this.peek() === ')') {
        this.advance(1);
        break;
      }
      this.expect(',');
    }
    this.skipSpace();
    this.expectWord('VALUES');
    for (;;) {
      this.skipSpace();
      const line = this.line;
      const values = this.tuple();
      if (values.length !== columns.length) {
        throw new DumpParseError(
          `expected ${columns.length} values, found ${values.length}`,
          line,
        );
      }
      rows.push(Object.fromEntries(columns.map((c, i) => [c, values[i]])));
      this.skipSpace();
      const next = this.peek();
      this.advance(1);
      if (next === ';') {
        return;
      }
      if (next !== ',') {
        throw new DumpParseError(
          `expected "," or ";", found "${next ?? 'end of dump'}"`,
          this.line,
        );
      }
    }
  }

  private tuple(): (string | null)[] {
    this.expect('(');
    const values: (string | null)[] = [];
    for (;;) {
      this.skipSpace();
      values.push(this.value());
      this.skipSpace();
      const next = this.peek();
      this.advance(1);
      if (next === ')') {
        return values;
      }
      if (next !== ',') {
        throw new DumpParseError(
          `expected "," or ")", found "${next ?? 'end of dump'}"`,
          this.line,
        );
      }
    }
  }

  private value(): string | null {
    if (this.peek() === "'") {
      return this.string();
    }
    if (this.startsWith('NULL')) {
      this.advance(4);
      return null;
    }
    const number = NUMBER.exec(this.sql.slice(this.pos, this.pos + 64));
    const after = number ? this.sql[this.pos + number[0].length] : undefined;
    if (!number || (after !== undefined && /[\w.]/.test(after))) {
      throw new DumpParseError('unsupported value', this.line);
    }
    this.advance(number[0].length);
    return number[0];
  }

  private string(): string {
    const startLine = this.line;
    this.advance(1);
    let out = '';
    for (;;) {
      if (this.pos >= this.sql.length) {
        throw new DumpParseError('unterminated string', startLine);
      }
      const char = this.sql[this.pos];
      if (char === '\\') {
        const escaped = this.sql[this.pos + 1];
        const decoded = escaped === undefined ? undefined : ESCAPES[escaped];
        if (decoded === undefined) {
          throw new DumpParseError(
            `unknown escape "\\${escaped ?? ''}"`,
            this.line,
          );
        }
        out += decoded;
        this.advance(2);
      } else if (char === "'") {
        if (this.sql[this.pos + 1] === "'") {
          out += "'";
          this.advance(2);
        } else {
          this.advance(1);
          return out;
        }
      } else {
        out += char;
        this.advance(1);
      }
    }
  }

  private identifier(): string {
    this.expect('`');
    const end = this.sql.indexOf('`', this.pos);
    if (end === -1) {
      throw new DumpParseError('unterminated identifier', this.line);
    }
    const name = this.sql.slice(this.pos, end);
    this.advance(end + 1 - this.pos);
    return name;
  }

  /** Skips to just after the next `;` outside quotes. */
  private skipStatement(): void {
    let quote: string | null = null;
    while (this.pos < this.sql.length) {
      const char = this.sql[this.pos];
      if (quote) {
        if (char === '\\' && quote !== '`') {
          this.advance(2);
          continue;
        }
        if (char === quote) {
          quote = null;
        }
      } else if (char === "'" || char === '"' || char === '`') {
        quote = char;
      } else if (char === ';') {
        this.advance(1);
        return;
      }
      this.advance(1);
    }
  }

  private skipSpaceAndComments(): void {
    for (;;) {
      this.skipSpace();
      if (this.startsWith('--') || this.startsWith('#')) {
        const end = this.sql.indexOf('\n', this.pos);
        this.advance((end === -1 ? this.sql.length : end) - this.pos);
      } else if (this.startsWith('/*')) {
        const end = this.sql.indexOf('*/', this.pos);
        if (end === -1) {
          throw new DumpParseError('unterminated comment', this.line);
        }
        // `/*!40101 … */;` — the `;` is skipped as an empty statement next.
        this.advance(end + 2 - this.pos);
      } else if (this.peek() === ';') {
        this.advance(1);
      } else {
        return;
      }
    }
  }

  private skipSpace(): void {
    while (this.pos < this.sql.length && /\s/.test(this.sql[this.pos])) {
      this.advance(1);
    }
  }

  private expect(char: string): void {
    if (this.peek() !== char) {
      throw new DumpParseError(
        `expected "${char}", found "${this.peek() ?? 'end of dump'}"`,
        this.line,
      );
    }
    this.advance(1);
  }

  private expectWord(word: string): void {
    if (
      !this.sql
        .slice(this.pos, this.pos + word.length)
        .toUpperCase()
        .startsWith(word)
    ) {
      throw new DumpParseError(`expected ${word}`, this.line);
    }
    this.advance(word.length);
  }

  private startsWith(text: string): boolean {
    return this.sql.startsWith(text, this.pos);
  }

  private peek(): string | undefined {
    return this.sql[this.pos];
  }

  private advance(count: number): void {
    for (let i = 0; i < count && this.pos < this.sql.length; i++) {
      if (this.sql[this.pos] === '\n') {
        this.line++;
      }
      this.pos++;
    }
  }
}
