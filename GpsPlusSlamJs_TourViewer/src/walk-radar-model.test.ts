import { describe, expect, it } from "vitest";

import {
  walkPrecisionChip,
  walkRadarFovDeg,
  walkRadarAdaptiveRangeM,
  walkRadarModel,
  walkRadarRings,
  WALK_RADAR_RANGE_M,
  type WalkRadarGeometry,
  type WalkRadarInput,
  type WalkRadarStation,
} from "./walk-radar-model";

/**
 * Why these tests matter (visitor walk W4 build plan
 * GpsPlusSlamJs_Docs/docs/2026-10-21-1105-visitor-walk-w4-build-plan.md,
 * M3, §1.2, §1.3): the radar shows the visitor's precision instead of
 * telling it ("shown, not told"), so each precision has its own look, and
 * a wrong look is a wrong claim - an orange focus the guide cannot vouch
 * for, a blur narrower than the accuracy, a frozen radar that still moves
 * with a position nobody trusts. These pin each state's look, the rim
 * arc, the clamp, the cone's width from the XR projection and its
 * fallback, and the chip's words.
 */

const SIZE = 132;
const C = SIZE / 2;
const R = SIZE / 2 - 4;
const map = (d: number): number =>
  R * Math.sqrt(Math.min(d, WALK_RADAR_RANGE_M) / WALK_RADAR_RANGE_M);

/** Three stations: the focus, one still to find, one found. */
const STATIONS: readonly WalkRadarStation[] = [
  { id: "gate", number: 1, state: "found" },
  { id: "well", number: 2, state: "next" },
  { id: "tower", number: 3, state: "left" },
];

function geometry(
  headingDeg: number | null,
  entries: Record<string, [bearingDeg: number, distanceM: number]>,
): WalkRadarGeometry {
  return {
    headingDeg,
    bearings: new Map(Object.entries(entries).map(([id, [b]]) => [id, b])),
    distances: new Map(Object.entries(entries).map(([id, [, d]]) => [id, d])),
  };
}

const LIVE = geometry(0, {
  gate: [180, 30],
  well: [90, 100],
  tower: [0, 50],
});

function input(over: Partial<WalkRadarInput> = {}): WalkRadarInput {
  return {
    stations: STATIONS,
    order: "fixed",
    kind: "code",
    accuracyM: null,
    live: LIVE,
    snapshot: LIVE,
    fovDeg: 64,
    sizePx: SIZE,
    ...over,
  };
}

const blip = (m: ReturnType<typeof walkRadarModel>, id: string) =>
  m.blips.find((b) => b.id === id);

describe("walkPrecisionChip - the chip's words (§1.3)", () => {
  it("says each precision in W4's words", () => {
    expect(walkPrecisionChip("code", 1)).toBe("Placed by a code");
    expect(walkPrecisionChip("gps", 7.6)).toBe("GPS - about 8 m");
    expect(walkPrecisionChip("weak", 40)).toBe("GPS - about 40 m, too weak");
    expect(walkPrecisionChip("none", null)).toBe("Position unknown");
    expect(walkPrecisionChip("pending", null)).toBe("Finding your position…");
    expect(walkPrecisionChip("lost", 8)).toBe("Paused - tracking lost");
  });

  it("drops the number it does not have rather than inventing one", () => {
    expect(walkPrecisionChip("gps", null)).toBe("GPS");
    expect(walkPrecisionChip("weak", Number.NaN)).toBe("GPS - too weak");
  });
});

describe("walkRadarFovDeg - the cone's width", () => {
  it("reads the XR projection's horizontal field of view, 2 atan(1 / P[0])", () => {
    const p0 = 1 / Math.tan((32 * Math.PI) / 180);
    expect(walkRadarFovDeg(p0, 0.5)).toBeCloseTo(64, 9);
    expect(walkRadarFovDeg(1, 2)).toBeCloseTo(90, 9);
  });

  // Why this test matters (side by side with W4): W4's 64° / 44° are its
  // camera's VERTICAL field of view (three.js `fov`), so its cone is the
  // horizontal one at the screen's aspect - about 32° on a portrait phone,
  // 82° sideways. Read as horizontal, the cone drew twice W4's width.
  it("falls back to W4's camera before the first XR frame: 64° (44° when not taller than wide) vertical, at the screen's aspect", () => {
    const h = (vDeg: number, aspect: number): number =>
      (2 * Math.atan(Math.tan((vDeg * Math.PI) / 360) * aspect) * 180) /
      Math.PI;
    expect(walkRadarFovDeg(null, 390 / 844)).toBeCloseTo(h(64, 390 / 844), 9);
    expect(walkRadarFovDeg(null, 390 / 844)).toBeCloseTo(32.2, 1);
    expect(walkRadarFovDeg(null, 844 / 390)).toBeCloseTo(h(44, 844 / 390), 9);
    expect(walkRadarFovDeg(undefined, 1440 / 900)).toBeCloseTo(
      h(44, 1440 / 900),
      9,
    );
    // A square screen is not taller than wide.
    expect(walkRadarFovDeg(null, 1)).toBeCloseTo(44, 9);
  });

  it("falls back for a projection that is no camera's, and reads a screen that has no aspect as square", () => {
    for (const p0 of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(walkRadarFovDeg(p0, 1)).toBeCloseTo(44, 9);
    }
    for (const aspect of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(walkRadarFovDeg(null, aspect)).toBeCloseTo(44, 9);
    }
  });
});

