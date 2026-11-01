/**
 * What the long text's Narration section says (the "in the inspector"
 * prototype's section, `public/prototypes/longtext-editor-1-in-the-
 * inspector/`), page-free: the line on its head ("Reads along, 2:41"),
 * why a timing no longer fits an edited text - each sentence it no longer
 * voices, in the creator's words ("you changed "brigde" to "bridge"") -
 * and what an import or a lining up again did. The section draws these;
 * the words and the rules live here, so they are tested without a page.
 *
 * @see narration-status.ts.md
 */

import {
  parseTourMarkdown,
  plainTextOf,
  textHashOf,
} from "gps-plus-slam-app-framework/ar/tour-markdown";
import {
  parseTourTimingText,
  tourTimingStaleReason,
  type TourTiming,
} from "gps-plus-slam-app-framework/ar/tour-timing";

import {
  plainSentences,
  sentenceHolding,
  type TextSpan,
} from "../../long-text-sentences.js";
import { clockText, sentenceStarts } from "../../read-along.js";
import { truncated } from "../truncated.js";
import { reAnchorSegments, type LinedUpAgain } from "./re-anchor.js";
import type { ImportMismatch, TimingImport } from "./timing-import.js";
import { matchWords, wordTokens } from "./word-diff.js";

/** `one` for 1, else `many` (`one` + "s" by default). */
export function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

/** A line of a list the section shows, with the stretch of the text its
 *  "Show" link selects (null: none to show). */
export interface NarrationNote {
  readonly kind:
    "changed" | "new" | "rewritten" | "taken-out" | "unvoiced" | "file";
  readonly text: string;
  readonly from: number | null;
  readonly to: number | null;
}

/** What the voice and its timing are, as the section reads them. */
export interface NarrationFacts {
  readonly hasVoice: boolean;
  /** The voice's length (`narration.durationMs`), when known. */
  readonly durationMs: number | null;
  /** The timing entry's text; null: the narration has no timing. */
  readonly timingText: string | null;
}

export interface NarrationStatus {
  /** The line on the section's head. */
  readonly summary: string;
  readonly tone: "" | "ok" | "amber";
  /** The timing as read; null without one, or when it does not read. */
  readonly timing: TourTiming | null;
  /** The timing fits the text but not the voice, or does not read: why,
   *  in the creator's words. */
  readonly problem: string | null;
  /** The text was edited after the timing was made. */
  readonly stale: {
    /** How many sentences it no longer voices as they are now. */
    readonly count: number;
    readonly items: readonly NarrationNote[];
  } | null;
  /** The text's sentences the timing does not voice (a timing that fits). */
  readonly unvoiced: readonly NarrationNote[];
}

const quoted = (text: string, n = 70) =>
  `"${truncated(text.replace(/\s+/g, " ").trim(), n)}"`;

/** What changed between the words a voice says (`was`) and the text that
 *  stands there now, in the prototype's words. */
export function changeWords(was: string, now: string): string {
  const old = wordTokens(was);
  const fresh = wordTokens(now);
  const pairs = matchWords(
    old.map((w) => w.key),
    fresh.map((w) => w.key),
  );
  const keptOld = new Set(pairs.map(([i]) => i));
  const keptNew = new Set(pairs.map(([, j]) => j));
  const removed = old
    .filter((_, i) => !keptOld.has(i))
    .map((w) => was.slice(w.from, w.to));
  const added = fresh
    .filter((_, j) => !keptNew.has(j))
    .map((w) => now.slice(w.from, w.to));
  if (removed.length === 1 && added.length === 1) {
    return `you changed "${removed[0] ?? ""}" to "${added[0] ?? ""}"`;
  }
  if (removed.length === 0 && added.length > 0) {
    return `you added "${truncated(added.join(" "), 40)}"`;
  }
  if (removed.length > 0 && added.length === 0) {
    return `you took out "${truncated(removed.join(" "), 40)}"`;
  }
  return "you changed a few words";
}

/**
 * Why `timing` no longer fits the text `P`: each sentence it voices
 * differently now and each part of the voice no longer in the text, read
 * as a lining up again would (`reAnchorSegments`) - a sentence whose
 * words kept their voice around an edit is "changed", one the voice does
 * not reach is "rewritten" when a lost part of the voice stood where it
 * stands and "new" otherwise, and a lost part with no sentence in its
 * place is "taken out". Pure.
 */
