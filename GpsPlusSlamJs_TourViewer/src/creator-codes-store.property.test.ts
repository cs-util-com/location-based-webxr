/**
 * The codes in the store against the codes as they were (debug-captures
 * plan M3a): `creator-codes.ts` is a facade over the tour document's
 * `codes` and the page's `creatorCodes` slice now, whose reducers apply
 * `code-book.ts`'s rules. Its reference model is the module as it was
 * before the move - closure state over the same rules
 * (`test-support/creator-codes-reference.ts`). A settle's codes (plan
 * M3b) are compared with it too; their undo, which it cannot express, is
 * a property of its own on the store alone.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";

import { wireCreatorCodes, type CreatorCodes } from "./creator-codes.js";
import { wireReferenceCodes } from "./test-support/creator-codes-reference.js";
import { tourOf } from "./test-support/tour-of.js";
import { tourDocumentActions } from "./tour-document.js";
import {
  createTourViewerSession,
  type TourViewerSession,
} from "./tour-viewer-session.js";
import type { CodeMeasurement, CodeSighting } from "./visit-settle.js";

const IDS = ["a", "b", "c"] as const;

/** A level text whose `storedGeo` reads, one per code and version - and
 *  version 3 a text that does not parse (a level file can be broken). */
function text(id: string, v: number): string {
  if (v === 3) return `broken-${id}`;
  return JSON.stringify({
    version: 1,
    qr: {
      text: `https://example.invalid/?qr=${id}`,
      physicalSizeM: 0.16,
      geo: {
        lat: 47 + IDS.indexOf(id as (typeof IDS)[number]) * 0.1 + v * 0.01,
        lon: 8.7,
        alt: 400,
        rotation: [0, 0, 0, 1],
      },
    },
  });
}

function measurement(id: string, visit: number): CodeMeasurement {
  return {
    levelId: id,
    text: `https://example.invalid/?qr=${id}`,
    odomPose: { position: [visit, 0, 0], rotation: [0, 0, 0, 1] },
    sizeM: 0.16,
    visit,
  };
}

function sighting(id: string, x: number): CodeSighting {
  return {
    text: `https://example.invalid/?qr=${id}`,
    levelId: id,
    odomPose: { position: [x, 0, 0], rotation: [0, 0, 0, 1] },
  };
}

function tourLevel(id: string, withGeo: boolean): QrLevel {
  return {
    qr: {
      text: `https://example.invalid/?qr=${id}`,
      physicalSizeM: 0.16,
      ...(withGeo
        ? { geo: { lat: 47.9, lon: 8.7, alt: 400, rotation: [0, 0, 0, 1] } }
        : {}),
    },
  } as unknown as QrLevel;
}

type Op =
  | { kind: "measure"; id: string; v: number; visit: number }
  | { kind: "keep" | "save" | "restoreHand"; id: string; v: number }
  | { kind: "restore"; levels: { id: string; v: number }[] }
  | { kind: "drop" | "forget"; id: string }
  | { kind: "sight" | "noteStored"; id: string; visit: number; x: number }
  | { kind: "emptyHand"; visit: number }
  | {
      kind:
        | "clear"
        | "finish"
        | "endVisit"
        | "reset"
        | "levelsFail"
        | "lateFail"
        | "nextOpen"
        | "opened"
        | "closed"
        | "undone";
    }
  | {
      kind: "levelsArrive" | "levelsLate";
      levels: { id: string; v: number }[];
    }
  | { kind: "renamed"; n: number }
  | { kind: "tourLevels"; ids: { id: string; geo: boolean }[] }
  | { kind: "settle"; levels: { id: string; v: number }[] };