describe("walkRadarRings - the scale rings", () => {
  it("draws W4's 25 m and 100 m rings at 300 m, the outer one labelled", () => {
    expect(walkRadarRings(300)).toEqual([
      { m: 25, label: null },
      { m: 100, label: "100 m" },
    ]);
  });

  it("picks round distances for another range", () => {
    expect(walkRadarRings(600).map((r) => r.m)).toEqual([50, 200]);
    expect(walkRadarRings(150).map((r) => r.m)).toEqual([10, 50]);
    expect(walkRadarRings(30).map((r) => r.m)).toEqual([2.5, 10]);
  });
});

describe("walkRadarModel - the geometry", () => {
  it("is heading-up and centred on the visitor, on a square-root scale", () => {
    const m = walkRadarModel(input());
    expect(m.mode).toBe("live");
    expect(m.centre).toBe(C);
    expect(m.rimR).toBe(R);
    // The well is 90° right of the heading, 100 m out.
    expect(blip(m, "well")?.x).toBeCloseTo(C + map(100), 9);
    expect(blip(m, "well")?.y).toBeCloseTo(C, 9);
    // The tower is straight ahead, 50 m out: up on the canvas.
    expect(blip(m, "tower")?.x).toBeCloseTo(C, 9);
    expect(blip(m, "tower")?.y).toBeCloseTo(C - map(50), 9);
    expect(m.rings.map((r) => r.r)).toEqual([map(25), map(100)]);
  });

  it("turns with the camera: north and every blip by the heading", () => {
    const m = walkRadarModel(
      input({ live: { ...LIVE, headingDeg: 90 }, kind: "gps", accuracyM: 5 }),
    );
    // Facing east, the well (east) is ahead and north is to the left.
    expect(blip(m, "well")?.x).toBeCloseTo(C, 9);
    expect(blip(m, "well")?.y).toBeCloseTo(C - map(100), 9);
    expect(m.north).toBeCloseTo(-Math.PI / 2, 9);
  });

  it("clamps a station beyond the range to the rim less 8 px", () => {
    const far = geometry(0, {
      gate: [0, 30],
      well: [0, 5000],
      tower: [0, 290],
    });
    const m = walkRadarModel(input({ live: far, snapshot: far }));
    expect(blip(m, "well")?.y).toBeCloseTo(C - (R - 8), 9);
    expect(blip(m, "well")?.clamped).toBe(true);
    expect(blip(m, "tower")?.y).toBeCloseTo(C - (R - 8), 9);
    expect(blip(m, "gate")?.clamped).toBe(false);
  });

  it("draws the view cone from the field of view while a heading exists", () => {
    expect(walkRadarModel(input()).cone).toBeCloseTo((32 * Math.PI) / 180, 9);
    expect(walkRadarModel(input({ fovDeg: 44 })).cone).toBeCloseTo(
      (22 * Math.PI) / 180,
      9,
    );
  });

  it("labels no station's distance in any state (R-0)", () => {
    // The model has no text for a station but its tour number.
    for (const kind of ["code", "gps", "weak", "none", "lost"] as const) {
      const m = walkRadarModel(input({ kind, accuracyM: 8 }));
      for (const b of m.blips) {
        expect(Object.keys(b).sort()).toEqual(
          ["alpha", "clamped", "id", "look", "number", "r", "x", "y"].sort(),
        );
      }
    }
  });
});

