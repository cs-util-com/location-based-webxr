import fc from "fast-check";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { GroundTint } from "gps-plus-slam-osm";

import { landUseTint } from "./land-use-tint.js";

function tintOf(ground: number): GroundTint {
  return {
    width: 1,
    height: 1,
    texelM: 2,
    originX: 0,
    originY: 0,
    classes: new Uint8Array([1]),
    palette: [ground, 0x6f9a5c],
    shares: new Map(),
    skipped: 0,
  } as unknown as GroundTint;
}

type Op =
  | { readonly kind: "tint"; readonly some: boolean }
  | { readonly kind: "wanted"; readonly on: boolean }
  | { readonly kind: "appearance"; readonly to: "plain" | "slope" | "ramp" }
  | { readonly kind: "ground"; readonly rgb: number };

const op: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ kind: fc.constant("tint" as const), some: fc.boolean() }),
  fc.record({ kind: fc.constant("wanted" as const), on: fc.boolean() }),
  fc.record({
    kind: fc.constant("appearance" as const),
    to: fc.constantFrom("plain" as const, "slope" as const, "ramp" as const),
  }),
  fc.record({
    kind: fc.constant("ground" as const),
    rgb: fc.integer({ min: 0, max: 0xffffff }),
  }),
);

describe("landUseTint, any order of inputs", () => {
  it("shows the tint exactly when one is applied, wanted and not the ramp, and the material is white exactly while one is applied", () => {
    // WHY: the three inputs arrive at independent times (a build reply, the
    // switch, the ground menu); the rule must hold after every sequence, not
    // only after the orders the example tests happen to use. A white material
    // without a tint would draw a white ground; a ground colour under a tint
    // would square the neutral.
    fc.assert(
      fc.property(fc.array(op, { maxLength: 30 }), (ops) => {
        const material = new THREE.MeshStandardMaterial({ color: 0x6b7280 });
        const control = landUseTint(material);
        let tinted = false;
        let wanted = true;
        let appearance = "plain";
        let ground = 0x6b7280;
        for (const step of ops) {
          if (step.kind === "tint") {
            control.setTint(step.some ? tintOf(ground) : undefined);
            tinted = step.some;
          } else if (step.kind === "wanted") {
            control.setWanted(step.on);
            wanted = step.on;
          } else if (step.kind === "appearance") {
            control.setAppearance(step.to);
            appearance = step.to;
          } else {
            control.setGroundColour(step.rgb);
            ground = step.rgb;
          }
          expect(control.showing()).toBe(
            tinted && wanted && appearance !== "ramp",
          );
          expect(material.color.getHex()).toBe(tinted ? 0xffffff : ground);
        }
        control.dispose();
        expect(material.color.getHex()).toBe(ground);
      }),
      { numRuns: 200 },
    );
  });
});
