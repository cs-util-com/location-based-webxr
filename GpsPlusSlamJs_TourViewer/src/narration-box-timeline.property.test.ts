/**
 * Why this test matters: in the narration box a drag of so many lines is a
 * seek of the voice, and the arrow keys move it a line. `lineFloatAt` (the
 * voice's time as a line position) and `timeAtLine` (back) are that one
 * mapping both ways; if they drift apart, the words under the finger are
 * not what the voice says after the release, and a line step lands
 * mid-line or runs backwards.
 *
 * Ranges and tolerances, and why:
 * - Line starts: a first line at 0 to 100 000 ms (a voice may start late in
 *   its file), then 1 to 40 lines of 0 to 5 000 ms each (0 is a line with
 *   no time of its own, which `lineStarts` makes when a line's first word
 *   starts with the one before). That spans texts of a few seconds to
 *   several minutes, past the box's real ones.
 * - Times are drawn from 20 % of the text's span before its first line to
 *   20 % past its end, line positions from 2 lines before the first to 2
 *   past the last, so both clamps are hit as well as every line between.
 * - Tolerances 1e-6 ms and 1e-8 lines: the values reach about 3e5 ms, where
 *   one double step is about 6e-11 ms, and the shortest line with length
 *   drawn is 1 ms, so rounding stays near 1e-10 either way; any real
 *   offset is a share of a line (a word is about 100 ms). A bound anywhere
 *   from 1e-9 ms to a few ms gives the same verdicts: the mapping is exact
 *   up to rounding or wrong by far more.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { lineFloatAt, timeAtLine } from "./narration-box-timeline.js";

const TIME_TOL_MS = 1e-6;
const LINE_TOL = 1e-8;
const RUNS = 500;

/** Line starts as `lineStarts` makes them: never decreasing, at least two
 *  entries (one line and its closing total). With `positive`, every line
 *  has length. */
function lineStartsArb(positive: boolean): fc.Arbitrary<number[]> {
  const span = positive
    ? fc.double({ min: 1, max: 5000, noNaN: true })
    : fc.oneof(fc.constant(0), fc.double({ min: 0, max: 5000, noNaN: true }));
  return fc
    .record({
      first: fc.double({ min: 0, max: 100_000, noNaN: true }),
      spans: fc.array(span, { minLength: 1, maxLength: 40 }),
    })
    .map(({ first, spans }) => {
      const ls = [first];
      for (const s of spans) ls.push((ls.at(-1) ?? 0) + s);
      return ls;
    });
}

const firstOf = (ls: readonly number[]): number => ls[0] ?? 0;
const totalOf = (ls: readonly number[]): number => ls.at(-1) ?? 0;
const linesOf = (ls: readonly number[]): number => ls.length - 1;
const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

/** A time from 20 % of the text's span before it to 20 % past it. */
const share = fc.double({ min: -0.2, max: 1.2, noNaN: true });
const timeAt = (ls: readonly number[], s: number): number =>
  firstOf(ls) + s * Math.max(1, totalOf(ls) - firstOf(ls));
/** A line position from 2 lines before the first to 2 past the last. */
const lineShare = fc.double({ min: 0, max: 1, noNaN: true });
const lineAt = (ls: readonly number[], s: number): number =>
  -2 + s * (linesOf(ls) + 4);

describe("lineFloatAt and timeAtLine", () => {
  // Why: a drag that ends where it started leaves the voice where it was,
  // lines of no length between included; outside the text, at its edge.
  it("time -> line -> time comes back, clamped to the text", () => {
    fc.assert(
      fc.property(lineStartsArb(false), share, (ls, s) => {
        const t = timeAt(ls, s);
        const want = clamp(t, firstOf(ls), totalOf(ls));
        expect(
          Math.abs(timeAtLine(ls, lineFloatAt(ls, t)) - want),
        ).toBeLessThanOrEqual(TIME_TOL_MS);
      }),
      { numRuns: RUNS },
    );
  });

  // Why: an arrow key moves one line from where the voice is; the line a
  // time maps back to must be that line, wherever lines have length.
  it("line -> time -> line comes back where lines have length, clamped", () => {
    fc.assert(
      fc.property(lineStartsArb(true), lineShare, (ls, s) => {
        const x = lineAt(ls, s);
        const want = clamp(x, 0, linesOf(ls));
        expect(
          Math.abs(lineFloatAt(ls, timeAtLine(ls, x)) - want),
        ).toBeLessThanOrEqual(LINE_TOL);
      }),
      { numRuns: RUNS },
    );
  });

  // Why: the finger moving one way never moves the voice the other way,
  // and a later voice never shows an earlier line.
  it("is monotone both ways", () => {
    fc.assert(
      fc.property(
        lineStartsArb(false),
        share,
        share,
        lineShare,
        lineShare,
        (ls, a, b, c, d) => {
          const [t0, t1] = [
            timeAt(ls, Math.min(a, b)),
            timeAt(ls, Math.max(a, b)),
          ];
          expect(lineFloatAt(ls, t0)).toBeLessThanOrEqual(lineFloatAt(ls, t1));
          const [x0, x1] = [
            lineAt(ls, Math.min(c, d)),
            lineAt(ls, Math.max(c, d)),
          ];
          expect(timeAtLine(ls, x0)).toBeLessThanOrEqual(timeAtLine(ls, x1));
        },
      ),
      { numRuns: RUNS },
    );
  });

  // Why: a drag past either end of the words lands on the voice's start or
  // end, never outside it; a broken clock reading (NaN) is the start.
  it("stays inside the text and clamps at both ends", () => {
    fc.assert(
      fc.property(lineStartsArb(false), share, lineShare, (ls, s, u) => {
        const line = lineFloatAt(ls, timeAt(ls, s));
        expect(line).toBeGreaterThanOrEqual(0);
        expect(line).toBeLessThanOrEqual(linesOf(ls));
        const t = timeAtLine(ls, lineAt(ls, u));
        expect(t).toBeGreaterThanOrEqual(firstOf(ls));
        expect(t).toBeLessThanOrEqual(totalOf(ls));
        expect(lineFloatAt(ls, firstOf(ls) - 1)).toBe(0);
        // A text with no time at all starts where it ends: the start wins.
        expect(lineFloatAt(ls, totalOf(ls))).toBe(
          totalOf(ls) > firstOf(ls) ? linesOf(ls) : 0,
        );
        expect(lineFloatAt(ls, totalOf(ls) + 1)).toBe(linesOf(ls));
        expect(timeAtLine(ls, -1)).toBe(firstOf(ls));
        expect(timeAtLine(ls, 0)).toBe(firstOf(ls));
        expect(timeAtLine(ls, linesOf(ls))).toBe(totalOf(ls));
        expect(timeAtLine(ls, linesOf(ls) + 1)).toBe(totalOf(ls));
        expect(lineFloatAt(ls, Number.NaN)).toBe(0);
        expect(timeAtLine(ls, Number.NaN)).toBe(firstOf(ls));
      }),
      { numRuns: RUNS },
    );
  });

  // Why: `lineStarts` never makes fewer than two entries, but the pair is
  // exported; with no line at all it must answer, not throw or give NaN.
  it("answers for no line starts and for a single one", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 100_000, noNaN: true }),
        fc.double({ min: -1e6, max: 1e6, noNaN: true }),
        (only, v) => {
          expect(lineFloatAt([], v)).toBe(0);
          expect(timeAtLine([], v)).toBe(0);
          expect(lineFloatAt([only], v)).toBe(0);
          expect(timeAtLine([only], v)).toBe(only);
        },
      ),
      { numRuns: RUNS },
    );
  });
});
