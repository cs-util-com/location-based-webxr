/**
 * Why these tests matter: the swipe line is where the visitor's finger
 * is, and the picture must end exactly there. A finger off the screen's
 * edge must not push the knob out of reach, a broken reading must not
 * hide the picture, and the mask must reach three's real basic shader:
 * a chunk name that moved in a three update would leave the picture
 * whole with no error anywhere, so the patch is run on three's own
 * shader text here.
 */
import { MeshBasicMaterial, ShaderLib } from "three";
import { describe, expect, it } from "vitest";

import {
  clampSwipeSplit,
  SWIPE_SPLIT_MAX,
  SWIPE_SPLIT_MIN,
  SWIPE_SPLIT_START,
  swipeMask,
  swipeReach,
  swipeSplitAt,
} from "./then-now-swipe.js";

describe("swipeSplitAt", () => {
  it("is the finger's share of the screen's width", () => {
    expect(swipeSplitAt(200, 0, 400)).toBe(0.5);
    expect(swipeSplitAt(130, 30, 400)).toBe(0.25);
  });

  it("keeps the knob off the edges, out of the system's edge gestures", () => {
    // 400 px wide: the knob's centre stays 48 px in from either edge.
    expect(swipeSplitAt(-50, 0, 400)).toBe(48 / 400);
    expect(swipeSplitAt(1, 0, 400)).toBe(48 / 400);
    expect(swipeSplitAt(399, 0, 400)).toBe(1 - 48 / 400);
    expect(swipeSplitAt(9000, 0, 400)).toBe(1 - 48 / 400);
    // On a wide screen the share's own reach is the nearer bound.
    expect(swipeSplitAt(-50, 0, 4000)).toBe(SWIPE_SPLIT_MIN);
    expect(swipeSplitAt(9000, 0, 4000)).toBe(SWIPE_SPLIT_MAX);
  });

  it("keeps the middle for a screen with no width or a broken reading", () => {
    expect(swipeSplitAt(10, 0, 0)).toBe(SWIPE_SPLIT_START);
    expect(swipeSplitAt(10, 0, -5)).toBe(SWIPE_SPLIT_START);
    expect(swipeSplitAt(10, Number.NaN, 400)).toBe(SWIPE_SPLIT_START);
    expect(swipeSplitAt(Number.NaN, 0, 400)).toBe(SWIPE_SPLIT_START);
  });
});

describe("clampSwipeSplit", () => {
  it("clamps to the edges and reads no number as the middle", () => {
    expect(clampSwipeSplit(0.3)).toBe(0.3);
    expect(clampSwipeSplit(-1)).toBe(SWIPE_SPLIT_MIN);
    expect(clampSwipeSplit(2)).toBe(SWIPE_SPLIT_MAX);
    expect(clampSwipeSplit(Number.POSITIVE_INFINITY)).toBe(SWIPE_SPLIT_START);
  });

  it("clamps to a screen's reach when its width is known", () => {
    expect(clampSwipeSplit(0, 390)).toBe(48 / 390);
    expect(clampSwipeSplit(1, 390)).toBe(1 - 48 / 390);
    expect(clampSwipeSplit(0.3, 390)).toBe(0.3);
  });
});

describe("swipeReach", () => {
  it("is the share's reach, narrowed to 48 px from either edge", () => {
    expect(swipeReach(390)).toEqual([48 / 390, 1 - 48 / 390]);
    expect(swipeReach(4000)).toEqual([SWIPE_SPLIT_MIN, SWIPE_SPLIT_MAX]);
    // A screen too narrow for both margins keeps the middle.
    expect(swipeReach(60)).toEqual([0.5, 0.5]);
    // An unknown width: the share's reach alone.
    for (const w of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(swipeReach(w), String(w)).toEqual([
        SWIPE_SPLIT_MIN,
        SWIPE_SPLIT_MAX,
      ]);
    }
  });
});

/** Runs `material`'s patch on three's own basic shader. */
function compiled(material: MeshBasicMaterial): {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
} {
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: ShaderLib.basic.vertexShader,
    fragmentShader: ShaderLib.basic.fragmentShader,
  };
  material.onBeforeCompile(shader as never, undefined as never);
  return shader;
}

describe("swipeMask", () => {
  it("cuts three's basic shader at the split, after the soft edge's alpha", () => {
    const material = new MeshBasicMaterial();
    swipeMask(material);
    const shader = compiled(material);
    expect(shader.vertexShader).toContain("varying vec4 vThenNowClip;");
    expect(shader.vertexShader).toMatch(
      /#include <project_vertex>\s*vThenNowClip = gl_Position;/,
    );
    expect(shader.fragmentShader).toContain("uniform float uThenNowSplit;");
    expect(shader.fragmentShader).toContain("uniform float uThenNowSwipe;");
    // After the alpha map, so the feather and the cut multiply.
    const alphaMap = shader.fragmentShader.indexOf(
      "#include <alphamap_fragment>",
    );
    const cut = shader.fragmentShader.indexOf("if (uThenNowSwipe > 0.5)");
    expect(alphaMap).toBeGreaterThan(-1);
    expect(cut).toBeGreaterThan(alphaMap);
    expect(material.customProgramCacheKey()).toBe("picture-then-now-swipe");
  });

  it("writes the split into the compiled shader's uniforms, clamped", () => {
    const material = new MeshBasicMaterial();
    const mask = swipeMask(material);
    const { uniforms } = compiled(material);
    expect(uniforms["uThenNowSwipe"]?.value).toBe(0);
    expect(uniforms["uThenNowSplit"]?.value).toBe(SWIPE_SPLIT_START);
    mask.set(true, 0.3);
    expect(uniforms["uThenNowSwipe"]?.value).toBe(1);
    expect(uniforms["uThenNowSplit"]?.value).toBe(0.3);
    expect(mask.state()).toEqual({ on: true, split: 0.3 });
    mask.set(false, 7);
    expect(uniforms["uThenNowSwipe"]?.value).toBe(0);
    expect(mask.state()).toEqual({ on: false, split: SWIPE_SPLIT_MAX });
  });

  it("gives every material its own uniforms under the one program", () => {
    // Why: the cache key shares one compiled program between the
    // pictures; each must still be cut at its own line, so the values
    // live per material, never in the shared shader text.
    const a = new MeshBasicMaterial();
    const b = new MeshBasicMaterial();
    const maskA = swipeMask(a);
    const maskB = swipeMask(b);
    expect(a.customProgramCacheKey()).toBe(b.customProgramCacheKey());
    const ua = compiled(a).uniforms;
    const ub = compiled(b).uniforms;
    maskA.set(true, 0.2);
    maskB.set(false, 0.7);
    expect(ua["uThenNowSplit"]?.value).toBe(0.2);
    expect(ua["uThenNowSwipe"]?.value).toBe(1);
    expect(ub["uThenNowSplit"]?.value).toBe(0.7);
    expect(ub["uThenNowSwipe"]?.value).toBe(0);
    expect(ua["uThenNowSplit"]).not.toBe(ub["uThenNowSplit"]);
  });
});