describe("walkRadarModel - the blips' looks", () => {
  it("draws the focus orange and larger, the others by their state", () => {
    const m = walkRadarModel(input());
    expect(blip(m, "well")).toMatchObject({ look: "focus", r: 8.5 });
    expect(blip(m, "tower")).toMatchObject({ look: "left", r: 6.5 });
    expect(blip(m, "gate")).toMatchObject({ look: "found", r: 6.5 });
  });

  it("draws a skipped station dashed and a later one small", () => {
    const m = walkRadarModel(
      input({
        stations: [
          { id: "gate", number: 1, state: "skipped" },
          { id: "well", number: 2, state: "next" },
          { id: "tower", number: 3, state: "later" },
        ],
      }),
    );
    expect(blip(m, "gate")).toMatchObject({ look: "skipped", r: 6.5 });
    expect(blip(m, "tower")).toMatchObject({ look: "later", r: 3.5 });
  });

  it("draws the station whose story plays as found", () => {
    const m = walkRadarModel(
      input({ stations: [{ id: "well", number: 2, state: "here" }] }),
    );
    expect(blip(m, "well")?.look).toBe("found");
  });

  it("puts an arc on the rim only for a focus outside the view", () => {
    // The well is 90° right: outside a 64° view.
    expect(walkRadarModel(input()).rimArc).toBeCloseTo(Math.PI / 2, 9);
    // Facing it: inside.
    const facing = { ...LIVE, headingDeg: 80 };
    expect(walkRadarModel(input({ live: facing })).rimArc).toBeNull();
    // A wide view holds it too.
    expect(walkRadarModel(input({ fovDeg: 190 })).rimArc).toBeNull();
    // Another station outside the view gets no arc.
    const tower = geometry(0, {
      gate: [0, 30],
      well: [0, 100],
      tower: [120, 50],
    });
    expect(walkRadarModel(input({ live: tower })).rimArc).toBeNull();
  });
});

describe("walkRadarModel - the visitor's mark by precision (§1.2)", () => {
  it("code: a pin", () => {
    expect(walkRadarModel(input()).visitor).toEqual({ kind: "pin" });
  });

  it("GPS: a blue blur as wide as the accuracy on the radar's scale, at least 7 px", () => {
    const m = walkRadarModel(input({ kind: "gps", accuracyM: 8 }));
    expect(m.visitor).toEqual({ kind: "blur", tone: "gps", r: map(8) });
    const tiny = walkRadarModel(input({ kind: "gps", accuracyM: 1 }));
    expect(tiny.visitor).toEqual({ kind: "blur", tone: "gps", r: 7 });
  });

  it("too weak: an amber blur, the stations at half opacity, no orange in an any-order choice", () => {
    const m = walkRadarModel(
      input({ kind: "weak", accuracyM: 40, order: "any" }),
    );
    expect(m.visitor).toEqual({ kind: "blur", tone: "weak", r: map(40) });
    expect(m.blips.every((b) => b.alpha === 0.5)).toBe(true);
    expect(m.blips.some((b) => b.look === "focus")).toBe(false);
    // In a fixed order there is no guess to make: the focus stays.
    const fixed = walkRadarModel(input({ kind: "weak", accuracyM: 40 }));
    expect(blip(fixed, "well")?.look).toBe("focus");
  });

  it("'none': the geometry frozen from the last snapshot, a '?', no orange; the statuses live", () => {
    const snapshot = geometry(0, {
      gate: [180, 30],
      well: [270, 60],
      tower: [0, 50],
    });
    const m = walkRadarModel(
      input({
        kind: "none",
        snapshot,
        stations: [
          { id: "gate", number: 1, state: "found" },
          { id: "well", number: 2, state: "next" },
          { id: "tower", number: 3, state: "skipped" },
        ],
      }),
    );
    expect(m.mode).toBe("frozen");
    expect(m.visitor).toEqual({ kind: "unknown" });
    // The well where the snapshot put it (60 m to the left), not the
    // live 100 m to the right.
    expect(blip(m, "well")?.x).toBeCloseTo(C - map(60), 9);
    expect(blip(m, "well")?.look).toBe("left");
    // A status changed since the snapshot shows at once.
    expect(blip(m, "tower")?.look).toBe("skipped");
    expect(m.rimArc).toBeNull();
    // North from the snapshot's heading; no view cone: the radar is
    // heading-up, so a frozen cone would claim a live view of nothing.
    expect(m.north).toBeCloseTo(0, 9);
    expect(m.cone).toBeNull();
  });

  it("tracking lost: frozen like 'none', with no view cone", () => {
    const m = walkRadarModel(input({ kind: "lost", accuracyM: 8 }));
    expect(m.mode).toBe("frozen");
    expect(m.visitor).toEqual({ kind: "unknown" });
    expect(m.blips.some((b) => b.look === "focus")).toBe(false);
    expect(m.cone).toBeNull();
  });

  it("frozen with no snapshot: the '?' alone", () => {
    const m = walkRadarModel(input({ kind: "none", snapshot: null }));
    expect(m.mode).toBe("frozen");
    expect(m.blips).toEqual([]);
    expect(m.distanceRings).toEqual([]);
    expect(m.north).toBeNull();
    expect(m.cone).toBeNull();
  });

  it("pending: the pulsing rings and nothing else", () => {
    const m = walkRadarModel(
      input({ kind: "pending", live: geometry(30, {}) }),
    );
    expect(m.mode).toBe("pending");
    expect(m.visitor).toEqual({ kind: "pending" });
    expect(m.blips).toEqual([]);
    expect(m.distanceRings).toEqual([]);
    expect(m.cone).toBeNull();
    expect(m.rimArc).toBeNull();
    // North needs only the heading.
    expect(m.north).toBeCloseTo((-30 * Math.PI) / 180, 9);
  });

  it("no heading yet: a dashed ring per station still to find at its distance", () => {
    const noHeading = { ...LIVE, headingDeg: null };
    const m = walkRadarModel(
      input({ kind: "gps", accuracyM: 9, live: noHeading }),
    );
    expect(m.blips).toEqual([]);
    expect(m.cone).toBeNull();
    expect(m.north).toBeNull();
    expect(m.rimArc).toBeNull();
    // The found gate is left out.
    expect(m.distanceRings).toEqual([
      { id: "well", r: map(100), focus: true },
      { id: "tower", r: map(50), focus: false },
    ]);
    expect(m.visitor).toEqual({ kind: "blur", tone: "gps", r: map(9) });
  });

  it("no heading: a station a few metres away still gets a ring you can see", () => {
    const near = geometry(null, { well: [0, 0.5] });
    const m = walkRadarModel(
      input({
        live: near,
        stations: [{ id: "well", number: 2, state: "next" }],
      }),
    );
    expect(m.distanceRings[0]?.r).toBe(6);
  });

  it("draws a station without a measured distance nowhere", () => {
    const partial = geometry(0, { well: [90, 100] });
    const m = walkRadarModel(input({ live: partial }));
    expect(m.blips.map((b) => b.id)).toEqual(["well"]);
  });
});

