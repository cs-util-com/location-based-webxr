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
  swipeSplitAt,
} from "./then-now-swipe.js";

describe("swipeSplitAt", () => {
  it("is the finger's share of the screen's width", () => {
    expect(swipeSplitAt(200, 0, 400)).toBe(0.5);
    expect(swipeSplitAt(130, 30, 400)).toBe(0.25);
  });

  it("keeps the line off the edges", () => {
    expect(swipeSplitAt(-50, 0, 400)).toBe(SWIPE_SPLIT_MIN);
    expect(swipeSplitAt(1, 0, 400)).toBe(SWIPE_SPLIT_MIN);
    expect(swipeSplitAt(399, 0, 400)).toBe(SWIPE_SPLIT_MAX);
    expect(swipeSplitAt(9000, 0, 400)).toBe(SWIPE_SPLIT_MAX);
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
});
