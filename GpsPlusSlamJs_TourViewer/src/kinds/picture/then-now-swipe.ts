/**
 * Then and now's swipe: a vertical line across the whole screen that the
 * visitor drags, the old picture on its left and today on its right, as
 * on the chosen page (its `uMode` 0 and `uSplit`). Two pieces: where a
 * finger puts the line (a share of the screen's width, kept off the
 * edges), and the mask that cuts the picture's plane at that share in its
 * shader, so the overlay stays a basic material whose opacity and soft
 * edge (`then-now-feather.ts`) the part keeps writing.
 *
 * @see then-now-swipe.ts.md
 */
import type { MeshBasicMaterial } from "three";

/** The line never reaches the screen's edges: the knob stays in reach. */
export const SWIPE_SPLIT_MIN = 0.04;
export const SWIPE_SPLIT_MAX = 0.96;
/** Where the line stands until the visitor drags it: the middle. */
export const SWIPE_SPLIT_START = 0.5;

/** How far the knob's centre stays in from either edge of the screen
 *  (CSS px): clear of the system's edge gestures (Android's back swipe),
 *  and a whole knob still on the screen. */
export const SWIPE_EDGE_PX = 48;

/**
 * The line's reach on a screen `width` CSS px wide: the share's own
 * reach, narrowed so the knob's centre stays `SWIPE_EDGE_PX` in from
 * either edge; the middle alone on a screen too narrow for both. A
 * width that is not a positive finite number gives the share's reach.
 */
export function swipeReach(width: number): readonly [number, number] {
  if (!(width > 0) || !Number.isFinite(width)) {
    return [SWIPE_SPLIT_MIN, SWIPE_SPLIT_MAX];
  }
  const edge = Math.min(0.5, SWIPE_EDGE_PX / width);
  return [Math.max(SWIPE_SPLIT_MIN, edge), Math.min(SWIPE_SPLIT_MAX, 1 - edge)];
}

/** `split` kept in its reach (on a screen `width` px wide, when known);
 *  one that is no number is the middle. */
export function clampSwipeSplit(split: number, width = Number.NaN): number {
  if (!Number.isFinite(split)) return SWIPE_SPLIT_START;
  const [lo, hi] = swipeReach(width);
  return Math.min(hi, Math.max(lo, split));
}

/**
 * The line's place for a finger at `clientX` over a screen whose left
 * edge is at `left` and which is `width` wide (CSS pixels): the share of
 * the width, clamped. A screen with no width keeps the middle.
 */
export function swipeSplitAt(
  clientX: number,
  left: number,
  width: number,
): number {
  if (!(width > 0) || !Number.isFinite(left)) return SWIPE_SPLIT_START;
  return clampSwipeSplit((clientX - left) / width, width);
}

/** The vertex side: the clip position, so the fragment knows its place
 *  across the screen whatever the viewport's size (in AR the XR layer's,
 *  not the page's). */
const SWIPE_VERTEX = `
vThenNowClip = gl_Position;`;

/** The fragment side: past the split, the picture is gone. The edge is a
 *  pixel soft (`fwidth`), as the prototype's two-pixel step. */
const SWIPE_FRAGMENT = `
if (uThenNowSwipe > 0.5) {
  float thenNowX = vThenNowClip.x / vThenNowClip.w * 0.5 + 0.5;
  float thenNowEdge = max(fwidth(thenNowX), 1e-4);
  diffuseColor.a *= 1.0 - smoothstep(uThenNowSplit - thenNowEdge, uThenNowSplit + thenNowEdge, thenNowX);
}`;

/** The mask's handle: `set` writes the uniforms (no recompile). */
export interface SwipeMask {
  /** Cut at `split` (a share of the screen's width) while `on`; the whole
   *  picture otherwise. */
  set(on: boolean, split: number): void;
  /** What the shader reads now: for tests and the page's test hook. */
  readonly state: () => { readonly on: boolean; readonly split: number };
}

/** Wires the swipe into `material`'s shader (three's basic one). */
export function swipeMask(material: MeshBasicMaterial): SwipeMask {
  const on = { value: 0 };
  const split = { value: SWIPE_SPLIT_START };
  material.onBeforeCompile = (shader) => {
    shader.uniforms["uThenNowSwipe"] = on;
    shader.uniforms["uThenNowSplit"] = split;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec4 vThenNowClip;",
      )
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>${SWIPE_VERTEX}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec4 vThenNowClip;\nuniform float uThenNowSwipe;\nuniform float uThenNowSplit;",
      )
      .replace(
        "#include <alphamap_fragment>",
        `#include <alphamap_fragment>${SWIPE_FRAGMENT}`,
      );
  };
  material.customProgramCacheKey = () => "picture-then-now-swipe";
  material.needsUpdate = true;
  return {
    set(isOn, at) {
      on.value = isOn ? 1 : 0;
      split.value = clampSwipeSplit(at);
    },
    state: () => ({ on: on.value > 0.5, split: split.value }),
  };
}