describe("walkRadarModel - its guards", () => {
  it("refuses a size or a range that is no positive number", () => {
    expect(() => walkRadarModel(input({ sizePx: 0 }))).toThrow(RangeError);
    expect(() => walkRadarModel(input({ rangeM: Number.NaN }))).toThrow(
      RangeError,
    );
  });

  it("treats a field of view that is no angle as W4's fallback on a square screen", () => {
    const m = walkRadarModel(input({ fovDeg: Number.NaN }));
    expect(m.cone).toBeCloseTo((22 * Math.PI) / 180, 9);
  });
});

describe("walkRadarAdaptiveRangeM - the range the sweep ships", () => {
  it("is the 2nd nearest station still to find times 1.2, rounded up to a step", () => {
    // 2nd nearest 50 m: 60 m, a step.
    expect(walkRadarAdaptiveRangeM([10, 50, 430], null)).toBe(60);
    // 2nd nearest 40 m: 48 m, rounded up to 50.
    expect(walkRadarAdaptiveRangeM([70, 20, 40], null)).toBe(50);
  });

  it("reads the farthest when fewer than two are left, and keeps the range with none", () => {
    expect(walkRadarAdaptiveRangeM([100], null)).toBe(125);
    expect(walkRadarAdaptiveRangeM([], 80)).toBe(80);
    expect(walkRadarAdaptiveRangeM([], null)).toBe(WALK_RADAR_RANGE_M);
    expect(walkRadarAdaptiveRangeM([Number.NaN, -1], null)).toBe(
      WALK_RADAR_RANGE_M,
    );
  });

  it("clamps to 10-600 m", () => {
    // A museum's stations a few metres apart: the 10 m floor (the sweep's
    // museum tours overlap far less at 10 m than at 30 m).
    expect(walkRadarAdaptiveRangeM([1, 2, 3], null)).toBe(10);
    expect(walkRadarAdaptiveRangeM([4, 7, 9], null)).toBe(10);
    expect(walkRadarAdaptiveRangeM([900, 1000, 5000], null)).toBe(600);
  });

  it("grows at once and shrinks only below 65 % of the range shown", () => {
    // Raw 60 m above the shown 50: grows.
    expect(walkRadarAdaptiveRangeM([10, 50, 90], 50)).toBe(60);
    // Raw 48 m under the shown 60 (80 %): kept.
    expect(walkRadarAdaptiveRangeM([10, 40, 90], 60)).toBe(60);
    // Raw 36 m (60 % of 60): shrinks to its own step.
    expect(walkRadarAdaptiveRangeM([10, 30, 90], 60)).toBe(40);
  });

  it("draws its rings at round distances for the range", () => {
    const m = walkRadarModel(input({ rangeM: 60 }));
    expect(m.rangeM).toBe(60);
    expect(m.rings.map((r) => r.label)).toEqual([null, "20 m"]);
  });
});
