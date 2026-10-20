/**
 * The codes in the store against the codes as they were (debug-captures
 * plan M3a): `creator-codes.ts` is a facade over the tour document's
 * `codes` and the page's `creatorCodes` slice now, whose reducers apply
 * `code-book.ts`'s rules. Its reference model is the module as it was
 * before the move - closure state over the same rules
 * (`test-support/creator-codes-reference.ts`).
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";

import { wireCreatorCodes, type CreatorCodes } from "./creator-codes.js";
import { wireReferenceCodes } from "./test-support/creator-codes-reference.js";
import { createTourViewerSession } from "./tour-viewer-session.js";
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
      kind: "clear" | "finish" | "endVisit" | "reset" | "levelsFail";
    }
  | { kind: "levelsArrive"; levels: { id: string; v: number }[] }
  | { kind: "tourLevels"; ids: { id: string; geo: boolean }[] };

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
    ),
  }),
  fc.record({ kind: fc.constant("levelsArrive" as const), levels }),
  fc.record({
    kind: fc.constant("tourLevels" as const),
    ids: fc.uniqueArray(fc.record({ id, geo: fc.boolean() }), {
      selector: (l) => l.id,
      maxLength: 3,
    }),
  }),
);

/** What the page holds of the open tour's level files: each side keeps
 *  them its own way. */
type Levels = (
  texts: ReadonlyMap<string, string> | null,
  failed: boolean,
) => void;

type Apply = {
  [K in Op["kind"]]: (
    codes: CreatorCodes,
    o: Op & { kind: K },
    levels: Levels,
  ) => void;
};

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
  restoreHand: (codes, o) => {
    codes.restoreInHand({ id: o.id, json: text(o.id, o.v) });
  },
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
  levelsArrive: (_codes, o, levels) => {
    levels(new Map(o.levels.map((l) => [l.id, text(l.id, l.v)])), false);
  },
  // A failed read: no texts for this open (archive-open sets the failure
  // on an open whose texts never came).
  levelsFail: (_codes, _o, levels) => {
    levels(null, true);
  },
  // Handled by the caller: both sides read the same plain field.
  tourLevels: () => undefined,
};

function apply(codes: CreatorCodes, o: Op, levels: Levels): void {
  (APPLY[o.kind] as (c: CreatorCodes, op: Op, l: Levels) => void)(
    codes,
    o,
    levels,
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

describe("creator-codes: the store keeps every rule of the codes as they were", () => {
  // Why this test matters: the move into the store spreads one closure's
  // rules over two slices and a facade - the hand's text winning, live
  // work beating a draft, the two baselines, the lazy hosted texts, the
  // resets, the measurements per code, the print panel's notices. A
  // characterization test pins each rule at a few points; this compares
  // EVERY observable of the facade with the module as it was, after every
  // step of any sequence of the page's calls, so a rule that drifted in
  // one reducer is caught wherever it shows.
  it("reads exactly as the closure module did after every step, for any sequence (model-based property)", () => {
    fc.assert(
      fc.property(fc.array(op, { maxLength: 30 }), (ops) => {
        const ctx = createTourViewerSession();
        const model = {
          currentLevels: null as ReadonlyMap<string, QrLevel> | null,
          currentLevelTexts: null as ReadonlyMap<string, string> | null,
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
            const tour = new Map(
              o.ids.map((l) => [l.id, tourLevel(l.id, l.geo)]),
            );
            ctx.currentLevels = tour;
            model.currentLevels = tour;
          }
          apply(codes, o, (texts, failed) => {
            if (failed) {
              ctx.currentLevelTexts = null;
              ctx.levelsUnreadable = true;
            } else {
              ctx.currentLevelTexts = texts;
            }
          });
          apply(reference, o, (texts) => {
            model.currentLevelTexts = texts;
          });
          const where = `after step ${String(step)} (${o.kind})`;
          expect(observe(codes), where).toEqual(observe(reference));
          expect(heard, `${where}: the print panel's notices`).toBe(modelHeard);
          expect(
            ctx.currentLevelTexts === null ? null : [...ctx.currentLevelTexts],
            `${where}: the hosted texts`,
          ).toEqual(
            model.currentLevelTexts === null
              ? null
              : [...model.currentLevelTexts],
          );
        }
      }),
      { numRuns: 300 },
    );
  });
});
