/**
 * Why these tests matter: the spot guide is what leads a visitor to a
 * viewpoint picture's spot, and the views only work from there. These pin
 * the guide's rules without a renderer: the card on its post stands beside
 * the spot (never on the decal the visitor must stand on) wherever the
 * viewpoint looks, it turns to face the visitor from anywhere, it gives
 * way as the visitor arrives so nothing hangs in front of the picture,
 * the light column never outshines what it marks, and every shade stays a
 * real opacity for any input. The sweeps check the named sizes and fade
 * distances over a plausible range, not only at the chosen value.
 */
import fc from "fast-check";
import type { TourPictureViewpoint } from "gps-plus-slam-app-framework/ar/tour-kinds";
import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import {
  SPOT_CARD,
  SPOT_CARD_FADE_M,
  SPOT_CARD_LINES,
  SPOT_DECAL_M,
  SPOT_GUIDE_VIEWS,
  spotCardPlace,
  spotCardSize,
  spotCardTurn,
  spotGuideShade,
} from "./spot-guide.js";

function viewpointLooking(
  yaw: number,
  position: readonly [number, number, number] = [0, 1.6, 0],
): TourPictureViewpoint {
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
  return {
    position: [...position],
    rotation: [q.x, q.y, q.z, q.w],
    hfovDeg: 60,
    distanceM: 12,
  };
}

const anyYaw = fc.double({ min: -Math.PI, max: Math.PI, noNaN: true });
const anyGround = fc.tuple(
  fc.double({ min: -30, max: 30, noNaN: true }),
  fc.double({ min: -30, max: 30, noNaN: true }),
);
const anyView = fc.constantFrom(...SPOT_GUIDE_VIEWS);

