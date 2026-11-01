/**
 * A timing file lined up with a long text's body: the read-along track a
 * narration's `timing/<blockId>.json` carries (the framework's
 * `ar/tour-timing`), built from a subtitle file or a word list
 * (`timing-file.ts`), and what of the file and the text did not meet - the
 * file's lines (or runs of words) that are not in the text, and the text's
 * sentences no line voices - for the creator to see. The text is never
 * changed: only the track is made to fit it.
 *
 * - A subtitle file gives a SENTENCE track: each line that matches covers
 *   the stretch from its first to its last matched word. A line with fewer
 *   than half of its words in the text is listed instead, and the rest
 *   matched again without it.
 * - A word list gives a WORD track: each matched word its own segment.
 *   Each run of unmatched words is listed as one stretch.
 *
 * Words are matched by key (`word-diff.ts`), a longest common subsequence
 * of the file's words and the text's; a match none of whose neighbours
 * matches too is a chance hit and dropped (unless the text is one word).
 *
 * @see timing-import.ts.md
 */

import {
  parseTourMarkdown,
  plainTextOf,
  textHashOf,
  type TourPlainText,
} from "gps-plus-slam-app-framework/ar/tour-markdown";
import {
  TOUR_TIMING_MAX_BYTES,
  TOUR_TIMING_MAX_SEGMENTS,
  type TourTiming,
  type TourTimingGranularity,
  type TourTimingSegment,
} from "gps-plus-slam-app-framework/ar/tour-timing";

import { plainSentences, type TextSpan } from "../../long-text-sentences.js";
import { sentenceStarts } from "../../read-along.js";
import {
  readTimingFile,
  TimingFileError,
  type TimedUnit,
  type TimingFile,
  type TimingFileProblem,
} from "./timing-file.js";
import { matchWords, wordTokens } from "./word-diff.js";

/** A line of a subtitle file, or a run of a word list's words, that is not
 *  in the text; the voice still plays it, with nothing lit up. */
export interface ImportMismatch {
  /** `Line N`, `Word N` or `Words N-M`. */
  readonly label: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
}

/** A file lined up with a text, before the track names the text's hash. */
export interface LinedUpFile {
  readonly granularity: TourTimingGranularity;
  /** Ordered by `startMs`; offsets of the text's `P`. */
  readonly segments: readonly TourTimingSegment[];
  /** The file's lines (or words) and how many of them matched. */
  readonly units: number;
  readonly matchedUnits: number;
  readonly mismatches: readonly ImportMismatch[];
  /** The text's sentences no segment starts in. */
  readonly unvoiced: readonly TextSpan[];
  /** How many sentences the text has. */
  readonly sentences: number;
}

/** An import's outcome: the track (null when nothing of the file is in the
 *  text), what did not meet, and the file's own faults. */
export interface TimingImport extends LinedUpFile {
  readonly kind: TimingFile["kind"];
  readonly timing: TourTiming | null;
  readonly problems: readonly TimingFileProblem[];
}

/** A word of the file: its key, its share of its unit's time, and the
 *  unit it is from. */
interface FileWord {
  readonly key: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly unit: number;
}

/** A subtitle line is used when at least this share of its words is in
 *  the text (the prototype's rule); below it the line is listed. */
const SUBTITLE_LINE_MIN_SHARE = 0.5;

/** The words of each unit, its time split among them by their length (the
 *  prototype's rule: a longer word takes longer to say). */
function fileWords(units: readonly TimedUnit[], only?: ReadonlySet<number>) {
  const out: FileWord[] = [];
  units.forEach((unit, u) => {
    if (only !== undefined && !only.has(u)) return;
    const words = wordTokens(unit.text);
    const total = words.reduce((n, w) => n + (w.to - w.from), 0);
    const span = unit.endMs - unit.startMs;
    let done = 0;
    for (const w of words) {
      const startMs = unit.startMs + (span * done) / total;
      done += w.to - w.from;
      out.push({
        key: w.key,
        startMs,
        endMs: unit.startMs + (span * done) / total,
        unit: u,
      });
    }
  });
  return out;
}

/** For each file word, the text word it matched, or -1. */
function matchedTo(
  file: readonly FileWord[],
  text: readonly { readonly key: string }[],
): Int32Array {
  const map = new Int32Array(file.length).fill(-1);
  for (const [i, j] of matchWords(
    file.map((w) => w.key),
    text.map((w) => w.key),
  )) {
    map[i] = j;
  }
  if (text.length === 1) return map;
  const kept = new Int32Array(file.length).fill(-1);
  for (let k = 0; k < file.length; k += 1) {
    const j = map[k] as number;
    if (j < 0) continue;
    if (map[k - 1] === j - 1 || map[k + 1] === j + 1) kept[k] = j;
  }
  return kept;
}

/** Per unit, how many of its words matched and how many it has. */
function hitsPerUnit(
  units: number,
  file: readonly FileWord[],
  map: Int32Array,
): { hit: number; all: number }[] {
  const out = Array.from({ length: units }, () => ({ hit: 0, all: 0 }));
  file.forEach((w, k) => {
    const c = out[w.unit] as { hit: number; all: number };
    c.all += 1;
    if ((map[k] as number) >= 0) c.hit += 1;
  });
  return out;
}

function mismatchOf(units: readonly TimedUnit[], u0: number, u1: number) {
  const first = units[u0] as TimedUnit;
  const last = units[u1] as TimedUnit;
  return {
    label:
      u0 === u1 ? first.label : `Words ${String(u0 + 1)}-${String(u1 + 1)}`,
    startMs: first.startMs,
    endMs: last.endMs,
    text: units
      .slice(u0, u1 + 1)
      .map((u) => u.text)
      .join(" "),
  };
}

