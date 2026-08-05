/**
 * The below-surface diagnostic geometry.
 *
 * Why these tests matter:
 * Every one of these invariants has already broken once, and none of them was
 * catchable where the code used to live — inside `BuildingView`, which needs a
 * WebGL context, so only an e2e could reach it. An e2e can see that pink lines
 * appeared; it cannot see that they are transparent, or that a node became a
 * tick instead of nothing.
 *
 * - **Transparency** shipped wrong: `WebGLRenderer` draws opaque before
 *   translucent and `renderOrder` only sorts within a list, so the lines
 *   outranked the affordance slabs in the table and lost to them on screen.
 * - **Nodes** were dropped entirely, from the one view whose job is showing
 *   what got dropped.
 * - **The colour** was written twice, and the map's copy was not a colour at
 *   all — a `className` with no CSS rule behind it.
 *
 * @see underground-lines.ts.md
 */

import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  NODE_TICK_M,
  UNDERGROUND_DEPTH_M,
  buildUndergroundLines,
  undergroundMaterial,
  undergroundVertices,
} from "./underground-lines.js";
import { RENDER_ORDER } from "./layer-order.js";
import {
  GROUND_COLOUR,
  PLATE_COLOUR,
  UNDERGROUND_COLOUR,
  cssColour,
} from "./surface-colours.js";

describe("undergroundVertices", () => {
  it("turns a two-point way into one segment at the fixed depth", () => {
    const positions = undergroundVertices([new Float32Array([0, 0, 10, 20])]);

    // ENU x,y becomes scene x,-z with y as the depth: the same axis convention
    // every other piece of scene geometry uses.
    expect(positions).toEqual([
      0,
      UNDERGROUND_DEPTH_M,
      -0,
      10,
      UNDERGROUND_DEPTH_M,
      -20,
    ]);
  });

  it("turns a three-point way into two chained segments", () => {
    const positions = undergroundVertices([
      new Float32Array([0, 0, 1, 0, 1, 1]),
    ]);
    // Two spans, four vertices — `LineSegments` does not chain implicitly, so
    // the shared middle point is emitted twice, once as each span's end.
    expect(positions).toHaveLength(4 * 3);
  });

  it("gives a lone node a vertical tick rather than nothing", () => {
    // THE CASE THAT WAS SILENTLY DROPPED. An underground bin or a subway
    // entrance is a node, and "a segment needs two ends" skipped it — so the
    // diagnostic hid the very features it exists to reveal.
    const positions = undergroundVertices([new Float32Array([5, 7])]);

    expect(positions).toEqual([
      5,
      UNDERGROUND_DEPTH_M - NODE_TICK_M,
      -7,
      5,
      UNDERGROUND_DEPTH_M + NODE_TICK_M,
      -7,
    ]);
  });

  it("draws nothing for an empty input", () => {
    expect(undergroundVertices([])).toEqual([]);
  });

  it("skips a degenerate outline without dropping its neighbours", () => {
    // A zero-length outline is not a node and has no segment; it must not
    // swallow the outlines around it.
    const positions = undergroundVertices([
      new Float32Array([]),
      new Float32Array([1, 2]),
    ]);
    expect(positions).toHaveLength(2 * 3);
  });
});

describe("undergroundMaterial", () => {
  it("is transparent, so the render-order ladder actually applies", () => {
    // THE INVARIANT THAT SHIPPED WRONG. `RENDER_ORDER.underground` sits above
    // `areas` and `cells`, but three renders the opaque list first and
    // `renderOrder` only sorts within a list — so an opaque line drew BEFORE
    // the translucent slabs and got blended over by them. The table said it
    // won; the screen said otherwise.
    expect(undergroundMaterial().transparent).toBe(true);
  });

  it("disables depth testing, because the lines live below the terrain", () => {
    expect(undergroundMaterial().depthTest).toBe(false);
  });

  it("uses the shared underground colour", () => {
    expect(undergroundMaterial().color.getHex()).toBe(UNDERGROUND_COLOUR);
  });
});

describe("buildUndergroundLines", () => {
  it("returns undefined when there is nothing below the surface", () => {
    // The common case for most corpora. Adding a zero-vertex object to the
    // scene on every refresh would be pure waste.
    expect(buildUndergroundLines([])).toBeUndefined();
    expect(buildUndergroundLines([new Float32Array([])])).toBeUndefined();
  });

  it("carries the render-order rung and the packed vertices", () => {
    const lines = buildUndergroundLines([new Float32Array([0, 0, 1, 1])])!;

    expect(lines).toBeInstanceOf(THREE.LineSegments);
    expect(lines.renderOrder).toBe(RENDER_ORDER.underground);
    expect(lines.geometry.getAttribute("position").count).toBe(2);
  });
});

describe("the underground colour", () => {
  it("is distinct from every other surface colour", () => {
    // "A colour nothing else uses" was asserted in two sidecars and pinned by
    // nothing, while the map was in fact drawing Leaflet's default blue. A
    // later palette edit could have collided in silence.
    expect(UNDERGROUND_COLOUR).not.toBe(GROUND_COLOUR);
    expect(UNDERGROUND_COLOUR).not.toBe(PLATE_COLOUR);
  });

  it("renders to the same six-digit hex the map hands Leaflet", () => {
    // The two views take the colour in different forms — a number for three,
    // a string for Leaflet — and deriving the string is what stops them
    // drifting apart invisibly.
    expect(cssColour(UNDERGROUND_COLOUR)).toBe("#ff7ad9");
    expect(cssColour(GROUND_COLOUR)).toBe("#6b7280");
  });

  it("pads a colour whose leading channel is small", () => {
    // `toString(16)` drops leading zeros, so a dark colour would become a
    // five-character string that CSS silently ignores.
    expect(cssColour(0x00ff00)).toBe("#00ff00");
    expect(cssColour(0x000001)).toBe("#000001");
  });
});
