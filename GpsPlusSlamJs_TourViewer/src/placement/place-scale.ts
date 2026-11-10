/**
 * The scale a drawing was made at, marked on the drawn object, so a
 * preview can draw it at another value of its extent (a model's size, a
 * picture's width) and back, without knowing what kind of thing it is.
 * A drawing marks the object whose scale carries its extent
 * (`markPlaceScale`); a preview scales that object by the ratio of the
 * dragged value to the drawn one (`drawAtExtent`).
 *
 * It also holds how much larger than its own size a block is drawn: the
 * scale of the folders holding it (`drawInherited`), which a sound's
 * hearing range grows with too (`inheritedScaleOf`).
 *
 * @see place-scale.ts.md
 */
import type { Object3D } from "three";

/** The `userData` keys: the scale drawn, the extent it was drawn at, and
 *  the folders' scale it is drawn at. */
const SCALE = "placeScale";
const EXTENT = "placeExtent";
const INHERITED = "placeInherited";

/** Mark `object`'s scale now as the one its extent `extent` was drawn
 *  at. A non-positive or non-finite extent marks nothing. */
export function markPlaceScale(object: Object3D, extent: number): void {
  if (!Number.isFinite(extent) || extent <= 0) return;
  object.userData[SCALE] = object.scale.toArray();
  object.userData[EXTENT] = extent;
}

/** The drawn scale and extent `object` was marked with; null for none or
 *  a mark that is no numbers. */
function markOf(
  object: Object3D,
): { scale: [number, number, number]; extent: number } | null {
  const scale: unknown = object.userData[SCALE];
  const extent: unknown = object.userData[EXTENT];
  if (
    !Array.isArray(scale) ||
    scale.length !== 3 ||
    !scale.every((v) => typeof v === "number" && Number.isFinite(v)) ||
    typeof extent !== "number" ||
    !Number.isFinite(extent) ||
    extent <= 0
  ) {
    return null;
  }
  return { scale: scale as [number, number, number], extent };
}

/** Draw the first marked object under `root` (itself included) at its
 *  extent `value`, scaled from what was drawn; null (or a value that is
 *  no positive number) draws it as it was drawn. Nothing for a root
 *  with no mark. */
export function drawAtExtent(root: Object3D, value: number | null): void {
  let marked: Object3D | null = null;
  root.traverse((o) => {
    if (marked === null && markOf(o) !== null) marked = o;
  });
  // A traverse's callback is not followed by the narrowing.
  const object = marked as Object3D | null;
  const mark = object === null ? null : markOf(object);
  if (object === null || mark === null) return;
  const f =
    value === null || !Number.isFinite(value) || value <= 0
      ? 1
      : value / mark.extent;
  object.scale.set(mark.scale[0] * f, mark.scale[1] * f, mark.scale[2] * f);
}

/** Whether `scale` is one a drawing can be made larger by. */
function isScale(scale: unknown): scale is number {
  return typeof scale === "number" && Number.isFinite(scale) && scale > 0;
}

/** How much larger than its own size `object` (a drawn block's root) is
 *  drawn: the scale `drawInherited` last set; 1 for none. */
export function inheritedScaleOf(object: Object3D): number {
  const scale: unknown = object.userData[INHERITED];
  return isScale(scale) ? scale : 1;
}

/** Draw `object` (a drawn block's root) `scale` times larger than its
 *  own size: the scale of the folders holding it. Set, not added: a
 *  second call with another scale (a folder's scale being dragged)
 *  replaces the first, and one with the tour's scale draws it as the
 *  tour has it again. Its own place-scale mark, if it carries one,
 *  grows with it, so `drawAtExtent` keeps the folders' scale. A scale
 *  that is no positive number draws it at 1. */
export function drawInherited(object: Object3D, scale: number): void {
  const next = isScale(scale) ? scale : 1;
  const was = inheritedScaleOf(object);
  if (next === was) return;
  const f = next / was;
  object.scale.multiplyScalar(f);
  const mark = markOf(object);
  if (mark !== null) {
    object.userData[SCALE] = mark.scale.map((v) => v * f);
  }
  if (next === 1) delete object.userData[INHERITED];
  else object.userData[INHERITED] = next;
}
