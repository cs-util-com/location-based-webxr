/**
 * Why this test matters: the travelling box decides every frame whether a
 * narrated text's words stand on their plate under the sign, sit docked at
 * the screen's foot, or are hidden. These pin that decision's order and
 * its edges (the 0.88 / 0.95 edge margins, the 0.95 keep factor, the angle
 * limit), the flight's end points, the sign's growth, and the letter size
 * the decision reads, against values worked out by hand for the build's
 * own geometry (eye 1.6 m, the check page's aim, a phone in portrait), so
 * a slip in the projection arithmetic cannot hide behind a test that
 * computes its expectation the same way.
 */

import { PerspectiveCamera, Vector4 } from "three";
import { describe, expect, it } from "vitest";

import { READING_SIGN, READING_SIGN_HEIGHT_M } from "./reading-sign";
import {
  easeInOutCubic,
  facingAngleDeg,
  flightClip,
  inQuad,
  letterGate,
  plateMetrics,
  plateSizeM,
  settlePlace,
  signGrowth,
  stepToward,
  TRAVEL_EDGE,
  TRAVEL_PLATE,
  TRAVELLING_BOX_DEFAULTS,
  wantPlace,
  type PlateMetrics,
  type WantInput,
} from "./travelling-box-rules";
import { quadOfClip } from "./test-support/quad-of-clip.js";

const K = TRAVELLING_BOX_DEFAULTS;

/** Metrics of a plate well inside the view, `letterPx` big. */
function seen(letterPx: number, ndc = 0): PlateMetrics {
  return {
    valid: true,
    onScreen: true,
    ndcX: ndc,
    ndcY: 0,
    letterPxH: letterPx,
    letterPxW: letterPx,
    letterPx,
    linePx: (letterPx * 22) / 16,
  };
}

/** A want input whose letter gate reads its metrics (the default knobs'
 *  metric), unless the gates are given. */
function want(over: Partial<WantInput> = {}): WantInput {
  const metrics = over.metrics ?? seen(20);
  return {
    travelling: true,
    hideWhy: null,
    gates: [letterGate(metrics, K)],
    metrics,
    angleDeg: 0,
    onPlate: false,
    slotFree: true,
    canFold: false,
    ...over,
  };
}