function staleNotes(
  timing: TourTiming,
  text: string,
  sentences: readonly TextSpan[],
): NarrationNote[] {
  const moved = reAnchorSegments(timing, text);
  const starts = sentenceStarts(
    { ...timing, segments: moved.segments },
    sentences,
  );
  const notes: { at: number; note: NarrationNote }[] = [];
  // The changed sentences, one note each: the words a segment's voice
  // says differently now, and the words no segment covers (added beside
  // the voiced ones, which change no segment's words).
  const bySentence = new Map<number, string[][]>();
  const add = (s: number, was: string, now: string) => {
    bySentence.set(s, [...(bySentence.get(s) ?? []), [was, now]]);
  };
  for (const c of moved.changed) {
    const s = sentenceHolding({ sentences }, c.from);
    if (s >= 0) add(s, c.was, text.slice(c.from, c.to));
  }
  sentences.forEach((span, s) => {
    if (starts[s] === -1) return;
    const added = wordTokens(text.slice(span.from, span.to))
      .map((w) => ({ from: span.from + w.from, to: span.from + w.to }))
      .filter(
        (w) =>
          !moved.segments.some((seg) => seg.from <= w.from && w.to <= seg.to),
      )
      .map((w) => text.slice(w.from, w.to));
    if (added.length > 0) add(s, "", added.join(" "));
  });
  for (const [s, changes] of bySentence) {
    const span = sentences[s] as TextSpan;
    const was = changes.map(([w]) => w).join(" ");
    const now = changes.map(([, n]) => n).join(" ");
    notes.push({
      at: span.from,
      note: {
        kind: "changed",
        text: `${quoted(text.slice(span.from, span.to))}: ${changeWords(was, now)}.`,
        from: span.from,
        to: span.to,
      },
    });
  }
  // The voice's times around a stretch of the text: the last kept
  // segment before it, the first after it.
  const kept = [...moved.segments].sort((a, b) => a.from - b.from);
  const timesAround = (from: number, to: number) => {
    let before = -Infinity;
    let after = Infinity;
    for (const seg of kept) {
      if (seg.to <= from) before = Math.max(before, seg.endMs);
      else if (seg.from >= to) after = Math.min(after, seg.startMs);
    }
    return { before, after };
  };
  const lost = [...moved.lost].sort((a, b) => a.startMs - b.startMs);
  const used = new Set<number>();
  sentences.forEach((span, s) => {
    if (starts[s] !== -1) return;
    const { before, after } = timesAround(span.from, span.to);
    let replaced = false;
    lost.forEach((l, k) => {
      if (!used.has(k) && l.startMs >= before && l.endMs <= after) {
        used.add(k);
        replaced = true;
      }
    });
    const shown = quoted(text.slice(span.from, span.to));
    notes.push({
      at: span.from,
      note: replaced
        ? {
            kind: "rewritten",
            text: `Rewritten: ${shown}.`,
            from: span.from,
            to: span.to,
          }
        : {
            kind: "new",
            text: `New: ${shown}. The voice does not read it yet.`,
            from: span.from,
            to: span.to,
          },
    });
  });
  // What is left of the lost voice: runs with no kept segment between
  // them in time, each where the text goes on after it.
  const runs: { endMs: number; words: string[] }[] = [];
  for (const [k, l] of lost.entries()) {
    if (used.has(k)) continue;
    const last = runs[runs.length - 1];
    if (
      last === undefined ||
      kept.some((seg) => seg.startMs >= last.endMs && seg.endMs <= l.startMs)
    ) {
      runs.push({ endMs: l.endMs, words: [l.text] });
    } else {
      last.endMs = Math.max(last.endMs, l.endMs);
      last.words.push(l.text);
    }
  }
  for (const r of runs) {
    // Where it stood: before the first kept segment voiced after it.
    const next = kept
      .filter((seg) => seg.startMs >= r.endMs)
      .sort((a, b) => a.startMs - b.startMs)[0];
    const at = next?.from ?? text.length;
    notes.push({
      at,
      note: {
        kind: "taken-out",
        text: `Taken out: ${quoted(r.words.join(" "))}. The voice still reads it.`,
        from: next === undefined ? null : at,
        to: next === undefined ? null : at,
      },
    });
  }
  return notes.sort((a, b) => a.at - b.at).map((n) => n.note);
}

/** The text's sentences no segment of `timing` starts in, as notes. */
function unvoicedNotes(
  timing: TourTiming,
  text: string,
  sentences: readonly TextSpan[],
): NarrationNote[] {
  const starts = sentenceStarts(timing, sentences);
  return sentences.flatMap((span, s) =>
    starts[s] === -1
      ? [
          {
            kind: "unvoiced" as const,
            text: `${quoted(text.slice(span.from, span.to))} has no voice.`,
            from: span.from,
            to: span.to,
          },
        ]
      : [],
  );
}

const NONE = {
  timing: null,
  problem: null,
  stale: null,
  unvoiced: [],
} as const;

/**
 * The section's state for a long text `body` and its narration `facts`:
 * no voice, a voice without timing, a timing that does not read or does
 * not fit the voice, one the text has moved away from (`stale`, with its
 * notes), or one that reads along (with the sentences it leaves
 * unvoiced). Never throws.
 */
