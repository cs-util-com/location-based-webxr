/**
 * A long text's read-along TIMING: which stretch of the text the narration
 * speaks when, as its own archive entry `timing/<blockId>.json` beside
 * `tour.json` (a long text's `narration.timing` names it). Its own entry,
 * not a field of the manifest, so a tour opens without reading every
 * timing: a viewer reads one only when its text opens. The signed file
 * list covers it like every other file of the archive.
 *
 * Offsets are UTF-16 code units of the body's plain text `P`
 * (`tour-markdown.ts` `plainTextOf`), never of the Markdown source, and
 * `textHash` is `textHashOf(P)`: formatting changes never break a timing,
 * a change of the words always shows.
 *
 * Two kinds of fault, kept apart on purpose:
 * - STRUCTURAL ({@link parseTourTiming} throws {@link TourTimingError}): a
 *   creator tool wrote the file, so a wrong shape is a bug to report -
 *   not an object, a missing or non-integer field, a negative number,
 *   `from >= to`, `startMs > endMs`, segments out of order, too many
 *   segments or anchors, an unknown `granularity` or `source`, `anchors`
 *   on a track that was not marked.
 * - RANGE ({@link tourTimingStaleReason}): the track no longer fits its
 *   text - an offset beyond `P`, a time beyond the narration's length, a
 *   different `textHash`. Such a track is STALE: a viewer shows the plain
 *   text, and the visitor is told nothing.
 *
 * Pure; hashing is the caller's (`textHashOf`).
 *
 * @see tour-timing.ts.md
 */

import { isRecord } from '../utils/json-guards.js';
import { TOUR_ID_PATTERN } from './tour-archive.js';

/** The archive folder holding the timing entries. */
export const TOUR_TIMING_FOLDER = 'timing';

/**
 * The most bytes a timing entry may hold. 20 000 segments at the ~75
 * bytes a compact word segment with its `text` takes (design §11: a
 * 5 000-word text is about 375 KB); a viewer refuses to read more.
 * CONTRACT: a writer writes the entry as compact JSON (no indent): the cap
 * holds 18 000-21 500 compact segments but only 11 200-12 500
 * pretty-printed ones (`tour-timing.ts.md`, "The cap, swept").
 */
export const TOUR_TIMING_MAX_BYTES = 1_500_000;

/** The most segments a track holds. */
export const TOUR_TIMING_MAX_SEGMENTS = 20_000;

/** The most anchors a marked track keeps. */
export const TOUR_TIMING_MAX_ANCHORS = 2_000;

/** How fine a track is: a word or a sentence per segment. */
export type TourTimingGranularity = 'word' | 'sentence';

/** Where a track came from: an imported timing file, or the creator's own
 *  marks while listening. */
export type TourTimingSource = 'file' | 'marked';

export interface TourTimingSegment {
  readonly startMs: number;
  readonly endMs: number;
  /** UTF-16 offsets into `P`, `from` inclusive, `to` exclusive. */
  readonly from: number;
  readonly to: number;
  /** The words the segment was made for; viewers ignore it, the editor
   *  re-anchors an edited text by it. */
  readonly text?: string;
}

/** One of the creator's marks: at `ms` the voice reached offset `at`. */
export interface TourTimingAnchor {
  readonly ms: number;
  readonly at: number;
}

export interface TourTiming {
  readonly granularity: TourTimingGranularity;
  readonly source: TourTimingSource;
  /** Ordered by `startMs`. */
  readonly segments: readonly TourTimingSegment[];
  /** Only on a `marked` track. */
  readonly anchors?: readonly TourTimingAnchor[];
  /** `"sha256:"` and 64 lowercase hex digits: `textHashOf(P)`. */
  readonly textHash: string;
}

/** A timing entry that is not a timing (a structural fault). */
export class TourTimingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TourTimingError';
  }
}

const GRANULARITIES: readonly string[] = ['word', 'sentence'];
const SOURCES: readonly string[] = ['file', 'marked'];
const TEXT_HASH = /^sha256:[0-9a-f]{64}$/;

/**
 * The archive entry of block `blockId`'s timing: `timing/<blockId>.json`.
 *
 * @throws TypeError for an id that is not a tour id (it reaches a zip
 *   path, so this fails loud rather than naming somewhere unintended).
 */
export function tourTimingEntryName(blockId: string): string {
  if (typeof blockId !== 'string' || !TOUR_ID_PATTERN.test(blockId)) {
    throw new TypeError(
      `tourTimingEntryName: unsafe block id ${JSON.stringify(blockId)}`
    );
  }
  return `${TOUR_TIMING_FOLDER}/${blockId}.json`;
}

function fault(message: string): never {
  throw new TourTimingError(message);
}

/** A non-negative safe integer at `record[field]`. */
function count(record: Record<string, unknown>, field: string, at: string) {
  const value = record[field];
  if (value === undefined) return fault(`"${at}.${field}" is missing`);
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    return fault(`"${at}.${field}" must be a whole number`);
  }
  if (value < 0) return fault(`"${at}.${field}" must not be negative`);
  return value;
}

