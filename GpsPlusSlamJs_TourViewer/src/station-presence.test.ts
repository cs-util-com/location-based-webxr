import { describe, expect, it } from "vitest";

import { ACCURACY_CEILING_M } from "./station-bands";
import {
  nextPresentStation,
  presenceCandidates,
  presentAfterWeakFix,
  takeoverMarginM,
  TAKEOVER_MARGIN_MIN_M,
  type PresenceCandidate,
} from "./station-presence";

/**
 * Why these tests matter: the presence rule decides which ONE station's
 * content a visitor sees (visitor plan 2026-10-18-2349 §3, D7, D9). It must
 * enter at the found radius, leave only past the found exit, hand over to a
 * neighbour only by the takeover margin, and hold still when there is no
 * position to judge by - a tracking drop must not blank the exhibit in
 * front of the visitor.
 */

/** A station at distance `d` with a found radius and a band. */
function at(id: string, d: number, foundM = 2, bandM = 1.5): PresenceCandidate {
  return { id, distanceM: d, foundM, foundExitM: foundM + bandM };
}

const M = TAKEOVER_MARGIN_MIN_M;

describe("nextPresentStation", () => {
  it("enters a station at its found radius, not before", () => {
    expect(nextPresentStation(null, [at("a", 2.01)], M)).toBeNull();
    expect(nextPresentStation(null, [at("a", 2)], M)).toBe("a");
  });

  it("keeps the present station inside its found exit and leaves it past the exit", () => {
    expect(nextPresentStation("a", [at("a", 3.5)], M)).toBe("a");
    expect(nextPresentStation("a", [at("a", 3.51)], M)).toBeNull();
  });

  it("with none present, the nearest station whose found radius holds the position becomes present", () => {
    expect(nextPresentStation(null, [at("a", 1.8), at("b", 1.2)], M)).toBe("b");
    // A tie goes to the first in the list (the tour's order).
    expect(nextPresentStation(null, [at("a", 1), at("b", 1)], M)).toBe("a");
  });

  it("a neighbour takes over only when nearer by the margin, or once the present station's exit is passed", () => {
    const m = 1;
    // Inside B's found radius, but not nearer than A by m: A stays.
    expect(nextPresentStation("a", [at("a", 2.5), at("b", 1.6)], m)).toBe("a");
    // Nearer by more than m: B takes over.
    expect(nextPresentStation("a", [at("a", 2.7), at("b", 1.6)], m)).toBe("b");
    // Exactly m nearer is not enough (strict, as the plan's d_B + m < d_A).
    expect(nextPresentStation("a", [at("a", 2.6), at("b", 1.6)], m)).toBe("a");
    // Past A's exit, B takes over without the margin.
    expect(nextPresentStation("a", [at("a", 3.6), at("b", 1.9)], 10)).toBe("b");
    // A neighbour outside its own found radius never takes over.
    expect(nextPresentStation("a", [at("a", 3.4), at("b", 2.1)], 0)).toBe("a");
  });

  it("holds on no judged position (a tracking drop, a stale fix)", () => {
    expect(nextPresentStation("a", null, M)).toBe("a");
    expect(nextPresentStation(null, null, M)).toBeNull();
  });

  it("drops a present station the judged position no longer measures (gone from the tour)", () => {
    expect(nextPresentStation("a", [at("b", 10)], M)).toBeNull();
    expect(nextPresentStation("a", [at("b", 1)], M)).toBe("b");
  });

  it("ignores a candidate whose numbers are not finite, and reads a nonsense margin as none", () => {
    expect(nextPresentStation(null, [at("a", Number.NaN)], M)).toBeNull();
    expect(
      nextPresentStation(
        null,
        [{ id: "a", distanceM: 1, foundM: Number.NaN, foundExitM: 3 }],
        M,
      ),
    ).toBeNull();
    // A present station with a broken distance leaves (it cannot be held
    // inside an exit nobody can measure).
    expect(
      nextPresentStation("a", [at("a", Number.POSITIVE_INFINITY)], M),
    ).toBeNull();
    expect(
      nextPresentStation("a", [at("a", 2.7), at("b", 1.6)], Number.NaN),
    ).toBe("b");
    expect(nextPresentStation("a", [at("a", 2.7), at("b", 1.6)], -5)).toBe("b");
  });

  it("with no margin, two circles' shared strip flips on every centimetre: why the margin exists", () => {
    // Two 2 m stations 3 m apart: the strip between them is inside both.
    // At m = 0 a visitor swaying 10 cm across the midline switches each
    // time; at the floor margin they do not.
    let flips0 = 0;
    let flipsFloor = 0;
    let p0: string | null = "a";
    let pFloor: string | null = "a";
    for (let i = 0; i < 20; i += 1) {
      const x = 1.5 + (i % 2 === 0 ? 0.05 : -0.05);
      const c = [at("a", x), at("b", 3 - x)];
      const n0 = nextPresentStation(p0, c, 0);
      const nF = nextPresentStation(pFloor, c, M);
      if (n0 !== p0) flips0 += 1;
      if (nF !== pFloor) flipsFloor += 1;
      p0 = n0;
      pFloor = nF;
    }
    expect(flips0).toBeGreaterThan(5);
    expect(flipsFloor).toBe(0);
  });
});

