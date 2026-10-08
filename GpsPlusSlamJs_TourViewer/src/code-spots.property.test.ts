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
 * - two prints change the code at most twice (a move, then its undo);
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

/** One reliable visit seeing the print at `print`, read off by `error`:
 *  the fit and the minted candidate both read it there. */
function visit(m: CodeSpotMemory<P>, print: P, error: P): CodeSpotMemory<P> {
  const read: P = [print[0] + error[0], print[1] + error[1]];
  const spots = known(m);
  const decision = decideCodeSpot({
    sightings: [
      {
        distancesM: spots.map(({ spot, at }) => ({ spot, m: dist(read, at) })),
      },
    ],
    candidateDistancesM: spots.map(({ at }) => dist(read, at)),
    reliable: true,
    frameChanged: false,
    floorM: FLOOR,
  });
  return applyCodeSpotDecision(m, decision, read);
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
        fc.array(fc.tuple(fc.nat(), errorUnder(30)), { maxLength: 30 }),
        (prints, visits) => {
          let m: CodeSpotMemory<P> = {
            current: prints[0]!,
            previous: null,
            copies: [],
          };
          for (const [i, e] of visits) {
            m = visit(m, prints[i % prints.length]!, e);
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

  it("changes a code with two prints at most twice, visited in any order", () => {
    fc.assert(
      fc.property(
        place,
        // Prints far enough apart that a read error under 5 m cannot put
        // one print's sighting within the floor of the other.
        fc.double({ min: 26, max: 200, noNaN: true }),
        fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
        fc.array(fc.tuple(fc.boolean(), errorUnder(5)), { maxLength: 40 }),
        (p, d, a, visits) => {
          const q: P = [p[0] + d * Math.cos(a), p[1] + d * Math.sin(a)];
          let m: CodeSpotMemory<P> = { current: p, previous: null, copies: [] };
          let changes = 0;
          for (const [atQ, e] of visits) {
            const next = visit(m, atQ ? q : p, e);
            if (next.current !== m.current) changes += 1;
            m = next;
          }
          expect(changes).toBeLessThanOrEqual(2);
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