const id = fc.constantFrom(...IDS);
const v = fc.nat(3);
const visit = fc.nat(1);
const levels = fc.array(fc.record({ id, v }), { maxLength: 3 });
const op: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ kind: fc.constant("measure" as const), id, v, visit }),
  fc.record({
    kind: fc.constantFrom(
      "keep" as const,
      "save" as const,
      "restoreHand" as const,
    ),
    id,
    v,
  }),
  fc.record({ kind: fc.constant("restore" as const), levels }),
  fc.record({ kind: fc.constantFrom("drop" as const, "forget" as const), id }),
  fc.record({
    kind: fc.constantFrom("sight" as const, "noteStored" as const),
    id,
    visit,
    x: fc.nat(2),
  }),
  fc.record({ kind: fc.constant("emptyHand" as const), visit }),
  fc.record({
    kind: fc.constantFrom(
      "clear" as const,
      "finish" as const,
      "endVisit" as const,
      "reset" as const,
      "levelsFail" as const,
      "lateFail" as const,
      "nextOpen" as const,
      "opened" as const,
      "closed" as const,
      "undone" as const,
    ),
  }),
  fc.record({
    kind: fc.constantFrom("levelsArrive" as const, "levelsLate" as const),
    levels,
  }),
  fc.record({ kind: fc.constant("renamed" as const), n: fc.nat(2) }),
  fc.record({
    kind: fc.constant("tourLevels" as const),
    ids: fc.uniqueArray(fc.record({ id, geo: fc.boolean() }), {
      selector: (l) => l.id,
      maxLength: 3,
    }),
  }),
);

/** The steps above with settles among them (plan M3b), and no undo: the
 *  closure module cannot say what an undo of a settle does (see below). */
const opWithSettle: fc.Arbitrary<Op> = fc.oneof(
  { arbitrary: op.filter((o) => o.kind !== "undone"), weight: 4 },
  {
    arbitrary: fc.record({ kind: fc.constant("settle" as const), levels }),
    weight: 1,
  },
);

/** What the page does around the codes, each side its own way. */
interface Page {
  /** The open tour's level files arrived (null: they could not be read). */
  levels(texts: ReadonlyMap<string, string> | null): void;
  /** Another tour opens: the closing one's level files go. */
  nextOpen(): void;
  /** The answer of an older open, arriving after a newer open began. */
  late(texts: ReadonlyMap<string, string> | null): void;
  /** A tour document action that is not a code action: the store's
   *  side dispatches it, the closure module never saw one. */
  document(act: (ctx: TourViewerSession) => void): void;
  /** A settle re-minted `levels` (`creator-settle.ts`, through
   *  `applySettle`). */
  settle(
    codes: CreatorCodes,
    levels: readonly { id: string; json: string }[],
  ): void;
}

type Apply = {
  [K in Op["kind"]]: (
    codes: CreatorCodes,
    o: Op & { kind: K },
    page: Page,
  ) => unknown;
};

const textsOf = (levels: { id: string; v: number }[]) =>
  new Map(levels.map((l) => [l.id, text(l.id, l.v)]));