describe("spot guide", () => {
  it("says a line per view, as the prototype's card", () => {
    expect(SPOT_CARD_LINES.thenNow).toEqual([
      "Stand on the marker",
      "and face the arrow",
    ]);
    expect(SPOT_CARD_LINES.window).toEqual([
      "Stand on the marker",
      "and look through the frame",
    ]);
    for (const view of SPOT_GUIDE_VIEWS) {
      expect(SPOT_CARD_LINES[view][0].length, view).toBeGreaterThan(0);
    }
  });

  // The card stands to the left of the spot and a little behind it, as
  // seen from the spot looking the viewpoint's way, for any heading.
  it("stands the card beside the spot, off the decal, for any heading", () => {
    fc.assert(
      fc.property(anyYaw, anyGround, (yaw, [x, z]) => {
        const vp = viewpointLooking(yaw, [x, 1.6, z]);
        const card = spotCardPlace(vp);
        const ahead = new Vector3(0, 0, -1).applyQuaternion(
          new Quaternion(...vp.rotation),
        );
        const right = new Vector3(-ahead.z, 0, ahead.x);
        const dx = card.x - x;
        const dz = card.z - z;
        expect(dx * right.x + dz * right.z).toBeCloseTo(-SPOT_CARD.asideM, 6);
        expect(dx * ahead.x + dz * ahead.z).toBeCloseTo(-SPOT_CARD.behindM, 6);
        expect(Math.hypot(dx, dz)).toBeGreaterThan(SPOT_DECAL_M / 2);
      }),
    );
  });

  // Swept: decal sizes 1.2, 1.5 and 2.0 m by card offsets 0.9, 1.05 and
  // 1.3 m. The post stays off the decal everywhere but one corner: a 2 m
  // decal with the post 0.9 m aside puts the post on its rim. So the
  // decal may not grow to 2 m without the card moving out with it.
  it("keeps the post off the decal across the swept sizes", () => {
    const off: string[] = [];
    for (const decalM of [1.2, 1.5, 2.0]) {
      for (const asideM of [0.9, 1.05, 1.3]) {
        if (Math.hypot(asideM, SPOT_CARD.behindM) <= decalM / 2) {
          off.push(`${String(decalM)} m decal, ${String(asideM)} m aside`);
        }
      }
    }
    expect(off).toEqual(["2 m decal, 0.9 m aside"]);
    // The chosen pair keeps a margin of more than a post's width.
    expect(
      Math.hypot(SPOT_CARD.asideM, SPOT_CARD.behindM) - SPOT_DECAL_M / 2,
    ).toBeGreaterThan(0.3);
  });

  it("turns the card to face the visitor from anywhere", () => {
    fc.assert(
      fc.property(anyGround, anyGround, ([cx, cz], [vx, vz]) => {
        fc.pre(Math.hypot(vx - cx, vz - cz) > 1e-3);
        const turn = spotCardTurn(cx, cz, vx, vz, 0.3);
        // The card's front (+Z) turned by `turn` about up.
        const fx = Math.sin(turn);
        const fz = Math.cos(turn);
        const len = Math.hypot(vx - cx, vz - cz);
        expect(fx * ((vx - cx) / len) + fz * ((vz - cz) / len)).toBeCloseTo(
          1,
          6,
        );
      }),
    );
  });

  it("keeps the last turn when the visitor stands on the card or is unknown", () => {
    expect(spotCardTurn(1, 2, 1, 2, 0.7)).toBe(0.7);
    expect(spotCardTurn(1, 2, Number.NaN, 2, 0.7)).toBe(0.7);
  });

  it("shades every part as a real opacity for any input", () => {
    fc.assert(
      fc.property(
        anyView,
        fc.oneof(
          fc.double({ min: 0, max: 100, noNaN: true }),
          fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY),
        ),
        fc.oneof(
          fc.double({ min: -1, max: 2, noNaN: true }),
          fc.constant(Number.NaN),
        ),
        (view, distanceM, takeover) => {
          const s = spotGuideShade(view, distanceM, takeover);
          for (const v of [s.decal, s.card, s.beam]) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
          }
          // The column marks the spot no brighter than either guide.
          expect(s.beam).toBeLessThanOrEqual(Math.min(s.decal, s.card));
        },
      ),
    );
  });

  it("shows the card and the column far away and takes them on the spot", () => {
    for (const view of SPOT_GUIDE_VIEWS) {
      const far = spotGuideShade(view, 7, 0);
      expect(far.card, view).toBe(1);
      expect(far.decal, view).toBe(1);
      expect(far.beam, view).toBe(1);
      const on = spotGuideShade(view, 0.3, 1);
      expect(on.card, view).toBe(0);
      expect(on.beam, view).toBe(0);
      // The decal stays, dimmed, under the visitor's feet.
      expect(on.decal, view).toBeGreaterThan(0.25);
      expect(on.decal, view).toBeLessThan(1);
    }
    // No reading (no camera): the guide shows, as for a far visitor.
    expect(spotGuideShade("finder", Number.POSITIVE_INFINITY, 0).card).toBe(1);
  });

  it("fades the card out the closer the visitor comes", () => {
    fc.assert(
      fc.property(
        anyView,
        fc.double({ min: 0, max: 20, noNaN: true }),
        fc.double({ min: 0, max: 20, noNaN: true }),
        (view, a, b) => {
          const near = Math.min(a, b);
          const far = Math.max(a, b);
          expect(spotGuideShade(view, near, 0).card).toBeLessThanOrEqual(
            spotGuideShade(view, far, 0).card,
          );
        },
      ),
    );
  });

  // Swept: wherever the card's fade sits in this range, it is gone by the
  // time the visitor stands on the decal, and still whole a few steps
  // out, where the visitor reads it. The chosen edges are the middle row.
  it("is gone on the decal and whole a few steps out across the swept fades", () => {
    const sweep: readonly (readonly [number, number])[] = [
      [1.2, 0.75],
      SPOT_CARD_FADE_M,
      [2.4, 1.2],
    ];
    for (const fade of sweep) {
      for (const view of SPOT_GUIDE_VIEWS) {
        const at = (d: number): number => spotGuideShade(view, d, 0, fade).card;
        expect(at(SPOT_DECAL_M / 2), `${view} ${fade.join("-")}`).toBe(0);
        expect(at(3), `${view} ${fade.join("-")}`).toBe(1);
      }
    }
  });

  it("sizes the card by the picture, smaller without the thumbnail", () => {
    const wide = spotCardSize(0.5, true);
    expect(wide.widthM).toBe(SPOT_CARD.widthM);
    expect(wide.heightM).toBeCloseTo(0.045 + 0.71 * 0.5 + 0.035 + 0.16, 6);
    const tall = spotCardSize(1.5, true);
    expect(tall.heightM).toBeGreaterThan(wide.heightM);
    expect(spotCardSize(0.5, false).heightM).toBeCloseTo(0.205, 6);
    // A broken aspect gives a card without a thumbnail's room.
    expect(spotCardSize(Number.NaN, true).heightM).toBeCloseTo(0.205, 6);
  });
});