describe("wantPlace", () => {
  it("names each reason, in the prototype's order", () => {
    // Each case breaks every later rule too, so a reordering shows.
    const invalid: PlateMetrics = { ...seen(5), valid: false };
    expect(
      wantPlace(want({ travelling: false, hideWhy: "sheet open" }), K),
    ).toEqual({ place: "hidden", why: "not travelling" });
    for (const hideWhy of [
      "no voice",
      "outside the station",
      "sheet open",
    ] as const) {
      expect(
        wantPlace(want({ hideWhy, metrics: invalid, slotFree: false }), K),
      ).toEqual({ place: "hidden", why: hideWhy });
    }
    expect(wantPlace(want({ metrics: invalid, angleDeg: 89 }), K)).toEqual({
      place: "dock",
      why: "out of view",
    });
    expect(wantPlace(want({ metrics: seen(5, 0.9), angleDeg: 89 }), K)).toEqual(
      { place: "dock", why: "out of view" },
    );
    expect(wantPlace(want({ metrics: seen(5), angleDeg: 61 }), K)).toEqual({
      place: "dock",
      why: "turned away",
    });
    expect(wantPlace(want({ metrics: seen(11.9) }), K)).toEqual({
      place: "dock",
      why: "too small",
    });
    expect(wantPlace(want({ metrics: seen(12) }), K)).toEqual({
      place: "plate",
      why: "readable",
    });
  });

  it("enters within 0.88 of the view's half size and keeps the plate out to 0.95", () => {
    // Why: the wider margin to keep is the hysteresis that stops a plate
    // near the edge from flickering between plate and dock.
    expect(TRAVEL_EDGE).toEqual({ enter: 0.88, keep: 0.95 });
    for (const [ndc, onPlate, place] of [
      [0.87, false, "plate"],
      [0.89, false, "dock"],
      [0.94, true, "plate"],
      [0.96, true, "dock"],
      [-0.94, true, "plate"],
    ] as const) {
      expect(
        wantPlace(want({ metrics: seen(20, ndc), onPlate }), K).place,
      ).toBe(place);
    }
    const high = { ...seen(20), ndcY: -0.9 };
    expect(wantPlace(want({ metrics: high }), K).place).toBe("dock");
    expect(wantPlace(want({ metrics: high, onPlate: true }), K).place).toBe(
      "plate",
    );
  });

  it("keeps the plate down to 0.95 of the 12 px threshold, 11.4 px", () => {
    expect(K.thr * K.keep).toBeCloseTo(11.4, 9);
    expect(
      wantPlace(want({ metrics: seen(11.41), onPlate: true }), K).place,
    ).toBe("plate");
    expect(
      wantPlace(want({ metrics: seen(11.39), onPlate: true }), K).place,
    ).toBe("dock");
    expect(wantPlace(want({ metrics: seen(11.41) }), K).place).toBe("dock");
  });

  it("docks past the angle limit, 60 degrees", () => {
    expect(wantPlace(want({ angleDeg: 60 }), K).place).toBe("plate");
    expect(wantPlace(want({ angleDeg: 60.01 }), K).place).toBe("dock");
    expect(wantPlace(want({ angleDeg: 40 }), { ...K, angle: 35 }).place).toBe(
      "dock",
    );
  });

  it("reads the knob's metric: the height alone ignores a squashed width", () => {
    const squashed: PlateMetrics = {
      ...seen(20),
      letterPxW: 8,
      letterPx: 8,
    };
    expect(wantPlace(want({ metrics: squashed }), K).place).toBe("dock");
    const h = { ...K, metric: "h" } as const;
    expect(
      wantPlace(
        want({ metrics: squashed, gates: [letterGate(squashed, h)] }),
        h,
      ).place,
    ).toBe("plate");
  });

  // Why: other surfaces bring other sizes to reach (a picture, a control
  // to touch); any one below its own threshold docks, and the keep factor
  // applies to each.
  it("docks when any gate is under its threshold, each kept to 0.95", () => {
    const gates = [
      { kind: "letter", px: 20, thr: 12 },
      { kind: "touch", px: 43, thr: 44 },
    ] as const;
    expect(wantPlace(want({ gates }), K)).toEqual({
      place: "dock",
      why: "too small",
    });
    expect(wantPlace(want({ gates, onPlate: true }), K).place).toBe("plate");
    expect(wantPlace(want({ gates: [] }), K).place).toBe("plate");
  });

  // Why: a surface that would dock while another owns the slot must not
  // queue there; it folds into its mark, or stays on its plate when it
  // has none. A readable plate is never sent to fold.
  it("folds, or stays on the plate, when it would dock without its slot", () => {
    const small = seen(5);
    expect(
      wantPlace(want({ metrics: small, slotFree: false, canFold: true }), K),
    ).toEqual({ place: "fold", why: "slot taken" });
    expect(
      wantPlace(want({ metrics: small, slotFree: false, canFold: false }), K),
    ).toEqual({ place: "plate", why: "slot taken" });
    expect(wantPlace(want({ slotFree: false, canFold: true }), K)).toEqual({
      place: "plate",
      why: "readable",
    });
  });
});

describe("settlePlace", () => {
  const free = { fingerDown: false, sinceReleaseS: Infinity };

  it("moves after the want has held the hold time, not before", () => {
    let s = {
      place: "plate" as const,
      pending: null,
      pendingS: 0,
    } as Parameters<typeof settlePlace>[0];
    s = settlePlace(s, "dock", 0.1, free, K);
    s = settlePlace(s, "dock", 0.1, free, K);
    s = settlePlace(s, "dock", 0.1, free, K);
    expect(s.place).toBe("plate");
    s = settlePlace(s, "dock", 0.1, free, K);
    expect(s.place).toBe("dock");
    expect(s.pending).toBeNull();
  });

  it("starts the hold again when the want changes back", () => {
    let s = settlePlace(
      { place: "plate", pending: null, pendingS: 0 },
      "dock",
      0.2,
      free,
      K,
    );
    s = settlePlace(s, "plate", 0.2, free, K);
    s = settlePlace(s, "dock", 0.2, free, K);
    s = settlePlace(s, "dock", 0.2, free, K);
    expect(s.place).toBe("plate");
  });

  // Why: a fold is a dock claim that did not win, so it waits the dock's
  // hold, not the plate's.
  it("waits the dock's hold to fold", () => {
    const k = { ...K, holdDock: 0.2, holdPlate: 1 };
    let s = settlePlace(
      { place: "plate", pending: null, pendingS: 0 },
      "fold",
      0.1,
      free,
      k,
    );
    s = settlePlace(s, "fold", 0.1, free, k);
    expect(s.place).toBe("plate");
    s = settlePlace(s, "fold", 0.1, free, k);
    expect(s.place).toBe("fold");
  });

  it("hides at once, and appears from hidden at once", () => {
    const shown = settlePlace(
      { place: "hidden", pending: null, pendingS: 0 },
      "dock",
      0.016,
      free,
      K,
    );
    expect(shown.place).toBe("dock");
    const gone = settlePlace(shown, "hidden", 0.016, free, K);
    expect(gone.place).toBe("hidden");
  });

  it("holds still under a finger and for the lock after the release", () => {
    // Why: the box must not fly out from under a finger that is scrubbing
    // its words, nor the moment the finger lifts (0.3 s lock).
    let s = { place: "dock", pending: null, pendingS: 0 } as Parameters<
      typeof settlePlace
    >[0];
    for (let i = 0; i < 20; i++) {
      s = settlePlace(
        s,
        "plate",
        0.1,
        { fingerDown: true, sinceReleaseS: 0 },
        K,
      );
    }
    expect(s.place).toBe("dock");
    s = settlePlace(
      s,
      "plate",
      0.1,
      { fingerDown: false, sinceReleaseS: 0.2 },
      K,
    );
    expect(s.place).toBe("dock");
    s = settlePlace(
      s,
      "plate",
      0.1,
      { fingerDown: false, sinceReleaseS: 0.3 },
      K,
    );
    expect(s.place).toBe("plate");
  });
});