/** One op on a codes module, by its kind. */
const APPLY: Apply = {
  measure: (codes, o) => {
    codes.setInHand(
      { id: o.id, json: text(o.id, o.v) },
      measurement(o.id, o.visit),
    );
  },
  keep: (codes, o) => {
    codes.setInHand({ id: o.id, json: text(o.id, o.v) }, null);
  },
  emptyHand: (codes, o) => {
    codes.setInHand(null, measurement("a", o.visit));
  },
  save: (codes, o) => {
    codes.saveLevel({ id: o.id, json: text(o.id, o.v) });
  },
  // Its answer (taken, or a hand already held) is compared too.
  restoreHand: (codes, o) =>
    codes.restoreInHand({ id: o.id, json: text(o.id, o.v) }),
  restore: (codes, o) => {
    codes.restoreLevels(
      o.levels.map((l) => ({ id: l.id, json: text(l.id, l.v) })),
    );
  },
  drop: (codes, o) => {
    codes.dropMeasurement(o.id);
  },
  forget: (codes, o) => {
    codes.forgetSightings(o.id);
  },
  sight: (codes, o) => {
    codes.setSighting(sighting(o.id, o.x));
  },
  noteStored: (codes, o) => {
    codes.noteStoredSighting(o.id, o.visit, sighting(o.id, o.x));
  },
  clear: (codes) => {
    codes.clearInHand();
  },
  finish: (codes) => {
    codes.finished(codes.toWrite());
  },
  endVisit: (codes) => {
    codes.endVisit();
  },
  reset: (codes) => {
    codes.reset();
  },
  levelsArrive: (_codes, o, page) => {
    page.levels(textsOf(o.levels));
  },
  // A failed read: no texts for this open (archive-open sets the failure
  // on an open whose texts never came).
  levelsFail: (_codes, _o, page) => {
    page.levels(null);
  },
  levelsLate: (_codes, o, page) => {
    page.late(textsOf(o.levels));
  },
  lateFail: (_codes, _o, page) => {
    page.late(null);
  },
  nextOpen: (_codes, _o, page) => {
    page.nextOpen();
  },
  // The document's own life - an open, a close, an edit and its undo -
  // leaves the codes as they are: they have no history step and are not
  // reset by an open or a close.
  opened: (_codes, _o, page) => {
    page.document((ctx) => {
      ctx.store.dispatch(tourDocumentActions.opened({ manifest: tourOf([]) }));
    });
  },
  closed: (_codes, _o, page) => {
    page.document((ctx) => {
      ctx.store.dispatch(tourDocumentActions.closed());
    });
  },
  undone: (_codes, _o, page) => {
    page.document((ctx) => {
      ctx.store.dispatch(tourDocumentActions.undone());
    });
  },
  renamed: (_codes, o, page) => {
    page.document((ctx) => {
      ctx.tourDocument.rename(`Tour ${String(o.n)}`);
    });
  },
  // Handled by the caller: both sides read the same plain field.
  tourLevels: () => undefined,
  // Its answer is not compared: the store's names the document's step,
  // the closure module held no document.
  settle: (codes, o, page) => {
    page.settle(
      codes,
      o.levels.map((l) => ({ id: l.id, json: text(l.id, l.v) })),
    );
  },
};

function apply(codes: CreatorCodes, o: Op, page: Page): unknown {
  return (APPLY[o.kind] as (c: CreatorCodes, op: Op, p: Page) => unknown)(
    codes,
    o,
    page,
  );
}

/** Everything a caller can read of a codes module. */
function observe(codes: CreatorCodes): unknown {
  return {
    inHand: codes.inHand(),
    measurement: codes.measurement(),
    sighting: codes.sighting(),
    ids: codes.ids(),
    numbering: codes.numbering(),
    references: codes.references(),
    storedPoses: codes.storedPoses(),
    toWrite: codes.toWrite(),
    notHosted: codes.notHosted(),
    storedSightings: [...codes.storedSightings()],
    visitCodes: [codes.visitCodes(0), codes.visitCodes(1)],
    perCode: IDS.map((c) => ({
      savedText: codes.savedText(c),
      inBook: codes.inBook(c),
      hasStoredPose: codes.hasStoredPose(c),
      measuredIn: [codes.measuredIn(c, 0), codes.measuredIn(c, 1)],
    })),
  };
}

/**
 * Runs `ops` on the store's codes and on the closure module's, and
 * compares every observable after every step. `openAtStart` opens a tour
 * before the first step (a settle runs only in a visit of an open tour).
 */
