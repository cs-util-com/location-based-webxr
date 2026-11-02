/**
 * The timing files a speech tool exports, read into timed units before
 * they are lined up with a text (`timing-import.ts`): a subtitle file
 * (WebVTT, `.vtt`: timed lines) or a word list (JSON: timed words, as a
 * bare list, `{ words }` or `{ segments: [{ words }] }`, times in
 * seconds). Defensive by contract: every malformed cue or entry is LISTED
 * (`problems`, with the line or entry it is) and the rest kept; a file
 * that is not a timing at all, or has nothing usable, throws a
 * `TimingFileError` whose message completes "Could not use <file>: ...".
 * Pure; nothing is read but the text given.
 *
 * @see timing-file.ts.md
 */

/** A file is refused above this many characters (a timing for the
 *  longest text a tour may carry is far smaller). */
export const TIMING_FILE_MAX_CHARS = 5_000_000;

/** A file is refused with more units than this. */
const TIMING_FILE_MAX_UNITS = 50_000;

/** One timed line (a cue) or word of the file. */
export interface TimedUnit {
  /** Where it is in the file: `Line N` (the cue's time line) or `Word N`
   *  (the entry, counted from 1). */
  readonly label: string;
  readonly startMs: number;
  readonly endMs: number;
  /** Its words as the file has them, tags taken out. */
  readonly text: string;
}

/** A cue or entry that could not be used, and why. */
export interface TimingFileProblem {
  readonly label: string;
  readonly message: string;
}

export interface TimingFile {
  readonly kind: "subtitles" | "words";
  readonly units: readonly TimedUnit[];
  readonly problems: readonly TimingFileProblem[];
}

/** A file that is no timing, or has no usable line; the message completes
 *  "Could not use <file>: ". */
export class TimingFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimingFileError";
  }
}

const HEADER = /^WEBVTT(?:[ \t].*)?$/u;
const TIME = String.raw`((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})`;
const TIME_LINE = new RegExp(
  String.raw`^\s*${TIME}[ \t]*-->[ \t]*${TIME}(?:[ \t].*)?$`,
  "u",
);
const TAG = /<[^>]*>/gu;
const ENTITY = /&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z]+));/giu;
const NAMED: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  lrm: "",
  rlm: "",
};
const SKIPPED_BLOCK = /^(?:NOTE|STYLE|REGION)(?:[ \t]|$)/u;

/** Milliseconds of a cue time, or null when a field is out of range. */
function cueMs(time: string): number | null {
  const [clock = "", fraction = "0"] = time.split(/[.,]/u);
  const parts = clock.split(":").map(Number);
  const s = parts.at(-1) ?? NaN;
  const m = parts.at(-2) ?? NaN;
  const h = parts.length === 3 ? (parts[0] ?? NaN) : 0;
  if (![h, m, s].every(Number.isSafeInteger) || m > 59 || s > 59) return null;
  const ms = Math.round(Number(`0.${fraction}`) * 1000);
  return ((h * 60 + m) * 60 + s) * 1000 + ms;
}

function decodeEntities(text: string): string {
  return text.replace(
    ENTITY,
    (
      whole: string,
      dec: string | undefined,
      hex: string | undefined,
      name: string | undefined,
    ) => {
      const code =
        dec !== undefined
          ? Number(dec)
          : hex !== undefined
            ? Number.parseInt(hex, 16)
            : NaN;
      if (Number.isFinite(code)) {
        return code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : whole;
      }
      return NAMED[(name ?? "").toLowerCase()] ?? whole;
    },
  );
}

function refuseTooMany(units: readonly TimedUnit[]): void {
  if (units.length > TIMING_FILE_MAX_UNITS) {
    throw new TimingFileError(
      `it has more than ${TIMING_FILE_MAX_UNITS.toLocaleString("en")} timed parts.`,
    );
  }
}

/**
 * A WebVTT file's cues: each block with a time line (an id line may come
 * before it, settings after the times), its text lines joined by a space,
 * tags taken out and entities decoded. `NOTE`, `STYLE` and `REGION`
 * blocks are skipped; any other block is listed.
 *
 * @throws TimingFileError when the first line is not `WEBVTT`, or no cue
 *   is usable.
 */