export async function narrationStatus(
  body: string,
  facts: NarrationFacts,
  lang = "en",
): Promise<NarrationStatus> {
  if (!facts.hasVoice) return { ...NONE, summary: "No voice yet", tone: "" };
  if (facts.timingText === null) {
    return { ...NONE, summary: "Voice, no timing yet", tone: "" };
  }
  let timing: TourTiming;
  try {
    timing = parseTourTimingText(facts.timingText);
  } catch {
    return {
      ...NONE,
      summary: "The timing does not read",
      tone: "amber",
      problem:
        "The tour's timing for this text is damaged. Import a new timing; the voice still plays.",
    };
  }
  const plain = plainTextOf(parseTourMarkdown(body));
  const sentences = plainSentences(plain.text, plain.leaves, lang);
  const textHash = await textHashOf(plain.text);
  const reason = tourTimingStaleReason(timing, {
    plainLength: plain.text.length,
    textHash,
  });
  if (reason !== null) {
    const items = staleNotes(timing, plain.text, sentences);
    const count = items.length;
    return {
      ...NONE,
      timing,
      summary:
        count === 0
          ? "Needs lining up"
          : `Needs lining up: ${String(count)} ${plural(count, "sentence")}`,
      tone: "amber",
      stale: { count, items },
    };
  }
  const late =
    facts.durationMs === null
      ? null
      : tourTimingStaleReason(timing, {
          plainLength: plain.text.length,
          textHash,
          durationMs: facts.durationMs,
        });
  if (late !== null) {
    return {
      ...NONE,
      timing,
      summary: "The timing runs past the voice",
      tone: "amber",
      problem:
        "The timing goes on after the voice file ends: it was made for another recording. Import the timing of this voice.",
    };
  }
  const unvoiced = unvoicedNotes(timing, plain.text, sentences);
  const length =
    facts.durationMs === null ? "" : `, ${clockText(facts.durationMs)}`;
  const notes =
    unvoiced.length === 0
      ? ""
      : ` · ${String(unvoiced.length)} ${plural(unvoiced.length, "note")}`;
  return {
    ...NONE,
    timing,
    summary: `Reads along${length}${notes}`,
    tone: "ok",
    unvoiced,
  };
}

/** A card the section shows once after an import or a lining up again. */
export interface NarrationResult {
  readonly title: string;
  readonly text: string;
  /** Not everything lined up: the card is marked as partial. */
  readonly partial: boolean;
  /** The file's parts not in the text, listed under the card. */
  readonly notes: readonly NarrationNote[];
}

/** A file's part not in the text, as a note. */
function mismatchNote(m: ImportMismatch): NarrationNote {
  return {
    kind: "file",
    text: `${m.label} of the file · ${clockText(m.startMs)}-${clockText(m.endMs)} ${quoted(m.text, 60)} is not in your text.`,
    from: null,
    to: null,
  };
}

/** What an import of `fileName` did, in the prototype's words. */
export function importResult(
  fileName: string,
  done: TimingImport,
): NarrationResult {
  const subtitles = done.kind === "subtitles";
  const mism = done.mismatches.length;
  const noVoice = done.unvoiced.length;
  let text = subtitles
    ? `${String(done.matchedUnits)} of ${String(done.units)} ${plural(done.units, "line")} of the file match your text.`
    : `The word list lines up with your text${mism > 0 ? ", except for the words below" : ""}.`;
  if (mism > 0) {
    const what = subtitles
      ? plural(mism, "line does", "lines do")
      : plural(mism, "stretch does", "stretches do");
    text += ` ${String(mism)} ${what} not match your text; ${mism === 1 ? "it is" : "they are"} listed below. The voice still plays ${mism === 1 ? "it" : "them"}, with nothing lit up.`;
  }
  text +=
    noVoice > 0
      ? ` ${String(noVoice)} ${plural(noVoice, "sentence")} of your text ${noVoice === 1 ? "has" : "have"} no voice.`
      : " Every sentence of your text has its voice.";
  if (done.problems.length > 0) {
    const n = done.problems.length;
    text += ` ${String(n)} ${plural(n, "part")} of the file could not be read: ${done.problems
      .slice(0, 3)
      .map((p) => `${p.label} (${p.message})`)
      .join("; ")}${n > 3 ? "; ..." : ""}.`;
  }
  return {
    title: `Imported ${fileName}`,
    text,
    partial: mism > 0 || noVoice > 0 || done.problems.length > 0,
    notes: done.mismatches.map(mismatchNote),
  };
}

/** What lining the voice up again did, in the prototype's words. */
export function lineUpResult(done: LinedUpAgain): NarrationResult {
  const total = done.sentences;
  const notMatched = done.unvoiced.length;
  const voiced = total - notMatched;
  const adjusted = done.adjusted;
  let text = `${String(voiced)} of ${String(total)} ${plural(total, "sentence")} ${voiced === 1 ? "has its" : "have their"} voice.`;
  if (adjusted > 0) {
    text +=
      adjusted === 1
        ? " The part you edited keeps its voice: the words around the change set the timing."
        : ` The ${String(adjusted)} parts you edited keep their voice: the words around the change set the timing.`;
  }
  text +=
    notMatched > 0
      ? ` ${String(notMatched)} ${plural(notMatched, "sentence")} could not be matched: visitors see ${notMatched === 1 ? "it" : "them"} without the highlight, and the rest reads along as before. To give ${notMatched === 1 ? "it" : "them"} a voice, record that part again and import a new timing.`
      : " Nothing was lost.";
  return {
    title: "Lined up again",
    text,
    partial: notMatched > 0,
    notes: [],
  };
}
