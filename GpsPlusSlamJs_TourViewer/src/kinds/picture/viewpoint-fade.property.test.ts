import fc from "fast-check";
import type { TourPictureViewpoint } from "gps-plus-slam-app-framework/ar/tour-kinds";
import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import {
  FINDER_FADE,
  SHARPEN_FADE,
  THEN_NOW_FADE,
  VIEWER_FADE,
  viewpointAlpha,
  viewpointForward,
  viewpointReach,
  type ViewpointFade,
} from "./viewpoint-fade.js";

const FADES: readonly ViewpointFade[] = [
  THEN_NOW_FADE,
  VIEWER_FADE,
  SHARPEN_FADE,
  FINDER_FADE,
];

/** A viewpoint at `position` turned `yawDeg` about up, `pitchDeg` about its
 *  own right axis (the order a camera turns in). */
function viewpoint(
  position: readonly [number, number, number],
  yawDeg: number,
  pitchDeg = 0,
): TourPictureViewpoint {
  const q = new Quaternion()
    .setFromAxisAngle(new Vector3(0, 1, 0), (yawDeg * Math.PI) / 180)
    .multiply(
      new Quaternion().setFromAxisAngle(
        new Vector3(1, 0, 0),
        (pitchDeg * Math.PI) / 180,
      ),
    );
  return {
    position,
    rotation: [q.x, q.y, q.z, q.w],
    hfovDeg: 60,
    distanceM: 12,
  };
}

/** The ground heading `yawDeg` as a facing vector, as a camera turned that
 *  way looks. */
function facingAt(yawDeg: number): [number, number, number] {
  const r = (yawDeg * Math.PI) / 180;
  return [-Math.sin(r), 0, -Math.cos(r)];
}

const finite = fc.double({ min: -500, max: 500, noNaN: true });
const yaw = fc.double({ min: -180, max: 180, noNaN: true });

describe("viewpointReach", () => {
  // Why: the distance is measured on the ground, so a visitor holding the
  // phone lower than the photographer's camera still stands on the spot.
  it("ignores height and reads the ground distance", () => {
    fc.assert(
      fc.property(finite, finite, finite, finite, (x, y, z, h) => {
        const vp = viewpoint([x, y, z], 0);
        const reach = viewpointReach([x + 3, h, z + 4], facingAt(0), vp);
        expect(reach.distanceM).toBeCloseTo(5, 6);
      }),
    );
  });

  // Why: facing is the heading difference, whatever way the viewpoint
  // looks and whichever side the visitor turned to.
  it("reads the heading difference, 0 to 180, symmetric", () => {
    fc.assert(
      fc.property(yaw, yaw, (a, b) => {
        const vp = viewpoint([0, 1.6, 0], a);
        const off = viewpointReach([0, 1.6, 0], facingAt(b), vp).offAxisDeg;
        const wrapped = Math.abs(((((b - a) % 360) + 540) % 360) - 180);
        expect(off).toBeCloseTo(wrapped, 4);
        const back = viewpointReach(
          [0, 1.6, 0],
          facingAt(a),
          viewpoint([0, 1.6, 0], b),
        ).offAxisDeg;
        expect(back).toBeCloseTo(off, 4);
      }),
    );
  });

  // Why: a photo taken looking up at a tower still lines up with a visitor
  // holding the phone level; only the heading counts.
  it("ignores the pitch of either side", () => {
    fc.assert(
      fc.property(
        yaw,
        fc.double({ min: -60, max: 60, noNaN: true }),
        (a, p) => {
          const vp = viewpoint([0, 1.6, 0], a, p);
          const f = facingAt(a);
          const tilted: [number, number, number] = [f[0], 0.5, f[2]];
          expect(viewpointReach([0, 0, 0], tilted, vp).offAxisDeg).toBeLessThan(
            1e-3,
          );
        },
      ),
    );
  });

  // Why: the viewpoint's forward is its local -Z, the format's camera
  // convention; a mix-up here would turn every picture around.
  it("takes the viewpoint's local -Z as its forward", () => {
    const f = viewpointForward(viewpoint([0, 0, 0], 90));
    expect(f.x).toBeCloseTo(-1, 6);
    expect(f.z).toBeCloseTo(0, 6);
  });

  // Why: sensor readings arrive broken now and then; a broken frame must
  // show nothing rather than a NaN opacity.
  it("reads a broken input as out of reach", () => {
    const reach = viewpointReach(
      [NaN, 0, 0],
      facingAt(0),
      viewpoint([0, 0, 0], 0),
    );
    expect(reach.distanceM).toBe(Infinity);
    expect(viewpointAlpha(reach, THEN_NOW_FADE)).toBe(0);
  });
});

describe("viewpointAlpha", () => {
  const reach = fc.record({
    distanceM: fc.double({ min: 0, max: 50, noNaN: true }),
    offAxisDeg: fc.double({ min: 0, max: 180, noNaN: true }),
  });
  const fade = fc.constantFrom(...FADES);

  // Why: the opacity feeds a material straight; outside 0 to 1 it breaks.
  it("stays within 0 and 1", () => {
    fc.assert(
      fc.property(reach, fade, (r, f) => {
        const a = viewpointAlpha(r, f);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1);
      }),
    );
  });

  // Why: on the spot and facing the photographer's way, the whole picture
  // shows; past the far end of the ramp or outside the gate, none of it.
  it("is whole at the spot and nothing out of reach", () => {
    for (const f of FADES) {
      expect(viewpointAlpha({ distanceM: 0, offAxisDeg: 0 }, f)).toBe(1);
      expect(viewpointAlpha({ distanceM: f.ramp[0], offAxisDeg: 0 }, f)).toBe(
        0,
      );
      expect(viewpointAlpha({ distanceM: 0, offAxisDeg: f.gate[0] }, f)).toBe(
        0,
      );
    }
  });

  // Why: walking toward the spot or turning toward the heading must never
  // make the picture fainter, or it flickers as the visitor approaches.
  it("never falls as the visitor nears or turns in", () => {
    fc.assert(
      fc.property(reach, reach, fade, (a, b, f) => {
        const nearer = {
          distanceM: Math.min(a.distanceM, b.distanceM),
          offAxisDeg: a.offAxisDeg,
        };
        const farther = {
          distanceM: Math.max(a.distanceM, b.distanceM),
          offAxisDeg: a.offAxisDeg,
        };
        expect(viewpointAlpha(nearer, f)).toBeGreaterThanOrEqual(
          viewpointAlpha(farther, f),
        );
        const inner = {
          distanceM: a.distanceM,
          offAxisDeg: Math.min(a.offAxisDeg, b.offAxisDeg),
        };
        const outer = {
          distanceM: a.distanceM,
          offAxisDeg: Math.max(a.offAxisDeg, b.offAxisDeg),
        };
        expect(viewpointAlpha(inner, f)).toBeGreaterThanOrEqual(
          viewpointAlpha(outer, f),
        );
      }),
    );
  });

  // Why: a centimetre or a tenth of a degree of sensor noise must not
  // jump the opacity; the ramp is smooth, its steepest slope bounded.
  it("moves little for a small step", () => {
    fc.assert(
      fc.property(reach, fade, (r, f) => {
        const a = viewpointAlpha(r, f);
        const b = viewpointAlpha(
          { distanceM: r.distanceM + 0.01, offAxisDeg: r.offAxisDeg + 0.1 },
          f,
        );
        expect(Math.abs(a - b)).toBeLessThan(0.05);
      }),
    );
  });
});