describe("the flight", () => {
  const src = [
    -2, 1, 0.5, 4, 2, 1, 0.5, 4, -2, -1, 0.5, 4, 2, -1, 0.5, 4,
  ] as const;
  const dock = [-0.7, -0.6, 0.7, -0.6, -0.7, -0.9, 0.7, -0.9] as const;

  it("starts at the plate's clip corners and ends at the dock's NDC", () => {
    expect(Array.from(flightClip(src, dock, 0, new Array<number>(16)))).toEqual(
      Array.from(src),
    );
    const end = flightClip(src, dock, 1, new Array<number>(16));
    for (let i = 0; i < 4; i++) {
      const w = end[i * 4 + 3]!;
      expect(w).toBeCloseTo(4, 9);
      expect(end[i * 4]! / w).toBeCloseTo(dock[i * 2]!, 9);
      expect(end[i * 4 + 1]! / w).toBeCloseTo(dock[i * 2 + 1]!, 9);
      expect(end[i * 4 + 2]).toBeCloseTo(0, 9);
    }
  });

  it("steps toward its target by dt over the duration, and snaps under reduced motion", () => {
    expect(stepToward(0, 1, 0.3, 0.6, false)).toBeCloseTo(0.5, 9);
    expect(stepToward(0.9, 1, 0.3, 0.6, false)).toBe(1);
    expect(stepToward(0.2, 0, 0.3, 0.6, false)).toBe(0);
    expect(stepToward(0.2, 1, 0.01, 0.6, true)).toBe(1);
    expect(stepToward(0.2, 1, 0.01, 0, false)).toBe(1);
    expect(stepToward(0.4, 1, 0, 0.6, false)).toBe(0.4);
  });

  it("eases in and out with its ends fixed", () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 9);
    expect(easeInOutCubic(0.25)).toBeCloseTo(0.0625, 9);
  });
});

describe("signGrowth", () => {
  it("is 1 to 4.5 m, then d / 4.5, at most 1.6 from 7.2 m", () => {
    expect(signGrowth(3)).toBe(1);
    expect(signGrowth(4.5)).toBe(1);
    expect(signGrowth(6)).toBeCloseTo(6 / 4.5, 9);
    expect(signGrowth(7.2)).toBeCloseTo(1.6, 9);
    expect(signGrowth(10)).toBe(1.6);
    expect(signGrowth(Number.NaN)).toBe(1);
  });
});

describe("facingAngleDeg", () => {
  it("is the angle between the plate's normal and the way to the camera", () => {
    expect(facingAngleDeg([0, 1], [0, 5])).toBeCloseTo(0, 9);
    expect(facingAngleDeg([0, 1], [5, 5])).toBeCloseTo(45, 9);
    expect(facingAngleDeg([0, 1], [-5, 0])).toBeCloseTo(90, 9);
    expect(facingAngleDeg([0, 1], [0, -2])).toBeCloseTo(180, 9);
    expect(facingAngleDeg([0, 0], [1, 1])).toBe(0);
  });
});

