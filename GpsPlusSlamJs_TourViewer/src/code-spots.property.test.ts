/**
 * Properties of the automatic code-spot rule (code book plan, M6 v5).
 *
 * Why these properties matter: the unit tests pin single visits; the rule
 * runs at EVERY settle of every stored code, and its memory carries over
 * between visits. Four earlier designs each had a visit SEQUENCE that broke
 * them (a second print moving the code again and again, an undo that never
 * fired). So a small world is simulated: prints at fixed places on a plane,
 * visits in any order whose fit reads each print with an error below a
 * bound, the rule and its memory applied in sequence. For ANY such world:
 * - known spots stay at least the floor apart;
 * - k prints change the code at most 2 (k - 1) times (two prints: a move,
 *   then its undo), while every read stays within half the floor;
 * - a code at one unmoved print read with errors under the floor never
 *   changes at all.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  applyCodeSpotDecision,
  decideCodeSpot,
  type CodeSpotMemory,
  type SpotRef,
} from "./code-spots";

const FLOOR = 20;
type P = readonly [number, number];
const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** The known spots of a memory, each with its reference. */
function known(m: CodeSpotMemory<P>): { spot: SpotRef; at: P }[] {
  return [
    { spot: { kind: "current" }, at: m.current },
    ...(m.previous === null
      ? []
      : [{ spot: { kind: "previous" as const }, at: m.previous }]),
    ...m.copies.map((at, index) => ({
      spot: { kind: "copy" as const, index },
      at,
    })),
  ];
}

/** One reliable visit seeing the print at `print`: its fit reads the
 *  print off by `fitError`, the pose a move would mint by `candError`
 *  (measured apart: p90 3.9 m, p99 9.3 m); `dayLater`: at least a day
 *  after the current spot was minted. */
function visit(
  m: CodeSpotMemory<P>,
  print: P,
  fitError: P,
  candError: P = fitError,
  dayLater = false,
): CodeSpotMemory<P> {
  const fit: P = [print[0] + fitError[0], print[1] + fitError[1]];
  const cand: P = [print[0] + candError[0], print[1] + candError[1]];
  const spots = known(m);
  const decision = decideCodeSpot({
    sightings: [
      {
        distancesM: spots.map(({ spot, at }) => ({ spot, m: dist(fit, at) })),
      },
    ],
    candidateDistancesM: spots.map(({ at }) => dist(cand, at)),
    reliable: true,
    frameChanged: false,
    previousExpires: dayLater && m.previous !== null,
    floorM: FLOOR,
  });
  return applyCodeSpotDecision(m, decision, cand);
}

const errorUnder = (maxM: number) =>
  fc
    .tuple(
      fc.double({ min: 0, max: maxM, noNaN: true }),
      fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
    )
    .map(([r, a]): P => [r * Math.cos(a), r * Math.sin(a)]);

const place = fc.tuple(
  fc.double({ min: -300, max: 300, noNaN: true }),
  fc.double({ min: -300, max: 300, noNaN: true }),
);

describe("code-spot rule properties", () => {
  it("keeps every known spot at least the floor from every other", () => {
    fc.assert(
      fc.property(
        fc.array(place, { minLength: 1, maxLength: 4 }),
        fc.array(
          fc.tuple(fc.nat(), errorUnder(30), errorUnder(30), fc.boolean()),
          { maxLength: 30 },
        ),
        (prints, visits) => {
          let m: CodeSpotMemory<P> = {
            current: prints[0]!,
            previous: null,
            copies: [],
          };
          for (const [i, fe, ce, later] of visits) {
            m = visit(m, prints[i % prints.length]!, fe, ce, later);
            const spots = known(m).map((s) => s.at);
            for (let a = 0; a < spots.length; a += 1)
              for (let b = a + 1; b < spots.length; b += 1)
                expect(dist(spots[a]!, spots[b]!)).toBeGreaterThanOrEqual(
                  FLOOR,
                );
          }
        },
      ),
    );
  });

  // The bound matters: a copy is stored where the moving visit minted it
  // and later read where another visit fits it, so the two reads may differ
  // by twice the error. Under half the floor each, a print is always
  // recognised; beyond it a print can read as new (v5 review #5).
  it("changes a code with k prints at most 2 (k - 1) times, in any order, read within half the floor", () => {
    fc.assert(
      fc.property(
        place,
        fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
        fc.integer({ min: 2, max: 4 }),
        // Prints far enough apart that a read of one is never within the
        // floor of the spot stored for another (floor + twice the error).
        fc.double({ min: 2 * FLOOR, max: 120, noNaN: true }),
        fc.array(
          fc.tuple(
            fc.nat(),
            errorUnder(FLOOR / 2 - 0.01),
            errorUnder(FLOOR / 2 - 0.01),
            fc.boolean(),
          ),
          { maxLength: 40 },
        ),
        (origin, a, k, gap, visits) => {
          const prints: P[] = Array.from({ length: k }, (_, i) => [
            origin[0] + i * gap * Math.cos(a),
            origin[1] + i * gap * Math.sin(a),
          ]);
          let m: CodeSpotMemory<P> = {
            current: prints[0]!,
            previous: null,
            copies: [],
          };
          let changes = 0;
          for (const [i, fe, ce, later] of visits) {
            const next = visit(m, prints[i % k]!, fe, ce, later);
            if (next.current !== m.current) changes += 1;
            m = next;
          }
          expect(changes).toBeLessThanOrEqual(2 * (k - 1));
        },
      ),
    );
  });

  it("never changes a code at one unmoved print read within the floor", () => {
    fc.assert(
      fc.property(
        place,
        fc.array(errorUnder(FLOOR - 0.01), { maxLength: 40 }),
        (p, errors) => {
          let m: CodeSpotMemory<P> = { current: p, previous: null, copies: [] };
          for (const e of errors) m = visit(m, p, e);
          expect(m.current).toBe(p);
          expect(m.previous).toBeNull();
        },
      ),
    );
  });
});