/** A subtitle file's lines as a sentence track. */
function lineUpSubtitles(
  text: string,
  words: readonly { from: number; to: number; key: string }[],
  units: readonly TimedUnit[],
) {
  let file = fileWords(units);
  let map = matchedTo(file, words);
  const counts = hitsPerUnit(units.length, file, map);
  const good = new Set<number>();
  const mismatches: ImportMismatch[] = [];
  counts.forEach(({ hit, all }, u) => {
    if (all > 0 && hit / all >= SUBTITLE_LINE_MIN_SHARE) good.add(u);
    else mismatches.push(mismatchOf(units, u, u));
  });
  if (good.size < units.length) {
    file = fileWords(units, good);
    map = matchedTo(file, words);
  }
  const spans = new Map<number, { from: number; to: number }>();
  file.forEach((w, k) => {
    const j = map[k] as number;
    if (j < 0) return;
    const word = words[j] as { from: number; to: number };
    const span = spans.get(w.unit);
    spans.set(
      w.unit,
      span === undefined
        ? { from: word.from, to: word.to }
        : { from: span.from, to: word.to },
    );
  });
  const segments: TourTimingSegment[] = [];
  for (const [u, { from, to }] of spans) {
    const unit = units[u] as TimedUnit;
    segments.push({
      startMs: unit.startMs,
      endMs: unit.endMs,
      from,
      to,
      text: text.slice(from, to),
    });
  }
  // A line that kept none of its words after the second match.
  for (const u of good) {
    if (!spans.has(u)) mismatches.push(mismatchOf(units, u, u));
  }
  mismatches.sort((a, b) => a.startMs - b.startMs);
  return { segments, mismatches, matchedUnits: spans.size };
}

/** A word list's words as a word track. */
function lineUpWords(
  text: string,
  words: readonly { from: number; to: number; key: string }[],
  units: readonly TimedUnit[],
) {
  const file = fileWords(units);
  const map = matchedTo(file, words);
  const segments: TourTimingSegment[] = [];
  const voiced = new Set<number>();
  file.forEach((w, k) => {
    const j = map[k] as number;
    if (j < 0) return;
    const word = words[j] as { from: number; to: number };
    voiced.add(w.unit);
    segments.push({
      startMs: Math.round(w.startMs),
      endMs: Math.round(w.endMs),
      from: word.from,
      to: word.to,
      text: text.slice(word.from, word.to),
    });
  });
  const mismatches: ImportMismatch[] = [];
  let run = -1;
  for (let u = 0; u <= units.length; u += 1) {
    const missed = u < units.length && !voiced.has(u);
    if (missed && run < 0) run = u;
    if (!missed && run >= 0) {
      mismatches.push(mismatchOf(units, run, u - 1));
      run = -1;
    }
  }
  return { segments, mismatches, matchedUnits: voiced.size };
}

/**
 * `file` lined up with the text whose plain text is `plain`: the segments
 * (by time), what of the file is not in the text, and the sentences of
 * the text no segment starts in. Pure.
 */
export function lineUpFile(
  plain: TourPlainText,
  file: TimingFile,
  lang = "en",
): LinedUpFile {
  const words = wordTokens(plain.text);
  const lined =
    file.kind === "subtitles"
      ? lineUpSubtitles(plain.text, words, file.units)
      : lineUpWords(plain.text, words, file.units);
  const segments = [...lined.segments].sort((a, b) => a.startMs - b.startMs);
  const sentences = plainSentences(plain.text, plain.leaves, lang);
  const starts = sentenceStarts(
    { granularity: "word", source: "file", segments, textHash: "" },
    sentences,
  );
  return {
    granularity: file.kind === "subtitles" ? "sentence" : "word",
    segments,
    units: file.units.length,
    matchedUnits: lined.matchedUnits,
    mismatches: lined.mismatches,
    unvoiced: sentences.filter((_, s) => starts[s] === -1),
    sentences: sentences.length,
  };
}

/** Whether `timing` fits a timing entry (`TOUR_TIMING_MAX_BYTES`, written
 *  as compact JSON, `TOUR_TIMING_MAX_SEGMENTS`). */
function timingFitsEntry(timing: TourTiming): boolean {
  return (
    timing.segments.length <= TOUR_TIMING_MAX_SEGMENTS &&
    new TextEncoder().encode(JSON.stringify(timing)).length <=
      TOUR_TIMING_MAX_BYTES
  );
}

/**
 * The timing file `fileText` lined up with the long text `body`: the
 * file read (`readTimingFile`), lined up (`lineUpFile`), and its track
 * named by the text's hash (`textHashOf`).
 *
 * @throws (rejects with) TimingFileError for a file that is no timing,
 *   and for a track too large for a timing entry.
 */
export async function importTiming(
  body: string,
  fileText: string,
  lang = "en",
): Promise<TimingImport> {
  const file = readTimingFile(fileText);
  const plain = plainTextOf(parseTourMarkdown(body));
  const lined = lineUpFile(plain, file, lang);
  const timing: TourTiming | null =
    lined.segments.length === 0
      ? null
      : {
          granularity: lined.granularity,
          source: "file",
          segments: lined.segments,
          textHash: await textHashOf(plain.text),
        };
  if (timing !== null && !timingFitsEntry(timing)) {
    throw new TimingFileError(
      "its timing is larger than a tour may carry for one text.",
    );
  }
  return { ...lined, kind: file.kind, timing, problems: file.problems };
}
