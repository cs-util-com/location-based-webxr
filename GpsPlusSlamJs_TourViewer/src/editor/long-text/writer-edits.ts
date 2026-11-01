/**
 * The long-text writer's formatting commands, pure: each reads the text
 * and the selection and says what to replace, so the writer can apply it
 * through the browser's own editing (its undo keeps working). Bold and
 * italic, the two heading sizes, the two lists, a list line's depth, a
 * list continued on Enter, a picture's line and a link: each writes the
 * marks the tour's reader formats (`tour-markdown.ts`), never others.
 *
 * @see writer-edits.ts.md
 */

/** One change to the text: `[from, to)` replaced by `text`, then the
 *  selection `select` counted from `from` (null: the caret after the
 *  text). */
export interface WriterEdit {
  readonly from: number;
  readonly to: number;
  readonly text: string;
  readonly select: readonly [number, number] | null;
}

/** A list line's indent, its mark and the space after it. */
export const LIST_LINE = /^(\s*)([-*+]|\d{1,3}[.)])\s+/;

/** `n` held inside `[0, max]`, a non-number as 0. */
function clampTo(n: number, max: number): number {
  return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 0), max) : 0;
}

/** The selection `[start, end]` held inside `value`, in order. */
function held(value: string, start: number, end: number): [number, number] {
  const a = clampTo(start, value.length);
  const b = clampTo(end, value.length);
  return a <= b ? [a, b] : [b, a];
}

/** The whole lines `[start, end]` touch: from the first one's start to
 *  the last one's end (before its line break). */
export function lineRange(
  value: string,
  start: number,
  end: number,
): [number, number] {
  const [a, b] = held(value, start, end);
  const from = value.lastIndexOf("\n", a - 1) + 1;
  const next = value.indexOf("\n", b);
  return [from, next < 0 ? value.length : next];
}

/** Whether a line `[start, end]` touches is a list line. */
export function touchesList(
  value: string,
  start: number,
  end: number,
): boolean {
  const [from, to] = lineRange(value, start, end);
  return value
    .slice(from, to)
    .split("\n")
    .some((line) => LIST_LINE.test(line));
}

/**
 * Bold (`**`) or italic (`*`) around the selection, its spaces left
 * outside; around words already marked, the marks taken off. With no
 * selection, the two marks with the caret between them.
 */
export function wrapInline(
  value: string,
  start: number,
  end: number,
  mark: "**" | "*",
): WriterEdit {
  let [a, b] = held(value, start, end);
  while (b > a && /\s/.test(value[b - 1] ?? "")) b--;
  while (a < b && /\s/.test(value[a] ?? "")) a++;
  const n = mark.length;
  if (a === b) return { from: a, to: b, text: mark + mark, select: [n, n] };
  const words = value.slice(a, b);
  // Italic's one star beside a bold's two is not an italic mark.
  const lone = n === 2 || (value[a - n - 1] !== "*" && value[b + n] !== "*");
  if (
    value.slice(a - n, a) === mark &&
    value.slice(b, b + n) === mark &&
    a - n >= 0 &&
    lone
  ) {
    return { from: a - n, to: b + n, text: words, select: [0, words.length] };
  }
  if (words.length > 2 * n && words.startsWith(mark) && words.endsWith(mark)) {
    const inner = words.slice(n, -n);
    return { from: a, to: b, text: inner, select: [0, inner.length] };
  }
  return {
    from: a,
    to: b,
    text: mark + words + mark,
    select: [n, n + words.length],
  };
}

/** The lines `[start, end]` touch, each transformed; null when nothing
 *  changes. */
function setLines(
  value: string,
  start: number,
  end: number,
  transform: (lines: readonly string[]) => readonly string[],
): WriterEdit | null {
  const [from, to] = lineRange(value, start, end);
  const before = value.slice(from, to);
  const after = transform(before.split("\n")).join("\n");
  return after === before
    ? null
    : { from, to, text: after, select: [after.length, after.length] };
}

/** A heading's marks at a line's start. */
const HEADING_MARKS = /^#{1,6}\s+/;

/**
 * The lines made a bulleted (`- `) or numbered (`1. `, `2. `, ...) list,
 * their indent kept and a heading's marks taken off; lines that already
 * all are that list become plain lines again. Empty lines stay.
 */
