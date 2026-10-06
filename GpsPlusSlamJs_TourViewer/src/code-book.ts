/**
 * The code book (code book refactor plan
 * `GpsPlusSlamJs_Docs/docs/2026-10-06-1601-tour-viewer-code-book-refactor-plan.md`,
 * M1): ONE model of every code of the open tour that authoring reads AND
 * writes, keyed by level id like every other code map in the stack
 * (`qr-level-archive.ts`). It replaces the single "code in hand" slot
 * (`ctx.mintedLevel` and friends), which let a Finish write one code and
 * routed every decision through one code. Pure and immutable: each change
 * returns a new book.
 *
 * @see code-book.ts.md
 */

import type { CodeMeasurement } from "./visit-settle.js";

/** One code of the open tour, as authoring knows it. */
interface TourCode {
  readonly levelId: string;
  /** The level file text visitors get after the next Finish: the hosted
   *  file's, a restored draft's, or one this page measured or improved;
   *  null for none. */
  readonly saved: string | null;
  /** The hosted zip's file text; null when the zip does not hold the code
   *  (or its levels have not arrived yet). */
  readonly hosted: string | null;
  /** This page's measurement of the code (its visit and printed size). */
  readonly measurement: CodeMeasurement | null;
  /** This page took the code as a reference: measured it, sighted it as a
   *  kept stored pose, or restored it from the draft (what the slot being
   *  full used to say: the placement gate and the hints read it). */
  readonly reference: boolean;
  /** The text this page's last Finish wrote for it; the hosted zip only
   *  changes when the creator uploads that file, so this - not `hosted` -
   *  tells the save guard the code is saved. */
  readonly finished: string | null;
}

export type CodeBook = ReadonlyMap<string, TourCode>;

/** A level file to write: its id and text. */
export interface LevelText {
  readonly id: string;
  readonly json: string;
}

function blank(levelId: string): TourCode {
  return {
    levelId,
    saved: null,
    hosted: null,
    measurement: null,
    reference: false,
    finished: null,
  };
}

function put(book: CodeBook, code: TourCode): CodeBook {
  const next = new Map(book);
  next.set(code.levelId, code);
  return next;
}

/**
 * The book of a tour as it opens: every hosted level (id -> file text)
 * saved as it is; a restored draft's codes on top, saved and taken as
 * references. A draft restored before the hosted levels arrive keeps its
 * codes; `withHosted` fills the hosted texts in later.
 */
export function openCodeBook(input: {
  readonly hosted: ReadonlyMap<string, string>;
  readonly draft?: readonly LevelText[];
}): CodeBook {
  let book: CodeBook = new Map();
  for (const [id, json] of input.hosted) {
    book = put(book, { ...blank(id), saved: json, hosted: json });
  }
  return withDraft(book, input.draft ?? []);
}

/** What the zip the next Finish rebuilds from holds for the code: the
 *  last Finish's text, else the hosted file's (M1 review #1 - the next
 *  Finish builds on the previous Finish's zip, not on the hosted one). */
function baseline(code: TourCode): string | null {
  return code.finished ?? code.hosted;
}

/** Work done live in this page: a measurement, or a saved pose that is
 *  not what the zip holds. */
function changedLive(code: TourCode): boolean {
  return (
    code.measurement !== null ||
    (code.saved !== null && code.saved !== baseline(code))
  );
}

/**
 * A restored draft's codes, taken as references and saved - except where
 * this page has already changed the code live: that work is newer than
 * the draft and wins (M1 review #2; the restore is a tap on an offer that
 * comes after the tour opened).
 */
export function withDraft(
  book: CodeBook,
  draft: readonly LevelText[],
): CodeBook {
  let next = book;
  for (const { id, json } of draft) {
    const code = next.get(id) ?? blank(id);
    next = put(next, {
      ...code,
      saved: changedLive(code) ? code.saved : json,
      reference: true,
    });
  }
  return next;
}

/**
 * A code to be measured again (a new printed size, M1 review #2): its
 * measurement and its reference are dropped, and its saved pose falls
 * back to what the zip holds - none for a code no Finish has written.
 */
export function withoutMeasurement(book: CodeBook, levelId: string): CodeBook {
  const code = book.get(levelId);
  if (code === undefined) return book;
  return put(book, {
    ...code,
    measurement: null,
    reference: false,
    saved: baseline(code),
  });
}

/** The hosted levels, arrived after the book was opened: each code gets
 *  its hosted text; a code with no saved pose yet takes it as saved. */
export function withHosted(
  book: CodeBook,
  hosted: ReadonlyMap<string, string>,
): CodeBook {
  let next = book;
  for (const [id, json] of hosted) {
    const code = next.get(id) ?? blank(id);
    next = put(next, { ...code, hosted: json, saved: code.saved ?? json });
  }
  return next;
}

/** A code measured in this page: its new level is the saved pose, its
 *  measurement kept, and it is a reference. */
export function withMeasurement(
  book: CodeBook,
  level: LevelText,
  measurement: CodeMeasurement,
): CodeBook {
  const code = book.get(level.id) ?? blank(level.id);
  return put(book, {
    ...code,
    saved: level.json,
    measurement,
    reference: true,
  });
}

/** A stored code taken as this page's reference (a sighting kept its
 *  stored pose); unknown ids leave the book as it is. */
export function withReference(book: CodeBook, levelId: string): CodeBook {
  const code = book.get(levelId);
  if (code === undefined || code.reference) return book;
  return put(book, { ...code, reference: true });
}

/** A settle's re-mint or improvement: the code's saved pose changes. */
export function withSaved(book: CodeBook, level: LevelText): CodeBook {
  const code = book.get(level.id) ?? blank(level.id);
  return put(book, { ...code, saved: level.json });
}

/** The codes a Finish must write: a saved pose that differs from what the
 *  zip it rebuilds from holds (`baseline`), in the book's order. */
export function codesToWrite(book: CodeBook): LevelText[] {
  return [...book.values()].flatMap((code) =>
    code.saved !== null && code.saved !== baseline(code)
      ? [{ id: code.levelId, json: code.saved }]
      : [],
  );
}

/** After a Finish that wrote `written`: those texts are saved. */
export function afterFinish(
  book: CodeBook,
  written: readonly LevelText[],
): CodeBook {
  let next = book;
  for (const { id, json } of written) {
    const code = next.get(id);
    if (code !== undefined) next = put(next, { ...code, finished: json });
  }
  return next;
}

/** The ids this page has taken as references, in the book's order. */
export function referenceCodes(book: CodeBook): string[] {
  return [...book.values()].flatMap((c) => (c.reference ? [c.levelId] : []));
}