describe("takeoverMarginM", () => {
  it("is the judged accuracy, at least the floor: a code's position (null) takes the floor", () => {
    // Why: the sweep (station-presence.sweep.test.ts) finds the margin must
    // match the position's noise - a code's AR position wanders centimetres,
    // a raw fix metres. One fixed value either flickers outdoors or shows
    // the previous exhibit too long indoors.
    expect(takeoverMarginM(null, true)).toBe(TAKEOVER_MARGIN_MIN_M);
    expect(takeoverMarginM(8, true)).toBe(TAKEOVER_MARGIN_MIN_M);
    expect(takeoverMarginM(0.2, false)).toBe(TAKEOVER_MARGIN_MIN_M);
    expect(takeoverMarginM(8, false)).toBe(8);
    expect(TAKEOVER_MARGIN_MIN_M).toBe(1);
  });

  it("without a code reads a missing or nonsense accuracy as the ceiling, as the bands do, and never exceeds it", () => {
    // Why (PR review N1): an unknown raw accuracy is the widest band there
    // is (`stationBands`' clamp); a 1 m margin beside a 25 m band would
    // let a neighbour take over on noise the band itself allows for.
    for (const nonsense of [null, 0, -3, Number.NaN]) {
      expect(takeoverMarginM(nonsense, false)).toBe(ACCURACY_CEILING_M);
    }
    expect(takeoverMarginM(400, false)).toBe(ACCURACY_CEILING_M);
  });
});

describe("presentAfterWeakFix", () => {
  // Why (PR review S1): a fix too weak to guide by (an underpass, a ±40 m
  // indoor fix) judges no arrival and no entry, but it can still prove the
  // visitor left: even `accuracy` metres nearer, the position is past the
  // present station's found exit. Holding forever on it kept a station's
  // content up for the rest of the session.
  const a = (d: number): PresenceCandidate => ({
    id: "a",
    distanceM: d,
    foundM: 5,
    foundExitM: 30,
  });
  const b = (d: number): PresenceCandidate => ({
    id: "b",
    distanceM: d,
    foundM: 5,
    foundExitM: 30,
  });

  it("ends presence only when the position is past the exit by more than its accuracy", () => {
    expect(presentAfterWeakFix("a", [a(60)], 40)).toBe("a");
    expect(presentAfterWeakFix("a", [a(70)], 40)).toBe("a");
    expect(presentAfterWeakFix("a", [a(70.1)], 40)).toBeNull();
  });

  it("never enters a station nor hands over to one", () => {
    expect(presentAfterWeakFix(null, [a(0), b(0)], 40)).toBeNull();
    expect(presentAfterWeakFix("a", [a(50), b(0)], 40)).toBe("a");
    expect(presentAfterWeakFix("a", [a(100), b(0)], 40)).toBeNull();
  });

  it("holds without candidates, without the present station, or on a nonsense accuracy", () => {
    expect(presentAfterWeakFix("a", null, 40)).toBe("a");
    expect(presentAfterWeakFix("a", [b(0)], 40)).toBe("a");
    expect(presentAfterWeakFix("a", [a(500)], Number.NaN)).toBe("a");
    expect(presentAfterWeakFix("a", [a(Number.NaN)], 40)).toBe("a");
  });
});

describe("presenceCandidates", () => {
  const stations = [
    { id: "a", activateRadiusM: 20, foundRadiusM: 2 },
    { id: "b", activateRadiusM: 20, foundRadiusM: 3 },
    { id: "c", activateRadiusM: 20, foundRadiusM: 4 },
  ];
  const bands = (s: { foundRadiusM: number }) => ({
    activateM: 20,
    foundM: s.foundRadiusM,
    foundExitM: s.foundRadiusM + 1.5,
  });

  it("measures every station with a distance, whatever the order or its state (V-D5)", () => {
    // Why: placed content does not follow the order - a fixed tour may
    // show a later station's photos early. The caller passes no offer.
    const out = presenceCandidates(
      stations,
      new Map([
        ["a", 10],
        ["c", 1],
      ]),
      bands,
    );
    expect(out).toEqual([
      { id: "a", distanceM: 10, foundM: 2, foundExitM: 3.5 },
      { id: "c", distanceM: 1, foundM: 4, foundExitM: 5.5 },
    ]);
  });

  it("is null when no station has a distance (no position, or no zero yet): presence holds", () => {
    expect(presenceCandidates(stations, new Map(), bands)).toBeNull();
  });
});