describe("the quad on screen", () => {
  it("maps clip corners to pixels in polygon order and finds a point inside", () => {
    const clip = [
      -0.5, 0.5, 0, 1, 0.5, 0.5, 0, 1, -0.5, -0.5, 0, 1, 0.5, -0.5, 0, 1,
    ];
    const quad = quadOfClip(clip, 400, 800) ?? [];
    expect(quad).toEqual([
      [100, 200],
      [300, 200],
      [300, 600],
      [100, 600],
    ]);
    expect(inQuad(200, 400, quad)).toBe(true);
    expect(inQuad(99, 400, quad)).toBe(false);
    expect(inQuad(200, 601, quad)).toBe(false);
  });
});

describe("plateSizeM", () => {
  it("makes one em 0.136 m: the 272 x 108 travel box is 2.312 x 0.918 m", () => {
    expect(TRAVEL_PLATE).toEqual({ emM: 0.136, gapM: 0.07, frontM: 0.04 });
    const size = plateSizeM(272, 108, 16);
    expect(size.widthM).toBeCloseTo(2.312, 9);
    expect(size.heightM).toBeCloseTo(0.918, 9);
    expect(() => plateSizeM(272, 108, 0)).toThrow(RangeError);
    expect(plateSizeM(272, 108, 16, 0.17).widthM).toBeCloseTo(2.89, 9);
    expect(() => plateSizeM(272, 108, 16, 0)).toThrow(RangeError);
  });
});

/**
 * The build's geometry, worked by hand: the travel box 272 x 108 at 16 px,
 * its plate's top 0.07 m under the sign's lower edge and 0.04 m in front,
 * all of it scaled by the growth; the eye 1.6 m up and level with the
 * sign's foot at distance d, pitched to look between the sign's centre and
 * the plate's (the check page's aim); a 390 x 844 portrait at 42 degrees
 * across.
 */
describe("plateMetrics, against the build's geometry", () => {
  const viewW = 390;
  const viewH = 844;
  const tanH = Math.tan((21 * Math.PI) / 180);
  const tanV = (tanH * viewH) / viewW;
  const lens = 1 / tanV;
  const box = plateSizeM(272, 108, 16);
  const signBottom = READING_SIGN.centreM - READING_SIGN_HEIGHT_M / 2;
  const plateTop = signBottom - TRAVEL_PLATE.gapM;
  const plateCentre = plateTop - box.heightM / 2;

  /** Screen y (px) of a point at height y and horizontal distance D in
   *  front of an eye at 1.6 m pitched up by p, and that point's depth. */
  function screenY(y: number, D: number, p: number) {
    const ry = y - 1.6;
    const depth = ry * Math.sin(p) + D * Math.cos(p);
    const up = ry * Math.cos(p) - D * Math.sin(p);
    return { px: (viewH / 2) * (1 - (lens * up) / depth), depth };
  }

  function analytic(d: number) {
    const g = signGrowth(d);
    const D = d - TRAVEL_PLATE.frontM * g;
    const lookH = ((READING_SIGN.centreM + plateCentre) / 2) * g;
    const p = Math.atan2(lookH - 1.6, d);
    const top = screenY(plateTop * g, D, p);
    const bottom = screenY((plateTop - box.heightM) * g, D, p);
    const H = ((bottom.px - top.px) * 16) / 108;
    const mid = screenY(plateCentre * g, D, p);
    const W = (TRAVEL_PLATE.emM * g * lens * viewH) / (2 * mid.depth);
    return { g, p, H, W };
  }

  function measured(d: number) {
    const { g, p } = analytic(d);
    const camera = new PerspectiveCamera(
      (2 * Math.atan(tanV) * 180) / Math.PI,
      viewW / viewH,
      0.05,
      100,
    );
    camera.rotation.order = "YXZ";
    camera.rotation.x = p;
    camera.position.set(0, 1.6, 0);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    const z = -(d - TRAVEL_PLATE.frontM * g);
    const hw = (box.widthM / 2) * g;
    const top = plateTop * g;
    const bottom = (plateTop - box.heightM) * g;
    const clip = (x: number, y: number) =>
      new Vector4(x, y, z, 1)
        .applyMatrix4(camera.matrixWorldInverse)
        .applyMatrix4(camera.projectionMatrix);
    const corners = [
      clip(-hw, top),
      clip(hw, top),
      clip(-hw, bottom),
      clip(hw, bottom),
    ].flatMap((v) => [v.x, v.y, v.z, v.w]);
    const c = clip(0, plateCentre * g);
    return plateMetrics(
      corners,
      [c.x, c.y, c.z, c.w],
      viewW,
      viewH,
      272,
      108,
      16,
      22,
    );
  }

  it.each([3, 7, 16])(
    "at %s m the letter is the hand-worked size within 0.1 px",
    (d) => {
      const want = analytic(d);
      const got = measured(d);
      expect(got.valid).toBe(true);
      expect(got.onScreen).toBe(true);
      expect(Math.abs(got.letterPxH - want.H)).toBeLessThan(0.1);
      expect(Math.abs(got.letterPxW - want.W)).toBeLessThan(0.1);
      expect(got.letterPx).toBeCloseTo(
        Math.min(got.letterPxH, got.letterPxW),
        9,
      );
      expect(got.linePx).toBeCloseTo((got.letterPx * 22) / 16, 9);
    },
  );

  it("is about 23 px at 3 m, the rounded figure worked by hand", () => {
    // 0.136 m x a 508 px lens / 2.96 m = 23.3 px.
    expect(measured(3).letterPx).toBeGreaterThan(22.8);
    expect(measured(3).letterPx).toBeLessThan(23.8);
  });

  it("is invalid when a corner is behind the eye", () => {
    const behind = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, -1, 0, 0, 0, 1];
    const m = plateMetrics(behind, [0, 0, 0, 1], 390, 844, 272, 108, 16, 22);
    expect(m.valid).toBe(false);
    expect(m.onScreen).toBe(false);
    expect(m.letterPx).toBe(0);
  });
});

