import { describe, expect, it } from "vitest";

import {
  BARRIER_KIND_RGB,
  BARRIER_MATERIAL_RGB,
  TAGGED_BARRIER_COLOUR_SHARE,
  barrierColour,
} from "./barrier-colours.js";

const lin = (v: number): number =>
  v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const enc = (v: number): number =>
  v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
/** One channel mixed at half in linear light, back as an sRGB byte. */
const halfMix = (base: number, tagged: number): number =>
  Math.round(enc((lin(base / 255) + lin(tagged / 255)) / 2) * 255);

/**
 * WHY THESE TESTS MATTER. The barrier colours are the O1 quiet-greens look
 * the owner chose (city objects plan 2026-11-07-2315 M1): a muted colour per
 * kind, a material colour where one is tagged, and a tagged `colour` mixed
 * in at half so a mapper's red fence reads red without shouting. Before
 * this, a barrier went through `buildingColour` and every wall, hedge and
 * fence drew the same building grey.
 */
describe("barrierColour", () => {
  it("gives each kind its own colour", () => {
    expect(barrierColour({ barrier: "hedge" })).toBe(0x6a785d);
    expect(barrierColour({ barrier: "wall" })).toBe(0xa59e93);
    expect(barrierColour({ barrier: "city_wall" })).toBe(0x9b9081);
    expect(barrierColour({ historic: "citywalls" })).toBe(0x9b9081);
    expect(barrierColour({ barrier: "retaining_wall" })).toBe(0x9d9d98);
    expect(barrierColour({ barrier: "fence" })).toBe(0x7d7366);
    expect(BARRIER_KIND_RGB.size).toBe(5);
  });

  it("uses the tagged material, then fence_type, then a wall's wall tag", () => {
    expect(barrierColour({ barrier: "wall", material: "brick" })).toBe(
      0x9a7262,
    );
    expect(barrierColour({ barrier: "fence", fence_type: "chain_link" })).toBe(
      0x7c8186,
    );
    expect(
      barrierColour({
        barrier: "fence",
        material: "wood",
        fence_type: "metal",
      }),
    ).toBe(0x8a7660);
    expect(barrierColour({ barrier: "wall", wall: "dry_stone" })).toBe(
      0xa49a8a,
    );
    // `wall=*` is read for walls only: on a fence it says nothing.
    expect(barrierColour({ barrier: "fence", wall: "brick" })).toBe(0x7d7366);
    expect(BARRIER_MATERIAL_RGB.get("sandstone")).toBe(0xa8907a);
    expect(BARRIER_MATERIAL_RGB.get("concrete")).toBe(0xa0a09c);
  });

  it("keeps a hedge green whatever material is tagged", () => {
    // A hedge is leaves; `material=brick` on one is a tagging slip.
    expect(barrierColour({ barrier: "hedge", material: "brick" })).toBe(
      0x6a785d,
    );
  });

  it("falls back to the kind colour for an unknown material or prototype names", () => {
    // WHY: the tables are Maps, so `material=constructor` finds nothing
    // instead of an inherited function that would draw black.
    for (const material of ["plastic", "constructor", "__proto__", ""]) {
      expect(barrierColour({ barrier: "wall", material }), material).toBe(
        0xa59e93,
      );
    }
    // A tag set of no solid kind draws as a wall, as the lab did.
    expect(barrierColour({})).toBe(0xa59e93);
    expect(barrierColour({ barrier: "toString" })).toBe(0xa59e93);
  });

  it("mixes a tagged colour in at half, in linear light", () => {
    // White into black at half in linear light is sRGB 0xbc (188), not the
    // 0x80 a mix of the sRGB bytes would give: the mix must be in linear,
    // as the lab's `THREE.Color.lerp` did it.
    expect(TAGGED_BARRIER_COLOUR_SHARE).toBe(0.5);
    expect(halfMix(0, 255)).toBe(0xbc);
    const fence = barrierColour({ barrier: "fence", colour: "#ffffff" });
    expect(fence >> 16).toBe(halfMix(0x7d, 0xff));
    expect((fence >> 8) & 0xff).toBe(halfMix(0x73, 0xff));
    expect(fence & 0xff).toBe(halfMix(0x66, 0xff));
    // The hedge mixes too: only its material is fixed.
    const red = barrierColour({ barrier: "hedge", colour: "#ff0000" });
    expect(red >> 16).toBe(halfMix(0x6a, 0xff));
  });

  it("reads building:colour when no colour is tagged, and ignores what does not parse", () => {
    expect(
      barrierColour({ barrier: "wall", "building:colour": "#a59e93" }),
    ).toBe(0xa59e93);
    expect(
      barrierColour({
        barrier: "wall",
        colour: "#a59e93",
        "building:colour": "#000000",
      }),
    ).toBe(0xa59e93);
    // Named colours resolve through the one colour parser (`parseOsmColour`
    // gained the named table with the skeleton roof branch), so "red" mixes
    // exactly as "#ff0000" does.
    expect(barrierColour({ barrier: "wall", colour: "red" })).toBe(
      barrierColour({ barrier: "wall", colour: "#ff0000" }),
    );
    expect(barrierColour({ barrier: "wall", colour: "red" })).not.toBe(
      0xa59e93,
    );
    expect(barrierColour({ barrier: "wall", colour: "#gggggg" })).toBe(
      0xa59e93,
    );
  });
});
