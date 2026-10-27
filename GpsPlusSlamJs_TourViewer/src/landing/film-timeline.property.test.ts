/**
 * Why these properties matter: the film's pace is swept (speed, reading
 * hold) and its parts may be merged later, so the timeline must hold its
 * algebra for every plausible film, not only for today's eight parts:
 * the position never runs backwards while the film plays, a part's start
 * maps back to that part, the total is exactly the sum of its pieces, and
 * the camera's progress stays inside [0, 1].
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { createTimeline, type BeatSpec } from "./film-timeline.js";

const VIEWS = ["a", "b", "c"] as const;

const beatArb: fc.Arbitrary<BeatSpec> = fc
  .record({
    durS: fc.double({ min: 0.5, max: 15, noNaN: true }),
    first: fc.constantFrom(...VIEWS),
    later: fc.array(
      fc.record({
        frac: fc.double({ min: 0.05, max: 0.95, noNaN: true }),
        view: fc.constantFrom(...VIEWS),
      }),
      { maxLength: 2 },
    ),
  })
  .map(({ durS, first, later }) => {
    const sorted = [...later].sort((x, y) => x.frac - y.frac);
    const views = [{ atS: 0, view: first as string }];
    for (const v of sorted) {
      const atS = v.frac * durS;
      if (atS > views[views.length - 1]!.atS) views.push({ atS, view: v.view });
    }
    return { durS, views };
  });

const paceArb = fc.record({
  speed: fc.double({ min: 0.25, max: 2, noNaN: true }),
  holdS: fc.double({ min: 0, max: 4, noNaN: true }),
  camS: fc.double({ min: 0.2, max: 3, noNaN: true }),
  settleS: fc.double({ min: 0, max: 1, noNaN: true }),
});

describe("film timeline: properties", () => {
  it("never moves backwards as the time grows", () => {
    fc.assert(
      fc.property(
        fc.array(beatArb, { minLength: 1, maxLength: 9 }),
        paceArb,
        fc.array(fc.double({ min: 0, max: 1, noNaN: true }), {
          minLength: 2,
          maxLength: 40,
        }),
        (beats, pace, fracs) => {
          const tl = createTimeline(beats, pace);
          const times = fracs.map((f) => f * tl.totalS).sort((x, y) => x - y);
          let prev = tl.positionAt(times[0]!);
          for (const t of times.slice(1)) {
            const p = tl.positionAt(t);
            expect(
              p.beat > prev.beat ||
                (p.beat === prev.beat && p.storyT >= prev.storyT - 1e-9),
            ).toBe(true);
            prev = p;
          }
        },
      ),
    );
  });

  it("maps every part's start back to that part at its first moment", () => {
    fc.assert(
      fc.property(
        fc.array(beatArb, { minLength: 1, maxLength: 9 }),
        paceArb,
        (beats, pace) => {
          const tl = createTimeline(beats, pace);
          beats.forEach((_, i) => {
            const p = tl.positionAt(tl.startOf(i));
            expect(p.beat).toBe(i);
            expect(p.storyT).toBe(0);
          });
        },
      ),
    );
  });

  it("totals the acting at 1 / speed, the leads and every hold but the last", () => {
    fc.assert(
      fc.property(
        fc.array(beatArb, { minLength: 1, maxLength: 9 }),
        paceArb,
        (beats, pace) => {
          const tl = createTimeline(beats, pace);
          const acting = beats.reduce((sum, b) => sum + b.durS, 0) / pace.speed;
          const leads = tl.segments.reduce((sum, s) => sum + s.leadS, 0);
          const holds = pace.holdS * (beats.length - 1);
          expect(tl.totalS).toBeCloseTo(acting + leads + holds, 6);
          tl.segments.forEach((s, i) => {
            expect(
              s.leadS === 0 ||
                s.leadS === pace.camS ||
                s.leadS === pace.settleS,
            ).toBe(true);
            expect(i !== 0 || s.leadS === 0).toBe(true);
          });
        },
      ),
    );
  });

  it("keeps the camera's progress inside [0, 1] and on views the film names", () => {
    fc.assert(
      fc.property(
        fc.array(beatArb, { minLength: 1, maxLength: 9 }),
        paceArb,
        fc.double({ min: -1, max: 2, noNaN: true }),
        (beats, pace, frac) => {
          const tl = createTimeline(beats, pace);
          const cam = tl.cameraAt(frac * tl.totalS);
          expect(cam.k).toBeGreaterThanOrEqual(0);
          expect(cam.k).toBeLessThanOrEqual(1);
          expect(VIEWS).toContain(cam.from);
          expect(VIEWS).toContain(cam.to);
        },
      ),
    );
  });
});