function oneOf(
  record: Record<string, unknown>,
  field: string,
  allowed: readonly string[]
): string {
  const value = record[field];
  if (typeof value !== 'string' || !allowed.includes(value)) {
    return fault(`"${field}" must be ${allowed.join(' or ')}`);
  }
  return value;
}

function segmentOf(value: unknown, at: string): TourTimingSegment {
  if (!isRecord(value)) return fault(`"${at}" must be an object`);
  const startMs = count(value, 'startMs', at);
  const endMs = count(value, 'endMs', at);
  const from = count(value, 'from', at);
  const to = count(value, 'to', at);
  if (from >= to) return fault(`"${at}" must end after it starts (from < to)`);
  if (startMs > endMs) {
    return fault(`"${at}" must not end before it starts (startMs <= endMs)`);
  }
  const { text } = value;
  if (text !== undefined && typeof text !== 'string') {
    return fault(`"${at}.text" must be text`);
  }
  return text === undefined
    ? { startMs, endMs, from, to }
    : { startMs, endMs, from, to, text };
}

function anchorsOf(value: unknown): TourTimingAnchor[] {
  if (!Array.isArray(value)) return fault('"anchors" must be an array');
  if (value.length > TOUR_TIMING_MAX_ANCHORS) {
    return fault(
      `"anchors" must hold at most ${String(TOUR_TIMING_MAX_ANCHORS)} marks`
    );
  }
  return (value as unknown[]).map((entry, i) => {
    const at = `anchors[${String(i)}]`;
    if (!isRecord(entry)) return fault(`"${at}" must be an object`);
    return { ms: count(entry, 'ms', at), at: count(entry, 'at', at) };
  });
}

/**
 * A timing entry's parsed JSON, checked for its structure (see the
 * module's two kinds of fault). Unknown fields are ignored. Whether the
 * track still fits its text is {@link tourTimingStaleReason}'s question.
 *
 * @throws TourTimingError on a structural fault.
 */
export function parseTourTiming(value: unknown): TourTiming {
  if (!isRecord(value)) return fault('a timing must be an object');
  const granularity = oneOf(value, 'granularity', GRANULARITIES);
  const source = oneOf(value, 'source', SOURCES);
  const { textHash, segments, anchors } = value;
  if (typeof textHash !== 'string') return fault('"textHash" must be text');
  if (!Array.isArray(segments)) return fault('"segments" must be an array');
  if (segments.length > TOUR_TIMING_MAX_SEGMENTS) {
    return fault(
      `"segments" must hold at most ${String(TOUR_TIMING_MAX_SEGMENTS)} entries`
    );
  }
  const read: TourTimingSegment[] = [];
  let lastStart = 0;
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segmentOf(segments[i], `segments[${String(i)}]`);
    if (segment.startMs < lastStart) {
      return fault(
        `"segments[${String(i)}]" starts before the one before it (segments are ordered by startMs)`
      );
    }
    lastStart = segment.startMs;
    read.push(segment);
  }
  const timing = {
    granularity: granularity as TourTimingGranularity,
    source: source as TourTimingSource,
    segments: read,
    textHash,
  };
  if (anchors === undefined) return timing;
  if (source !== 'marked') {
    return fault('"anchors" belong to a marked track only');
  }
  return { ...timing, anchors: anchorsOf(anchors) };
}

/**
 * A timing entry's text (UTF-8, as read from the archive), parsed.
 *
 * @throws TourTimingError when it is longer than
 *   {@link TOUR_TIMING_MAX_BYTES} UTF-16 units (more bytes than that, so
 *   the read's own byte cap would have refused it), is not JSON, or has a
 *   structural fault.
 */
export function parseTourTimingText(text: string): TourTiming {
  if (typeof text !== 'string') return fault('a timing must be text');
  if (text.length > TOUR_TIMING_MAX_BYTES) {
    return fault(
      `a timing must be at most ${String(TOUR_TIMING_MAX_BYTES)} bytes`
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return fault('a timing must be JSON');
  }
  return parseTourTiming(value);
}

/** What a track is checked against: its text's `P` (its length), the
 *  `textHashOf(P)` the caller computed, and the narration's length when
 *  the tour gives one. */
export interface TourTimingText {
  readonly plainLength: number;
  readonly textHash: string;
  readonly durationMs?: number;
}

/**
 * Why `timing` does not fit its text (it is STALE), or null when it does:
 * a track without segments, a hash that is not `"sha256:"` and 64
 * lowercase hex or differs from the text's, an offset beyond `P`, or a
 * time beyond the narration's length. Never throws.
 */
export function tourTimingStaleReason(
  timing: TourTiming,
  text: TourTimingText
): string | null {
  if (timing.segments.length === 0) return 'the track has no segments';
  if (!TEXT_HASH.test(timing.textHash)) {
    return 'the track names its text by a hash of an unknown kind';
  }
  if (timing.textHash !== text.textHash) {
    return 'the text changed after the track was made';
  }
  const duration = text.durationMs;
  for (const segment of timing.segments) {
    if (segment.to > text.plainLength) {
      return 'a segment reaches beyond the text';
    }
    if (duration !== undefined && segment.endMs > duration) {
      return 'a segment ends after the narration';
    }
  }
  return null;
}
