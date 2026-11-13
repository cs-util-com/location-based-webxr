/**
 * Why these tests matter: a viewpoint is stored as a quaternion but typed
 * as a facing and a pitch; if the two disagree, a creator who types
 * "Facing 90" sees the picture line up somewhere else. And the first
 * viewpoint a picture gets must stand in front of it, facing it, or the
 * picture switched to "Then and now" would hang behind the creator.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { viewpointForward } from "../kinds/picture/viewpoint-fade.js";
import {
  mintViewpoint,
  viewpointFacts,
  viewpointRotation,
  viewpointWithField,
  VIEWPOINT_EYE_M,
  VIEWPOINT_LENS_DEG,
  VIEWPOINT_STAND_BACK_M,
} from "./picture-viewpoint.js";

/** The shorter way round between two headings. */
function apart(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return Math.min(d, 360 - d);
}

/** A turn about up that faces the picture's front to `deg`. */
function frontTo(deg: number): [number, number, number, number] {
  // The front is local +Z, which faces east (90) unturned.
  const half = ((90 - deg) * Math.PI) / 360;
  return [0, Math.sin(half), 0, Math.cos(half)];
}

describe("viewpointRotation and viewpointFacts", () => {
  it("read back the facing and the pitch they were made from", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 359.9, noNaN: true }),
        fc.double({ min: -80, max: 80, noNaN: true }),
        (facing, pitch) => {
          const facts = viewpointFacts({
            position: [0, 0, 0],
            rotation: viewpointRotation(facing, pitch),
            hfovDeg: 50,
            distanceM: 5,
          });
          expect(apart(facts.facingDeg, facing)).toBeLessThan(1e-6);
          expect(Math.abs(facts.pitchDeg - pitch)).toBeLessThan(1e-6);
        },
      ),
    );
  });

  it("agree with the viewer's own forward: facing 0 looks north, 90 east", () => {
    // The viewer reads the same quaternion (`viewpointForward`); the
    // station frame is x north, z east.
    const vp = (deg: number) => ({
      position: [0, 0, 0] as const,
      rotation: viewpointRotation(deg, 0),
      hfovDeg: 50,
      distanceM: 5,
    });
    const north = viewpointForward(vp(0));
    expect(north.x).toBeCloseTo(1);
    expect(north.z).toBeCloseTo(0);
    const east = viewpointForward(vp(90));
    expect(east.x).toBeCloseTo(0);
    expect(east.z).toBeCloseTo(1);
    const up = viewpointForward({
      ...vp(0),
      rotation: viewpointRotation(0, 30),
    });
    expect(up.y).toBeCloseTo(0.5);
  });
});

describe("mintViewpoint", () => {
  it("stands in front of the picture at eye height, facing it level, its depth the way back", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 359.9, noNaN: true }),
        fc.double({ min: -50, max: 50, noNaN: true }),
        fc.double({ min: -50, max: 50, noNaN: true }),
        (front, n, e) => {
          const vp = mintViewpoint({
            position: [n, 1.2, e],
            rotation: frontTo(front),
          });
          const facts = viewpointFacts(vp);
          // Standing on the picture's front side, the stand-back away.
          const dn = facts.northM - n;
          const de = facts.eastM - e;
          expect(Math.hypot(dn, de)).toBeCloseTo(VIEWPOINT_STAND_BACK_M);
          const standsAt = (Math.atan2(de, dn) * 180) / Math.PI;
          expect(apart(standsAt, front)).toBeLessThan(1e-6);
          // Facing back at the picture, level.
          expect(apart(facts.facingDeg, front + 180)).toBeLessThan(1e-6);
          expect(facts.pitchDeg).toBeCloseTo(0);
          expect(facts.upM).toBe(VIEWPOINT_EYE_M);
          expect(facts.lensDeg).toBe(VIEWPOINT_LENS_DEG);
          expect(facts.distanceM).toBe(VIEWPOINT_STAND_BACK_M);
        },
      ),
    );
  });

  it("stands south of a picture lying flat, facing north, and takes no NaN", () => {
    // Its front straight up: no way on the ground to stand in front of.
    const half = Math.PI / 4;
    const flat = mintViewpoint({
      position: [3, 0, 4],
      rotation: [-Math.sin(half), 0, 0, Math.cos(half)],
    });
    expect(viewpointFacts(flat)).toMatchObject({ northM: -3, eastM: 4 });
    expect(viewpointFacts(flat).facingDeg).toBeCloseTo(0);
    const bad = mintViewpoint({ position: [NaN, 0, Infinity], rotation: [] });
    expect(bad.position.every(Number.isFinite)).toBe(true);
  });
});

describe("viewpointWithField", () => {
  const vp = mintViewpoint({ position: [0, 0, 0], rotation: frontTo(0) });

  it("moves, turns, tilts, and sets the lens and depth, keeping the rest", () => {
    const moved = viewpointWithField(vp, "vp-north", 2)!.position;
    expect(moved[0]).toBe(2);
    expect(moved[1]).toBe(VIEWPOINT_EYE_M);
    expect(moved[2]).toBeCloseTo(0);
    expect(viewpointWithField(vp, "vp-up", 1.2)?.position[1]).toBe(1.2);
    expect(viewpointWithField(vp, "vp-east", -3)?.position[2]).toBe(-3);
    const turned = viewpointFacts(viewpointWithField(vp, "vp-facing", 45)!);
    expect(turned.facingDeg).toBeCloseTo(45);
    expect(turned.pitchDeg).toBeCloseTo(0);
    const tilted = viewpointFacts(viewpointWithField(vp, "vp-pitch", 12)!);
    expect(tilted.pitchDeg).toBeCloseTo(12);
    expect(apart(tilted.facingDeg, 180)).toBeLessThan(1e-6);
    expect(viewpointWithField(vp, "vp-lens", 70)?.hfovDeg).toBe(70);
    expect(viewpointWithField(vp, "vp-distance", 40)?.distanceM).toBe(40);
  });

  it("keeps the lens, the depth and the pitch inside their bounds", () => {
    expect(viewpointWithField(vp, "vp-lens", 1)?.hfovDeg).toBe(10);
    expect(viewpointWithField(vp, "vp-lens", 400)?.hfovDeg).toBe(120);
    expect(viewpointWithField(vp, "vp-distance", 0)?.distanceM).toBe(1);
    expect(viewpointWithField(vp, "vp-distance", 9e9)?.distanceM).toBe(500);
    const steep = viewpointFacts(viewpointWithField(vp, "vp-pitch", 95)!);
    expect(steep.pitchDeg).toBeCloseTo(80);
  });

  it("writes nothing for a field it does not know or a value that is no number", () => {
    expect(viewpointWithField(vp, "vp-roll", 3)).toBeNull();
    expect(viewpointWithField(vp, "vp-north", NaN)).toBeNull();
    expect(viewpointWithField(vp, "vp-lens", Infinity)).toBeNull();
  });
});