function compareWithReference(ops: readonly Op[], openAtStart: boolean): void {
  const ctx = createTourViewerSession();
  if (openAtStart) ctx.tourDocument.open(tourOf([]));
  const model = {
    currentLevels: null as ReadonlyMap<string, QrLevel> | null,
    currentLevelTexts: null as ReadonlyMap<string, string> | null,
    levelsUnreadable: false,
  };
  /** A settle runs only in a visit of an open tour: both sides skip one
   *  the page could not start, the same precondition read for both. */
  const tourOpen = (): boolean => ctx.tourDocument.manifest() !== null;
  // The store's side: the session's level fields (each write a dispatch
  // for the running open), and an older open's late answer dispatched for
  // its own open, as archive-open does.
  const storePage: Page = {
    levels: (texts) => {
      if (texts === null) {
        ctx.currentLevelTexts = null;
        ctx.levelsUnreadable = true;
      } else {
        ctx.currentLevelTexts = texts;
      }
    },
    nextOpen: () => {
      ctx.openGeneration += 1;
      ctx.currentLevelTexts = null;
    },
    late: (texts) => {
      const session = ctx.openGeneration - 1;
      ctx.store.dispatch(
        texts === null
          ? tourDocumentActions.levelsUnreadable({ session })
          : tourDocumentActions.levelsArrived({
              session,
              texts: [...texts].map(([key, json]) => ({
                id: key,
                json,
              })),
            }),
      );
    },
    document: (act) => {
      act(ctx);
    },
    settle: (codes, levels) => {
      if (!tourOpen()) return;
      codes.applySettle(ctx.tourDocument.settleBatch(), levels, "the settle");
    },
  };
  // The closure module's side: plain fields. An open's answer is its last
  // one (archive-open gives each open one; the property may give several),
  // a new open starts with none - texts and parsed levels alike, as
  // archive-open's teardown clears both (the store's parsed levels are held
  // per open since plan M3b) - and an older open's late answer was dropped
  // by archive-open's own guard. A settle saves its codes in the module
  // and commits nothing: the module held no document.
  const modelPage: Page = {
    levels: (texts) => {
      model.currentLevelTexts = texts;
      model.levelsUnreadable = texts === null;
    },
    nextOpen: () => {
      model.currentLevels = null;
      model.currentLevelTexts = null;
      model.levelsUnreadable = false;
    },
    late: () => undefined,
    document: () => undefined,
    settle: (codes, levels) => {
      if (!tourOpen()) return;
      codes.applySettle({ commit: () => null }, levels, "the settle");
    },
  };
  let heard = 0;
  let modelHeard = 0;
  const codes = wireCreatorCodes({
    ctx,
    onIdsChanged: () => {
      heard += 1;
    },
  });
  const reference = wireReferenceCodes({
    ctx: model,
    onIdsChanged: () => {
      modelHeard += 1;
    },
  });
  for (const [step, o] of ops.entries()) {
    if (o.kind === "tourLevels") {
      const tour = new Map(o.ids.map((l) => [l.id, tourLevel(l.id, l.geo)]));
      ctx.currentLevels = tour;
      model.currentLevels = tour;
    }
    const answer = apply(codes, o, storePage);
    const modelAnswer = apply(reference, o, modelPage);
    const where = `after step ${String(step)} (${o.kind})`;
    expect(answer, `${where}: the call's answer`).toEqual(modelAnswer);
    expect(observe(codes), where).toEqual(observe(reference));
    expect(ctx.levelsUnreadable, `${where}: levels unreadable`).toBe(
      model.levelsUnreadable,
    );
    expect(heard, `${where}: the print panel's notices`).toBe(modelHeard);
    expect(
      ctx.currentLevelTexts === null ? null : [...ctx.currentLevelTexts],
      `${where}: the hosted texts`,
    ).toEqual(
      model.currentLevelTexts === null ? null : [...model.currentLevelTexts],
    );
  }
}

