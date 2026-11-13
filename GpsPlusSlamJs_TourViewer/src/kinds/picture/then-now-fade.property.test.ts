import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  THEN_NOW_START,
  THEN_NOW_TIMING,
  stepThenNow,
  takeOverThenNow,
  type ThenNowInput,
  type ThenNowState,
} from "./then-now-fade.js";

const T = THEN_NOW_TIMING;
const ON: Omit<ThenNowInput, "dtS"> = { near: 1, offAxisDeg: 0, shown: true };
const OFF: Omit<ThenNowInput, "dtS"> = { near: 0, offAxisDeg: 90, shown: true };

function run(
  state: ThenNowState,
  frames: readonly ThenNowInput[],
): ThenNowState[] {
  const out: ThenNowState[] = [];
  let s = state;
  for (const f of frames) {
    s = stepThenNow(s, f);
    out.push(s);
  }
  return out;
}

const dt = fc.double({ min: 0.001, max: 0.1, noNaN: true });

describe("stepThenNow", () => {
  // Why: the chosen default: from nothing to about half (0.55) over 5 s,
  // the old picture never jumping ahead of the clock.
  it("fades 0 to 0.55 over 5 s, rising, then holds", () => {
    fc.assert(
      fc.property(fc.array(dt, { minLength: 1, maxLength: 200 }), (dts) => {
        const states = run(
          THEN_NOW_START,
          dts.map((d) => ({ ...ON, dtS: d })),
        );
        let clock = 0;
        let last = 0;
        for (const [i, s] of states.entries()) {
          clock += dts[i] ?? 0;
          expect(s.fade).toBeGreaterThanOrEqual(last);
          expect(s.fade).toBeLessThanOrEqual(T.introTo);
          expect(clock < T.introS || s.fade === T.introTo).toBe(true);
          last = s.fade;
        }
      }),
    );
  });

  // Why: the timing point by point, so a change of curve is seen: halfway
  // through the clock the fade is halfway (the smooth step is symmetric).
  it("is halfway at half the time and done at the end", () => {
    const half = run(THEN_NOW_START, [{ ...ON, dtS: T.introS / 2 }]).at(-1);
    expect(half?.fade).toBeCloseTo(T.introTo / 2, 9);
    const done = run(THEN_NOW_START, [
      { ...ON, dtS: T.introS / 2 },
      { ...ON, dtS: T.introS / 2 },
    ]).at(-1);
    expect(done).toMatchObject({ fade: T.introTo, introS: null });
  });

  // Why: hysteresis: a wobble between the enter and the leave gate keeps
  // the visitor lined up, so the slider stays and the fade never replays.
  it("keeps lining up through a wobble inside the leave gate", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            dtS: dt,
            near: fc.double({ min: T.leaveNear, max: 1, noNaN: true }),
            offAxisDeg: fc.double({ min: 0, max: T.leaveDeg, noNaN: true }),
          }),
          { maxLength: 100 },
        ),
        (wobble) => {
          const start = run(THEN_NOW_START, [{ ...ON, dtS: T.introS }]).at(-1);
          if (start === undefined) throw new Error("no frame");
          const states = run(
            start,
            wobble.map((w) => ({ ...w, shown: true })),
          );
          for (const s of states) {
            expect(s.aligned).toBe(true);
            expect(s.introS).toBeNull();
            expect(s.fade).toBe(T.introTo);
          }
        },
      ),
    );
  });

  // Why: lining up starts only inside the tighter enter gate.
  it("does not line up outside the enter gate", () => {
    fc.assert(
      fc.property(
        dt,
        fc.double({ min: T.enterDeg, max: 180, noNaN: true }),
        (d, off) => {
          const s = stepThenNow(THEN_NOW_START, {
            ...ON,
            offAxisDeg: off,
            dtS: d,
          });
          expect(s.aligned).toBe(false);
          expect(s.fade).toBe(0);
        },
      ),
    );
  });

  // Why: the fade replays after the visitor was off the spot long enough,
  // and not after a short glance away: the fresh-arrival rule swept on
  // both sides of its threshold.
  it("replays only after being away for the fresh-arrival time", () => {
    fc.assert(
      fc.property(fc.double({ min: 0.05, max: 6, noNaN: true }), (away) => {
        const [done] = run(THEN_NOW_START, [{ ...ON, dtS: T.introS }]).slice(
          -1,
        );
        if (done === undefined) throw new Error("no frame");
        const left = run(done, [{ ...OFF, dtS: away }]).at(-1);
        if (left === undefined) throw new Error("no frame");
        const back = stepThenNow(left, { ...ON, dtS: 0.01 });
        const replayed = stepThenNow(THEN_NOW_START, { ...ON, dtS: 0.01 });
        expect(back.fade).toBe(
          away >= T.freshAfterS ? replayed.fade : T.introTo,
        );
      }),
    );
  });

  // Why: hiding the picture (the visitor walked off, the station closed)
  // ends lining up at once.
  it("is never lined up while the picture is hidden", () => {
    const s = stepThenNow(THEN_NOW_START, { ...ON, shown: false, dtS: 0.1 });
    expect(s.aligned).toBe(false);
  });

  // Why: a broken clock reading must not run the fade backwards.
  it("reads a broken frame time as no time", () => {
    const s = stepThenNow(THEN_NOW_START, { ...ON, dtS: Number.NaN });
    expect(s.fade).toBe(0);
    expect(stepThenNow(s, { ...ON, dtS: -3 }).fade).toBe(0);
  });
});

describe("takeOverThenNow", () => {
  // Why: once the visitor moves the slider, the fade stops and the
  // visitor's value holds for as long as they stay lined up.
  it("stops the fade and holds the visitor's value", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.array(dt, { maxLength: 100 }),
        (value, dts) => {
          const started = stepThenNow(THEN_NOW_START, { ...ON, dtS: 0.5 });
          const held = takeOverThenNow(started, value);
          for (const s of run(
            held,
            dts.map((d) => ({ ...ON, dtS: d })),
          )) {
            expect(s.fade).toBe(value);
          }
        },
      ),
    );
  });

  // Why: the slider's value goes straight into a material; it is clamped,
  // and a value that is not a number changes nothing.
  it("clamps and ignores a broken value", () => {
    expect(takeOverThenNow(THEN_NOW_START, 3).fade).toBe(1);
    expect(takeOverThenNow(THEN_NOW_START, -1).fade).toBe(0);
    expect(takeOverThenNow(THEN_NOW_START, Number.NaN)).toBe(THEN_NOW_START);
  });
});