// Why: a quad that collapsed to a line or a point (a plate seen exactly
// edge-on, a flight corner pinned to its partner) has no inside; a press
// there must not be taken as a press on the words.
describe("inQuad on a degenerate quad", () => {
  it("finds nothing inside a point or a line", () => {
    const point: [number, number][] = [
      [5, 5],
      [5, 5],
      [5, 5],
      [5, 5],
    ];
    expect(inQuad(5, 5, point)).toBe(false);
    const line: [number, number][] = [
      [0, 0],
      [10, 0],
      [20, 0],
      [30, 0],
    ];
    expect(inQuad(5, 0, line)).toBe(false);
  });
});

// Why: the view and box sizes come from the page (a hidden iframe has a
// zero-size view, a box before its first layout a zero-size rectangle);
// a size of 0 or NaN made every letter Infinity or NaN, and a NaN letter
// read as "readable" because NaN < 12 is false. Bad sizes give invalid
// metrics, and a NaN letter docks.
describe("plateMetrics and wantPlace on bad sizes", () => {
  const corners = [
    -0.5, 0.5, 0, 1, 0.5, 0.5, 0, 1, -0.5, -0.5, 0, 1, 0.5, -0.5, 0, 1,
  ];
  const centre = [0, 0, 0, 1];
  const good = [390, 844, 272, 108, 16, 22] as const;

  it("is invalid for a size that is not a positive finite number", () => {
    for (let at = 0; at < good.length; at++) {
      for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        const sizes = [...good] as number[];
        sizes[at] = bad;
        const m = plateMetrics(
          corners,
          centre,
          sizes[0]!,
          sizes[1]!,
          sizes[2]!,
          sizes[3]!,
          sizes[4]!,
          sizes[5]!,
        );
        expect(m.valid, `size ${String(at)} = ${String(bad)}`).toBe(false);
        expect(m.letterPx).toBe(0);
      }
    }
    expect(plateMetrics(corners, centre, ...good).valid).toBe(true);
  });

  it("docks a letter size that is NaN, as too small", () => {
    expect(wantPlace(want({ metrics: seen(Number.NaN) }), K)).toEqual({
      place: "dock",
      why: "too small",
    });
  });
});

// Why: the quad's corners come from the flight's clip corners, whose w is
// interpolated and can reach the eye's plane on a plate seen up close; a
// division by such a w threw the corners to infinity, where every press
// would land "inside". A corner too near or behind the eye has no screen
// place: no quad.
describe("quadOfClip with a corner at or behind the eye", () => {
  it("gives no quad", () => {
    const ok = [
      -0.5, 0.5, 0, 1, 0.5, 0.5, 0, 1, -0.5, -0.5, 0, 1, 0.5, -0.5, 0, 1,
    ];
    for (const w of [0, 0.05, -1, Number.NaN]) {
      const clip = [...ok];
      clip[7] = w;
      expect(quadOfClip(clip, 400, 800), `w = ${String(w)}`).toBeNull();
    }
    expect(quadOfClip(ok, 400, 800)).not.toBeNull();
  });
});