describe("creator-codes: the store keeps every rule of the codes as they were", () => {
  // Why this test matters: the move into the store spreads one closure's
  // rules over two slices and a facade - the hand's text winning, live
  // work beating a draft, the two baselines, the lazy hosted texts, the
  // resets, the measurements per code, the print panel's notices. A
  // characterization test pins each rule at a few points; this compares
  // EVERY observable of the facade with the module as it was, after every
  // step of any sequence of the page's calls, so a rule that drifted in
  // one reducer is caught wherever it shows. The sequence also opens,
  // closes, edits and undoes the tour document and starts later opens
  // whose predecessors answer late: the codes must survive the first, and
  // an older open's answer must never land (the store's session guard).
  it("reads exactly as the closure module did after every step, for any sequence (model-based property)", () => {
    expect.hasAssertions();
    fc.assert(
      fc.property(fc.array(op, { maxLength: 30 }), (ops) => {
        compareWithReference(ops, false);
      }),
      { numRuns: 300 },
    );
  });
});

describe("creator-codes: a settle's codes (plan M3b, Q-D)", () => {
  // Why this test matters: a settle saves its re-minted codes through the
  // document's one compound step now, not through the book's own action.
  // The closure module expresses that half - a settle reads as its codes
  // saved in order, the hand taking a code's new text only if it held that
  // code, the print panel told once - so the sequences above, settles
  // among them, are compared with it after every step. A tour is open from
  // the start, so most settles run.
  //
  // It cannot express the settle's UNDO: the module as it was held no
  // history, and an undo that left its codes as they were is the bug the
  // compound step fixes. So these sequences undo nothing, and the undo has
  // its own property, below, on the store alone.
  it("reads exactly as the closure module did with settles among the steps (model-based property)", () => {
    expect.hasAssertions();
    fc.assert(
      fc.property(fc.array(opWithSettle, { maxLength: 30 }), (ops) => {
        compareWithReference(ops, true);
      }),
      { numRuns: 300 },
    );
  });

  // Why this test matters: an undo of a settle must take back each code's
  // text with the moves, and the hand - whose text wins at every change
  // of the book - must let go of a code the undo took back, or it would
  // put the settle's text back at the next write. A hand on a code the
  // settle did not change is live work the undo says nothing about. Tested
  // directly, for any book, hand and settle, against the texts the store
  // held before the settle: the closure module cannot say it (above).
  it("an undo of a settle puts back each code's text from before it and lets the hand go of the codes it changed (property)", () => {
    const level = fc.record({ id, v });
    fc.assert(
      fc.property(
        fc.array(level, { maxLength: 4 }),
        fc.option(level, { nil: null }),
        fc.array(level, { minLength: 1, maxLength: 3 }),
        (saved, held, settled) => {
          const ctx = createTourViewerSession();
          const codes = wireCreatorCodes({
            ctx,
            onIdsChanged: () => undefined,
          });
          ctx.tourDocument.open(tourOf([]));
          for (const l of saved) {
            codes.saveLevel({ id: l.id, json: text(l.id, l.v) });
          }
          if (held !== null) {
            codes.setInHand(
              { id: held.id, json: text(held.id, held.v) },
              measurement(held.id, 0),
            );
          }
          const texts = () => IDS.map((c) => codes.savedText(c));
          const was = texts();
          const hand = codes.inHand();
          const measured = codes.measurement();
          codes.applySettle(
            ctx.tourDocument.settleBatch(),
            settled.map((l) => ({ id: l.id, json: text(l.id, l.v) })),
            "the settle",
          );
          const changed: string[] = IDS.filter(
            (c, i) => codes.savedText(c) !== was[i],
          );
          const undone = ctx.tourDocument.undo();
          expect(
            undone.kind,
            "a settle that changed nothing took no step",
          ).toBe(changed.length === 0 ? "nothing" : "undone");
          expect(texts(), "each code's text from before the settle").toEqual(
            was,
          );
          // The hand lets go of a code the undo changed, and keeps any other.
          const letGo = hand !== null && changed.includes(hand.id);
          expect(codes.inHand(), letGo ? "the hand let go" : "kept").toEqual(
            letGo ? null : hand,
          );
          expect(codes.measurement()).toEqual(letGo ? null : measured);
        },
      ),
      { numRuns: 300 },
    );
  });
});
