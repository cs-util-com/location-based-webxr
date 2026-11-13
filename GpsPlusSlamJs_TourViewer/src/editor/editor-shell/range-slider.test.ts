// @vitest-environment jsdom
/**
 * Why these tests matter: every slider of the inspector keeps its value
 * through these rules. A value off the track or off its step would be
 * written as a number the creator never saw; two thumbs that crossed would
 * write a full-volume edge beyond the reach, which the file refuses; and
 * a slider whose default is not where it was drawn would not go back
 * there after a drag that wrote nothing. The drag rule itself is covered
 * through its two users (`radius-slider.test.ts`, `field-sliders.test.ts`).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { pairValue, rangeInput, trackValue } from "./range-slider.js";

const tracks = fc.constantFrom(
  { min: 2, max: 15, step: 0.5 },
  { min: 1, max: 60, step: 1 },
  { min: 0, max: 100, step: 1 },
  { min: 0.1, max: 0.9, step: 0.1 },
);

/** Whether `v` lies on `track`'s steps, to a float's noise. */
function onStep(v: number, track: { min: number; step: number }): boolean {
  const steps = (v - track.min) / track.step;
  return Math.abs(steps - Math.round(steps)) < 1e-9;
}

describe("trackValue", () => {
  it("puts any number on the track and on a step, and keeps one there", () => {
    fc.assert(
      fc.property(tracks, fc.double({ noNaN: false }), (track, value) => {
        const v = trackValue(value, track);
        expect(v).toBeGreaterThanOrEqual(track.min);
        expect(v).toBeLessThanOrEqual(track.max);
        expect(onStep(v, track)).toBe(true);
        expect(trackValue(v, track)).toBe(v);
      }),
    );
  });

  it("rounds to the nearest step and shows no float noise", () => {
    const track = { min: 0.1, max: 0.9, step: 0.1 };
    expect(trackValue(0.3, track)).toBe(0.3);
    expect(trackValue(0.26, track)).toBe(0.3);
    expect(trackValue(7.74, { min: 2, max: 15, step: 0.5 })).toBe(7.5);
    expect(trackValue(Number.NaN, track)).toBe(0.1);
    expect(trackValue(99, track)).toBe(0.9);
  });
});

describe("pairValue", () => {
  // Why a property: whichever thumb moves wherever, the low one ends at
  // least a step below the high one, so the pair is one the file takes.
  it("never lets the two thumbs meet or cross", () => {
    fc.assert(
      fc.property(
        tracks,
        fc.double({ min: -50, max: 200, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.constantFrom("low" as const, "high" as const),
        (track, value, at, thumb) => {
          // The other thumb on the track, with room for this one.
          const span = track.max - track.min - track.step;
          const other = trackValue(
            thumb === "low"
              ? track.min + track.step + at * span
              : track.min + at * span,
            track,
          );
          const v = pairValue(value, other, thumb, track);
          expect(onStep(v, track)).toBe(true);
          const gap = thumb === "low" ? other - v : v - other;
          expect(gap).toBeGreaterThanOrEqual(track.step - 1e-9);
        },
      ),
    );
  });

  it("lets a thumb move freely on its own side", () => {
    const track = { min: 1, max: 60, step: 1 };
    expect(pairValue(4, 20, "low", track)).toBe(4);
    expect(pairValue(25, 20, "low", track)).toBe(19);
    expect(pairValue(30, 4, "high", track)).toBe(30);
    expect(pairValue(2, 4, "high", track)).toBe(5);
  });
});

describe("rangeInput", () => {
  it("is a slider on its track, named for the focus, resting where drawn", () => {
    const s = rangeInput(
      "field-slider:maxM",
      "Reach",
      { min: 1, max: 60, step: 1 },
      120,
    );
    expect(s.type).toBe("range");
    expect([s.min, s.max, s.step]).toEqual(["1", "60", "1"]);
    expect(s.dataset["act"]).toBe("field-slider:maxM");
    expect(s.getAttribute("aria-label")).toBe("Reach");
    // A value past the track rests at its end, and goes back there.
    expect(s.value).toBe("60");
    s.value = "12";
    s.value = s.defaultValue;
    expect(s.value).toBe("60");
  });
});
