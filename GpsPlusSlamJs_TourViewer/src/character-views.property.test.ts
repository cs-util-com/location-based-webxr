import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  activeWordAt,
  beckonNext,
  facingDegOf,
  facingRotation,
  facingYaw,
  lineReadingMs,
  lineWordTimes,
  talkFrameAt,
  MAX_TURN_DEG,
  readingFloor,
} from "./character-views";

describe("character views (properties)", () => {
  /**
   * Why this property matters: the beckon never points at the station he
   * stands at nor at one already done, and under "any" order it exists
   * only when one station remains.
   */
  it("beckons only at an undone other station", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("fixed" as const, "any" as const),
        fc.array(fc.constantFrom("waiting", "found", "done"), { maxLength: 8 }),
        fc.nat(9),
        (order, states, at) => {
          const stations = states.map((state, i) => ({
            id: `s${String(i)}`,
            state,
          }));
          const current = `s${String(at)}`;
          const next = beckonNext({ order, stations }, current);
          const undone = stations.filter(
            (s) => s.id !== current && s.state !== "done",
          );
          // Fixed order: the first undone other station; any order: the
          // one undone station left, and none while several are.
          const want =
            order === "any"
              ? undone.length === 1
                ? (undone[0]?.id ?? null)
                : null
              : (undone[0]?.id ?? null);
          expect(next).toBe(want);
          expect(next).not.toBe(current);
        },
      ),
    );
  });

  /** Why this property matters: the reading time bounds the lineEnd wait
   *  for any caption, and the reading floor never shrinks the text. */
  it("bounds the reading time and never lets the floor shrink text", () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 600 }),
        fc.double({ noNaN: false }),
        (text, d) => {
          const ms = lineReadingMs(text);
          expect(ms).toBeGreaterThanOrEqual(1500);
          expect(ms).toBeLessThanOrEqual(60_000);
          expect(readingFloor(d)).toBeGreaterThanOrEqual(1);
        },
      ),
    );
  });

  /**
   * Why this property matters: whatever the creator's facing and wherever
   * the visitor stands, he turns at most 60 degrees from that facing, and
   * a visitor inside that cone is faced exactly (the prototype's rule).
   */
  it("never turns more than 60 degrees from rest, and faces a camera inside the cone exactly", () => {
    const cap = (MAX_TURN_DEG * Math.PI) / 180;
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    fc.assert(
      fc.property(
        fc.double({ min: -10, max: 10, noNaN: true }),
        fc.double({ min: -10, max: 10, noNaN: true }),
        (rest, toCam) => {
          const yaw = facingYaw(rest, toCam, true);
          expect(Math.abs(wrap(yaw - rest))).toBeLessThanOrEqual(cap + 1e-9);
          const inside = Math.abs(wrap(toCam - rest)) <= cap - 1e-9;
          const faced = Math.abs(wrap(yaw - toCam)) < 1e-9;
          expect(!inside || faced).toBe(true);
          expect(facingYaw(rest, toCam, false)).toBe(rest);
        },
      ),
    );
  });

  /**
   * Why this property matters: the read-along must only ever run forward
   * through the line's words (a word lit twice, or out of order, reads as
   * a glitch), and his mouth is open only while a word sounds.
   */
  it("reads along forward, one word of the line at a time, the mouth open only inside a word", () => {
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[A-Za-z,.!?]{1,12}$/), { maxLength: 12 }),
        fc.array(fc.double({ min: -1000, max: 30000, noNaN: true }), {
          minLength: 2,
          maxLength: 6,
        }),
        (words, raw) => {
          const times = lineWordTimes(words.join(" "));
          expect(times).toHaveLength(words.length);
          const ms = [...raw].sort((a, b) => a - b);
          let last = -1;
          for (const t of ms) {
            const at = activeWordAt(times, t);
            expect(at).toBeGreaterThanOrEqual(last);
            expect(at).toBeLessThan(Math.max(1, times.length));
            last = at;
            const inWord = times.some((w) => t >= w.startMs && t < w.endMs);
            expect(talkFrameAt(times, t) !== 0).toBe(inWord);
          }
        },
      ),
    );
  });

  /**
   * Why this property matters: a heading the creator types must come back
   * as the same heading (the inspector shows it again after the edit), at
   * 0 to 360, for any number typed, however far round.
   */
  it("reads a facing written for any heading back as that heading, 0 to 360", () => {
    fc.assert(
      fc.property(fc.double({ min: -1e4, max: 1e4, noNaN: true }), (deg) => {
        const q = facingRotation(deg);
        expect(q).not.toBeNull();
        const back = facingDegOf(q ?? []);
        expect(back).toBeGreaterThanOrEqual(0);
        expect(back).toBeLessThan(360);
        expect(Math.cos(((back - deg) * Math.PI) / 180)).toBeCloseTo(1, 6);
      }),
    );
  });
});
