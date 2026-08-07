/**
 * A minimal RFC 4180 CSV reader.
 *
 * Written rather than taken as a dependency because production code here has
 * exactly one runtime dependency (`h3-js`, §4.2), and because the requirement is
 * genuinely small — but **not** as small as `split("\n").map(l => l.split(","))`,
 * which is the implementation this module exists to avoid.
 *
 * The published rule sheet proves why. Its `Count` column holds values like
 * `"6 109 792\n30.12%"` — a quoted field containing a newline — so the 729-row
 * sheet spans **1456 physical lines**. A line-splitting parser reads it as ~1456
 * broken rows, and because the breakage lands in the middle of quoted text the
 * damage looks like data rather than like a parse error.
 *
 * @see csv.ts.md
 */

/** Thrown for input this reader will not guess at. */
export class CsvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvParseError";
  }
}

/**
 * Parses CSV text into rows of raw string fields.
 *
 * Handles quoted fields, escaped quotes (`""`), embedded commas, embedded
 * newlines, and both LF and CRLF. Does **not** trim: trailing spaces can be
 * meaningful and a caller that wants them gone can say so.
 *
 * @throws {CsvParseError} on input that ends inside an unterminated quote —
 *   which means the field boundaries after that point are unknowable, so every
 *   row from there on would be silently wrong.
 */
export function parseCsv(text: string): string[][] {
  if (typeof text !== "string") {
    throw new CsvParseError("parseCsv expects a string");
  }

  const state: ReaderState = {
    rows: [],
    row: [],
    field: "",
    inQuotes: false,
  };

  for (let i = 0; i < text.length; i++) {
    i += state.inQuotes
      ? stepInsideQuotes(state, text[i] as string, text[i + 1])
      : stepOutsideQuotes(state, text[i] as string);
  }

  if (state.inQuotes) {
    throw new CsvParseError(
      "CSV ended inside an unterminated quoted field; field boundaries after that point are unknowable",
    );
  }

  // A trailing newline should not manufacture an empty final row, but a final
  // row without a newline must still be emitted.
  if (state.field !== "" || state.row.length > 0) {
    state.row.push(state.field);
    state.rows.push(state.row);
  }

  return state.rows;
}

/** The reader's mutable position. Kept in one object so each step is a function. */
interface ReaderState {
  rows: string[][];
  row: string[];
  field: string;
  inQuotes: boolean;
}

/**
 * One character inside a quoted field. Returns extra characters consumed.
 *
 * This is the whole of RFC 4180's quoting rule: a doubled quote is a literal
 * quote and consumes two characters, a lone quote closes the field, and anything
 * else — **including a comma or a newline** — is ordinary content. That last
 * clause is what makes the rule sheet parseable at all.
 */
function stepInsideQuotes(
  state: ReaderState,
  char: string,
  next: string | undefined,
): number {
  if (char !== '"') {
    state.field += char;
    return 0;
  }
  if (next === '"') {
    state.field += '"';
    return 1;
  }
  state.inQuotes = false;
  return 0;
}

/** One character outside a quoted field. Always consumes exactly one. */
function stepOutsideQuotes(state: ReaderState, char: string): number {
  if (char === '"') {
    state.inQuotes = true;
  } else if (char === ",") {
    state.row.push(state.field);
    state.field = "";
  } else if (char === "\n") {
    state.row.push(state.field);
    state.field = "";
    state.rows.push(state.row);
    state.row = [];
  } else if (char !== "\r") {
    // A bare \r is dropped rather than treated as a terminator: CRLF is handled
    // by the \n branch, and a lone \r inside a field is noise.
    state.field += char;
  }
  return 0;
}

/**
 * Parses CSV whose first row is a header, into `Record<column, value>` objects.
 *
 * Rows with a different field count from the header are **reported, not
 * silently padded**: a short row means the file disagrees with itself, and
 * guessing which column is missing is how a rule ends up keyed on a
 * `Description`.
 */
export function parseCsvObjects(text: string): {
  readonly header: readonly string[];
  readonly rows: readonly Record<string, string>[];
  readonly malformed: readonly {
    readonly line: number;
    readonly fields: number;
  }[];
} {
  const raw = parseCsv(text);
  if (raw.length === 0) {
    throw new CsvParseError("CSV is empty; expected at least a header row");
  }
  const header = raw[0]!;
  const rows: Record<string, string>[] = [];
  const malformed: { line: number; fields: number }[] = [];

  for (let i = 1; i < raw.length; i++) {
    const fields = raw[i]!;
    if (fields.length !== header.length) {
      malformed.push({ line: i + 1, fields: fields.length });
      continue;
    }
    const record: Record<string, string> = {};
    header.forEach((name, column) => {
      record[name] = fields[column] ?? "";
    });
    rows.push(record);
  }

  return { header, rows, malformed };
}
