/**
 * Why these tests matter: the bar is how a visitor reads the film (where
 * am I, what is left, is it paused). In an earlier draft a touch made the current
 * segment fall back to the empty look of an upcoming one, so after one
 * tap there was no red at all: the current part must stay "current"
 * whatever the state, seen parts read as seen, coming parts as empty,
 * and a finished film as all seen with "Play again". The labels are what
 * a screen reader hears for each segment button.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { barModel } from "./film-bar.js";
import { createTimeline } from "./film-timeline.js";
import type { PlayerSnapshot } from "./film-player.js";

const TL = createTimeline(
  [
    { durS: 2, views: [{ atS: 0, view: "a" }] },
    { durS: 2, views: [{ atS: 0, view: "a" }] },
    { durS: 2, views: [{ atS: 0, view: "a" }] },
  ],
  { speed: 1, holdS: 0, camS: 1, settleS: 0 },
);
const TITLES = ["One", "Two", "Three"];
const CAPTIONS = ["First.", "Second.", "Third."];

function snap(over: Partial<PlayerSnapshot> & { t: number }): PlayerSnapshot {
  return {
    status: "playing",
    pausedBy: null,
    opening: false,
    moving: true,
    position: TL.positionAt(over.t),
    ...over,
  };
}

describe("film bar: segment looks", () => {
  it("shows seen, current and upcoming around the playing part, the current filling", () => {
    const m = barModel(snap({ t: 3 }), TITLES, CAPTIONS);
    expect(m.segments.map((s) => s.look)).toEqual([
      "seen",
      "current",
      "upcoming",
    ]);
    expect(m.segments[1]?.fill).toBeCloseTo(0.5, 12);
    expect(m.segments[0]?.fill).toBe(1);
    expect(m.segments[2]?.fill).toBe(0);
    expect(m.paused).toBe(false);
    expect(m.caption).toBe("Second.");
  });

  it("keeps the current part current when paused, by the user or by the view", () => {
    for (const pausedBy of ["user", "view", "release"] as const) {
      const m = barModel(
        snap({ t: 3, status: "paused", pausedBy, moving: false }),
        TITLES,
        CAPTIONS,
      );
      expect(m.segments[1]?.look).toBe("current");
      expect(m.paused).toBe(true);
      expect(m.button).toEqual({ kind: "play", label: "Play the film" });
    }
  });

  it("marks the first part current before the film has started", () => {
    const m = barModel(
      snap({ t: 0, status: "waiting", moving: false }),
      TITLES,
      CAPTIONS,
    );
    expect(m.segments.map((s) => s.look)).toEqual([
      "current",
      "upcoming",
      "upcoming",
    ]);
    expect(m.button).toEqual({ kind: "play", label: "Play the film" });
  });

  it("shows a finished film as all seen with Play again", () => {
    const m = barModel(
      snap({ t: TL.totalS, status: "finished", moving: false }),
      TITLES,
      CAPTIONS,
    );
    expect(m.segments.every((s) => s.look === "seen" && !s.current)).toBe(true);
    expect(m.finished).toBe(true);
    expect(m.button).toEqual({ kind: "again", label: "Play again" });
    expect(m.captionsAsList).toBe(false);
    expect(m.caption).toBe("Third.");
  });

  it("opens reduced motion as finished, with a play button and the captions as a list", () => {
    const m = barModel(
      snap({ t: TL.totalS, status: "finished", opening: true, moving: false }),
      TITLES,
      CAPTIONS,
    );
    expect(m.finished).toBe(true);
    expect(m.button).toEqual({ kind: "play", label: "Play the film" });
    expect(m.captionsAsList).toBe(true);
  });

  it("offers Pause while playing", () => {
    expect(barModel(snap({ t: 1 }), TITLES, CAPTIONS).button).toEqual({
      kind: "pause",
      label: "Pause the film",
    });
  });
});

describe("film bar: names", () => {
  it("names every segment by its part and marks exactly the current one", () => {
    const m = barModel(snap({ t: 5 }), TITLES, CAPTIONS);
    expect(m.segments.map((s) => s.label)).toEqual([
      "Part 1 of 3: One",
      "Part 2 of 3: Two",
      "Part 3 of 3: Three",
    ]);
    expect(m.segments.map((s) => s.current)).toEqual([false, false, true]);
  });

  it("refuses titles or captions that do not match the film's parts", () => {
    expect(() => barModel(snap({ t: 0 }), ["One"], CAPTIONS)).toThrow(
      RangeError,
    );
    expect(() => barModel(snap({ t: 0 }), TITLES, ["x"])).toThrow(RangeError);
  });
});

describe("film bar: properties", () => {
  it("never shows the current part as upcoming, and has at most one current part", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.constantFrom("waiting", "playing", "paused", "finished" as const),
        (frac, status) => {
          const t =
            status === "finished" ? TL.totalS : frac * TL.totalS * 0.999;
          const m = barModel(
            snap({ t, status, pausedBy: status === "paused" ? "user" : null }),
            TITLES,
            CAPTIONS,
          );
          const current = m.segments.filter((s) => s.current);
          expect(current.length).toBe(status === "finished" ? 0 : 1);
          for (const s of current) expect(s.look).toBe("current");
          for (const s of m.segments) {
            expect(s.fill).toBeGreaterThanOrEqual(0);
            expect(s.fill).toBeLessThanOrEqual(1);
          }
        },
      ),
    );
  });
});
