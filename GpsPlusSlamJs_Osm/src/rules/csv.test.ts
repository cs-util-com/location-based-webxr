/**
 * CSV reader tests.
 *
 * Why these tests matter:
 * The published rule sheet is the reason this module is not
 * `split("\n").map(l => l.split(","))`. Its `Count` column holds values like
 * `"6 109 792\n30.12%"` — a quoted field with an embedded newline — so 729 rows
 * span 1456 physical lines. A line-splitting reader produces ~1456 broken rows,
 * and because the breakage lands mid-quote the damage looks like data rather
 * than like a parse error. That case is the first test below and it is the one
 * that matters.
 *
 * @see csv.ts.md
 */

import { describe, it, expect } from "vitest";
import { parseCsv, parseCsvObjects, CsvParseError } from "./csv.js";

describe("the case the real rule sheet actually presents", () => {
  it("keeps a quoted field containing a NEWLINE as one field of one row", () => {
    // Verbatim shape from the live sheet: 729 rows, 1456 lines.
    const text = 'id,Count,walkable\nbarrier_fence,"6 109 792\n30.12%",0\n';
    const rows = parseCsv(text);

    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual(["barrier_fence", "6 109 792\n30.12%", "0"]);
  });

  it("keeps a quoted field containing a COMMA intact", () => {
    // The Description column is free prose and full of commas.
    const rows = parseCsv('id,Description\nx,"a, b, and c"\n');
    expect(rows[1]).toEqual(["x", "a, b, and c"]);
  });

  it("unescapes a doubled quote", () => {
    const rows = parseCsv('id,Description\nx,"say ""hi"" now"\n');
    expect(rows[1]![1]).toBe('say "hi" now');
  });
});

describe("line endings and edges", () => {
  it("handles CRLF as well as LF", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("does not manufacture an empty final row from a trailing newline", () => {
    expect(parseCsv("a,b\n1,2\n")).toHaveLength(2);
  });

  it("still emits a final row that has no trailing newline", () => {
    expect(parseCsv("a,b\n1,2")).toHaveLength(2);
  });

  it("preserves empty fields rather than collapsing them", () => {
    // The `w` column in the real sheet is entirely empty, and an empty field
    // has to survive as a field or every later column shifts left by one.
    expect(parseCsv("a,b,c\n1,,3")[1]).toEqual(["1", "", "3"]);
  });

  it("returns no rows for empty input", () => {
    expect(parseCsv("")).toEqual([]);
  });
});

describe("defensive behaviour", () => {
  it("REJECTS input that ends inside an unterminated quote", () => {
    // Refusing is the only safe answer: after an unterminated quote every
    // field boundary is a guess, so a lenient parser would emit rows that look
    // plausible and are wrong. A rule table parsed wrongly scores every cell at
    // the multiplicative identity, which reads as "nothing is mapped here".
    expect(() => parseCsv('id,Count\nx,"unterminated')).toThrow(CsvParseError);
  });

  it("rejects a non-string input rather than coercing it", () => {
    expect(() => parseCsv(undefined as unknown as string)).toThrow(
      CsvParseError,
    );
  });
});

describe("parseCsvObjects", () => {
  it("maps rows onto header names", () => {
    const { header, rows } = parseCsvObjects("id,walkable\nx,5\n");
    expect(header).toEqual(["id", "walkable"]);
    expect(rows).toEqual([{ id: "x", walkable: "5" }]);
  });

  it("REPORTS a row whose field count disagrees with the header", () => {
    // Never padded. A short row means the file disagrees with itself, and
    // guessing which column is missing is how a rule ends up keyed on a
    // Description string.
    const { rows, malformed } = parseCsvObjects("id,a,b\nx,1,2\ny,1\n");
    expect(rows).toHaveLength(1);
    expect(malformed).toEqual([{ line: 3, fields: 2 }]);
  });

  it("reports the LINE number, so a bad row can be found in the sheet", () => {
    const { malformed } = parseCsvObjects("id,a\n1,2\n3,4\n5\n");
    expect(malformed[0]!.line).toBe(4);
  });

  it("throws on input with no header at all", () => {
    expect(() => parseCsvObjects("")).toThrow(CsvParseError);
  });
});
