import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { HUD_ARRIVAL_BAND_M, judgedStationBands } from "./station-bands";
import {
  nextPresentStation,
  presenceCandidates,
  takeoverMarginM,
  type PresenceCandidate,
} from "./station-presence";

/**
 * Why these properties matter (visitor plan 2026-10-18-2349 M1, cold review
 * HIGH-2/HIGH-3): the content a visitor sees follows `nextPresentStation`
 * on every judged position, so its guarantees must hold for any layout and
 * any walk, not only the hand-picked unit cases:
 * - never more than one station present, and the present one's found exit
 *   always holds the judged position (content never stays where it would
 *   not have appeared);
 * - a position inside a found radius with nothing present always makes a
 *   station present (content is never withheld at a station);
 * - noise smaller than the band and half the margin never makes a visitor
 *   standing still flicker (never back to a station it left, never back to
 *   none);
 * - with noise ABOVE the band, using the bands production applies after
 *   the judged-accuracy rules (the raw accuracy without a code, the HUD's
 *   1.5 m with one), the first property still holds.
 */

interface Spot {
  readonly id: string;
  readonly n: number;
  readonly e: number;
  readonly foundRadiusM: number;
}

const spotsArb = fc
  .array(
    fc.tuple(
      fc.double({ min: -20, max: 20, noNaN: true }),
      fc.double({ min: -20, max: 20, noNaN: true }),
      fc.double({ min: 0.5, max: 8, noNaN: true }),
    ),
    { minLength: 1, maxLength: 6 },
  )
  .map((xs) =>
    xs.map(([n, e, r], i): Spot => ({
      id: `s${String(i)}`,
      n,
      e,
      foundRadiusM: r,
    })),
  );

/** The candidates at an observed position, with one band for every spot. */
function candidatesAt(
  spots: readonly Spot[],
  p: readonly [number, number],
  bandM: number,
): PresenceCandidate[] {
  return spots.map((s) => ({
    id: s.id,
    distanceM: Math.hypot(s.n - p[0], s.e - p[1]),
    foundM: s.foundRadiusM,
    foundExitM: s.foundRadiusM + bandM,
  }));
}

/** What is wrong with one step of the rule, or null: one present station
 *  at most, its exit holding the position; none present only while no
 *  found radius holds it; no judged position changes nothing. */
function stepProblem(
  before: string | null,
  next: string | null,
  c: readonly PresenceCandidate[] | null,
): string | null {
  if (c === null) return next === before ? null : "changed without a position";
  if (next === null) {
    return c.every((x) => x.distanceM > x.foundM)
      ? null
      : "none present inside a found radius";
  }
  const mine = c.find((x) => x.id === next);
  if (mine === undefined) return `unknown station ${next}`;
  return mine.distanceM <= mine.foundExitM ? null : `${next} outside its exit`;
}

const pointArb = fc.tuple(
  fc.double({ min: -30, max: 30, noNaN: true }),
  fc.double({ min: -30, max: 30, noNaN: true }),
);

describe("nextPresentStation (properties)", () => {
  it("one station at most, its exit holding the judged position, on any walk with gaps", () => {
    fc.assert(
      fc.property(
        spotsArb,
        fc.array(fc.option(pointArb, { nil: null }), { maxLength: 40 }),
        fc.double({ min: 0.5, max: 3, noNaN: true }),
        fc.double({ min: 0, max: 3, noNaN: true }),
        (spots, walk, bandM, m) => {
          let present: string | null = null;
          const problems: string[] = [];
          for (const p of walk) {
            const c = p === null ? null : candidatesAt(spots, p, bandM);
            const next = nextPresentStation(present, c, m);
            const problem = stepProblem(present, next, c);
            if (problem !== null) problems.push(problem);
            present = next;
          }
          expect(problems).toEqual([]);
        },
      ),
    );
  });

  it("no flicker for a visitor standing still under noise below the band and half the margin", () => {
    fc.assert(
      fc.property(
        spotsArb,
        pointArb,
        fc.double({ min: 0.5, max: 3, noNaN: true }),
        fc.double({ min: 0.2, max: 3, noNaN: true }),
        fc.double({ min: 0, max: 0.98, noNaN: true }),
        fc.array(
          fc.tuple(
            fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
            fc.double({ min: 0, max: 1, noNaN: true }),
          ),
          { minLength: 2, maxLength: 60 },
        ),
        (spots, truth, bandM, m, share, offsets) => {
          // Noise radius strictly below half the band and half the margin.
          const e = (share * Math.min(bandM, m)) / 2;
          const left = new Set<string>();
          const problems: string[] = [];
          let present: string | null = null;
          for (const [angle, k] of offsets) {
            const p: [number, number] = [
              truth[0] + Math.cos(angle) * k * e,
              truth[1] + Math.sin(angle) * k * e,
            ];
            const next = nextPresentStation(
              present,
              candidatesAt(spots, p, bandM),
              m,
            );
            // Once present, never none again, and never back to a left one.
            if (present !== null && next === null) problems.push("blanked");
            if (present !== null && next !== present) left.add(present);
            if (next !== null && left.has(next))
              problems.push(`back to ${next}`);
            present = next;
          }
          expect(problems).toEqual([]);
        },
      ),
    );
  });

  it("noise above the band, with production's judged bands: still one present, never outside its exit", () => {
    fc.assert(
      fc.property(
        spotsArb,
        pointArb,
        // A raw accuracy (no code: the band is the accuracy, at least the
        // HUD's 1.5 m) or a code lined up (the HUD's 1.5 m).
        fc.double({ min: 1, max: 25, noNaN: true }),
        fc.boolean(),
        // Noise up to four times the band.
        fc.double({ min: 1, max: 4, noNaN: true }),
        fc.array(
          fc.tuple(
            fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
            fc.double({ min: 0, max: 1, noNaN: true }),
          ),
          { minLength: 2, maxLength: 60 },
        ),
        (spots, truth, rawAccuracyM, code, overBand, offsets) => {
          const stations = spots.map((s) => ({
            ...s,
            activateRadiusM: s.foundRadiusM * 2,
          }));
          const bandOf = (s: (typeof stations)[number]) =>
            judgedStationBands(s, rawAccuracyM, code);
          const band = code
            ? HUD_ARRIVAL_BAND_M
            : Math.max(rawAccuracyM, HUD_ARRIVAL_BAND_M);
          expect(bandOf(stations[0]!).foundExitM).toBeCloseTo(
            stations[0]!.foundRadiusM + band,
            9,
          );
          const e = overBand * band;
          const problems: string[] = [];
          let present: string | null = null;
          for (const [angle, k] of offsets) {
            const p = [
              truth[0] + Math.cos(angle) * k * e,
              truth[1] + Math.sin(angle) * k * e,
            ] as const;
            const distances = new Map(
              stations.map((s) => [s.id, Math.hypot(s.n - p[0], s.e - p[1])]),
            );
            const c = presenceCandidates(stations, distances, bandOf);
            const next = nextPresentStation(
              present,
              c,
              takeoverMarginM(code ? null : rawAccuracyM, code),
            );
            const problem = stepProblem(present, next, c);
            if (problem !== null) problems.push(problem);
            present = next;
          }
          expect(problems).toEqual([]);
        },
      ),
    );
  });
});