export function toggleList(
  value: string,
  start: number,
  end: number,
  kind: "bullet" | "number",
): WriterEdit | null {
  return setLines(value, start, end, (lines) => {
    const ofKind = (line: string) => {
      const m = LIST_LINE.exec(line);
      return m !== null && (kind === "number") === /\d/.test(m[2] ?? "");
    };
    const all = lines.filter((l) => l.trim() !== "").every(ofKind);
    let n = 0;
    return lines.map((line) => {
      if (line.trim() === "") return line;
      const words = line
        .replace(LIST_LINE, "$1")
        .replace(/^(\s*)#{1,6}\s+/, "$1");
      if (all) return words;
      const indent = /^\s*/.exec(words)?.[0] ?? "";
      n++;
      const mark = kind === "number" ? `${String(n)}. ` : "- ";
      return indent + mark + words.slice(indent.length);
    });
  });
}

/**
 * The lines made a heading (`## `, level 2) or a subheading (`### `,
 * level 3), a list's mark taken off; lines that already all are that
 * heading become plain lines again.
 */
export function toggleHeading(
  value: string,
  start: number,
  end: number,
  level: 2 | 3,
): WriterEdit | null {
  const exact = new RegExp(`^#{${String(level)}}\\s+`);
  return setLines(value, start, end, (lines) => {
    const all = lines
      .filter((l) => l.trim() !== "")
      .every((l) => exact.test(l));
    return lines.map((line) => {
      if (line.trim() === "") return line;
      const words = line.replace(HEADING_MARKS, "").replace(LIST_LINE, "");
      return all ? words : `${"#".repeat(level)} ${words}`;
    });
  });
}

/**
 * The list lines `[start, end]` touch moved one step in (two spaces) or
 * out; other lines stay. Null when no list line is touched or nothing
 * changes (`touchesList` tells the two apart).
 */
export function indentLines(
  value: string,
  start: number,
  end: number,
  way: "in" | "out",
): WriterEdit | null {
  if (!touchesList(value, start, end)) return null;
  return setLines(value, start, end, (lines) =>
    lines.map((line) =>
      !LIST_LINE.test(line)
        ? line
        : way === "in"
          ? `  ${line}`
          : line.replace(/^( {1,2}|\t)/, ""),
    ),
  );
}

/** A list line: its indent, its mark (a bullet, or a number and its
 *  `.` or `)`), the space after the mark and its words. */
const LIST_PARTS = /^(\s*)(?:([-*+])|(\d{1,3})([.)]))(\s+)(.*)$/;

/**
 * Enter at `caret` in a list line, past its mark: the next line starts
 * with the same mark (the next number); on a line with no words the
 * mark is taken off, which ends the list. Null where Enter is an
 * ordinary line break.
 */
export function continueList(value: string, caret: number): WriterEdit | null {
  const [at] = held(value, caret, caret);
  const [from, to] = lineRange(value, at, at);
  const m = LIST_PARTS.exec(value.slice(from, to));
  if (m === null) return null;
  const [, indent = "", bullet, digits, close, gap = "", words = ""] = m;
  const markEnd =
    from +
    indent.length +
    (bullet ?? `${digits ?? ""}${close ?? ""}`).length +
    gap.length;
  if (at < markEnd) return null;
  if (words.trim() === "") return { from, to, text: "", select: null };
  const next =
    bullet !== undefined
      ? bullet
      : `${String(Number(digits) + 1)}${close ?? "."}`;
  return { from: at, to: at, text: `\n${indent}${next} `, select: null };
}

/**
 * `text` (a picture's line) as a paragraph of its own: after the line
 * the caret is on (before it, on an empty line), with the blank lines a
 * paragraph needs, the inserted text selected.
 */
export function insertBlock(
  value: string,
  caret: number,
  text: string,
): WriterEdit {
  const [at0] = held(value, caret, caret);
  const [from, to] = lineRange(value, at0, at0);
  const at = value.slice(from, to).trim() === "" ? from : to;
  const before = value.slice(0, at);
  const after = value.slice(at);
  const pre =
    before.length === 0 || before.endsWith("\n\n")
      ? ""
      : before.endsWith("\n")
        ? "\n"
        : "\n\n";
  const post =
    after.length === 0 || after.startsWith("\n\n")
      ? ""
      : after.startsWith("\n")
        ? "\n"
        : "\n\n";
  return {
    from: at,
    to: at,
    text: pre + text + post,
    select: [pre.length, pre.length + text.length],
  };
}

/**
 * A typed web address as a link's target: `https://` put in front unless
 * it starts with `http:`, `https:` or `mailto:`; null for an empty one.
 */
export function linkTarget(typed: string): string | null {
  const url = typed.trim();
  if (url === "") return null;
  if (/^(https?:|mailto:)/i.test(url)) return url;
  return `https://${url.replace(/^\/+/, "")}`;
}

/**
 * The selected words made a link to `typed` (`[words](target)`); with
 * no words selected, the address itself is the link's words. The words
 * are selected after. Null for an empty address.
 */
export function linkEdit(
  value: string,
  start: number,
  end: number,
  typed: string,
): WriterEdit | null {
  const target = linkTarget(typed);
  if (target === null) return null;
  const [a, b] = held(value, start, end);
  const words = value.slice(a, b).trim() || target;
  return {
    from: a,
    to: b,
    text: `[${words}](${target})`,
    select: [1, 1 + words.length],
  };
}

/** `value` after `edit`, and the selection it leaves. */
export function applied(
  value: string,
  edit: WriterEdit,
): { readonly value: string; readonly selection: readonly [number, number] } {
  const out = value.slice(0, edit.from) + edit.text + value.slice(edit.to);
  const caret = edit.from + edit.text.length;
  const selection: readonly [number, number] =
    edit.select === null
      ? [caret, caret]
      : [edit.from + edit.select[0], edit.from + edit.select[1]];
  return { value: out, selection };
}