export function parseVtt(text: string): TimingFile {
  const lines = text.replace(/^\uFEFF/u, "").split(/\r\n|\r|\n/u);
  if (!HEADER.test(lines[0] ?? "")) {
    throw new TimingFileError(
      "it does not start with WEBVTT, so it is not a subtitle file.",
    );
  }
  const blank = (k: number): boolean => (lines[k] ?? "").trim() === "";
  const units: TimedUnit[] = [];
  const problems: TimingFileProblem[] = [];
  let i = 1;
  // The header block runs to the first blank line.
  while (i < lines.length && !blank(i)) i += 1;
  while (i < lines.length) {
    if (blank(i)) {
      i += 1;
      continue;
    }
    const start = i;
    const block: string[] = [];
    while (i < lines.length && !blank(i)) {
      block.push(lines[i] ?? "");
      i += 1;
    }
    const first = block[0] ?? "";
    if (SKIPPED_BLOCK.test(first)) continue;
    const at = first.includes("-->") ? 0 : 1;
    const timeLine = block[at] ?? "";
    if (!timeLine.includes("-->")) {
      problems.push({
        label: `Line ${String(start + 1)}`,
        message: "it is not a timed line",
      });
      continue;
    }
    const label = `Line ${String(start + at + 1)}`;
    const m = TIME_LINE.exec(timeLine);
    const startMs = m === null ? null : cueMs(m[1] ?? "");
    const endMs = m === null ? null : cueMs(m[2] ?? "");
    if (startMs === null || endMs === null) {
      problems.push({ label, message: "its times cannot be read" });
      continue;
    }
    if (endMs < startMs) {
      problems.push({ label, message: "it ends before it starts" });
      continue;
    }
    const words = decodeEntities(
      block
        .slice(at + 1)
        .join(" ")
        .replace(TAG, ""),
    )
      .replace(/\s+/gu, " ")
      .trim();
    if (words === "") {
      problems.push({ label, message: "it has no words" });
      continue;
    }
    units.push({ label, startMs, endMs, text: words });
    refuseTooMany(units);
  }
  if (units.length === 0) {
    throw new TimingFileError("no timed lines were found in it.");
  }
  return { kind: "subtitles", units, problems };
}

/** The entries of a word list: a bare list, `{ words }`, or the words of
 *  `{ segments }`; null for none of them. */
function entriesOf(value: unknown): readonly unknown[] | null {
  if (Array.isArray(value)) return value as unknown[];
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.words)) return record.words as unknown[];
  if (Array.isArray(record.segments)) {
    return record.segments.flatMap((s: unknown) => {
      const words =
        typeof s === "object" && s !== null
          ? (s as Record<string, unknown>).words
          : undefined;
      return Array.isArray(words) ? (words as unknown[]) : [];
    });
  }
  return null;
}

/** One entry of a word list as a unit, or why it cannot be one. */
function wordUnit(entry: unknown, label: string): TimedUnit | string {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    return "it is not a word with times";
  }
  const e = entry as Record<string, unknown>;
  const raw = typeof e.word === "string" ? e.word : e.text;
  const word = typeof raw === "string" ? raw.trim() : "";
  if (word === "") return "it has no word";
  const { start, end } = e;
  if (
    typeof start !== "number" ||
    typeof end !== "number" ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0
  ) {
    return "its times cannot be read";
  }
  if (end < start) return "it ends before it starts";
  return {
    label,
    startMs: Math.round(start * 1000),
    endMs: Math.round(end * 1000),
    text: word,
  };
}

/**
 * A word list's words: entries `{ word | text, start, end }`, times in
 * seconds, `end` not before `start`.
 *
 * @throws TimingFileError for text that is not JSON, JSON without a list
 *   of words, or a list without one usable entry.
 */
export function parseWordList(text: string): TimingFile {
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/u, ""));
  } catch {
    throw new TimingFileError("it is not a readable word list.");
  }
  const entries = entriesOf(value);
  if (entries === null) {
    throw new TimingFileError(
      "no list of words with start and end times was found in it.",
    );
  }
  const units: TimedUnit[] = [];
  const problems: TimingFileProblem[] = [];
  entries.forEach((entry, k) => {
    const label = `Word ${String(k + 1)}`;
    const unit = wordUnit(entry, label);
    if (typeof unit === "string") {
      problems.push({ label, message: unit });
      return;
    }
    units.push(unit);
    refuseTooMany(units);
  });
  if (units.length === 0) {
    throw new TimingFileError(
      "none of its entries has a word with a start and end time.",
    );
  }
  return { kind: "words", units, problems };
}

/**
 * A timing file told apart by its content (a `.vtt` named `.txt` is
 * still read): `WEBVTT` first is a subtitle file, `[` or `{` a word list.
 *
 * @throws TimingFileError for a file too large, of neither kind, or one
 *   the reader of its kind refuses.
 */
export function readTimingFile(text: string): TimingFile {
  if (typeof text !== "string") {
    throw new TimingFileError("it could not be read as text.");
  }
  if (text.length > TIMING_FILE_MAX_CHARS) {
    throw new TimingFileError("it is too large to be a timing file.");
  }
  const head = text.replace(/^\uFEFF/u, "").trimStart();
  if (head.startsWith("WEBVTT")) return parseVtt(head);
  if (head.startsWith("[") || head.startsWith("{")) return parseWordList(head);
  throw new TimingFileError(
    "it is neither a subtitle file (.vtt) nor a word list (.json).",
  );
}
