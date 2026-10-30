/**
 * Who owns an input in the editor on the globe: the globe's camera
 * controls, or the editor. The owner's decisions (2026-10-27): the camera
 * steers as in the globe lab, the rest is adapted, and the right click
 * stays - a right drag rotates, a right click that did not move opens the
 * editor's menu; a double click on an object selects it and flies to it,
 * on the ground it zooms as in the lab; the arrow keys nudge while
 * something is selected and move the camera otherwise; two fingers are
 * the camera's, as in the lab (its pinch, twist and tilt).
 *
 * Pure: one input in, one route out. The page wires each route.
 *
 * @see globe-gestures.ts.md
 */

/** The table's one parameter. */
export const GLOBE_GESTURES = Object.freeze({
  /**
   * A press that moved this far (CSS px) or more is a drag, less a click
   * (measured in the lab: 3 px allows about 1.2 degrees of accidental
   * turn, 8 px about 3.3).
   */
  dragPx: 5,
});

/** What is under the pointer: an object, a handle of the gizmo, the ground, or the sky. */
export type GlobeHit = "object" | "handle" | "ground" | "sky";

/** One input, as the page sees it. */
export type GlobeInput =
  /** A button went down (who takes the drag that may follow). */
  | {
      readonly kind: "press";
      readonly button: "left" | "right";
      readonly on: GlobeHit;
    }
  /** A button came up, `movedPx` from where it went down. */
  | {
      readonly kind: "release";
      readonly button: "left" | "right";
      readonly on: GlobeHit;
      readonly movedPx: number;
    }
  /** A double click (or a double tap). */
  | { readonly kind: "double"; readonly on: GlobeHit }
  /** An arrow key, with or without a selection. */
  | { readonly kind: "arrow"; readonly selected: boolean }
  /** A second finger came down; `on` is where the first one started. */
  | { readonly kind: "fingers"; readonly on: GlobeHit };

/**
 * Where an input goes:
 * - `camera` - the globe's controls take it (a drag pans or rotates);
 * - `edit` - the editor's gizmo takes it (the controls leased off);
 * - `select` / `deselect` - the editor's selection;
 * - `menu` - the editor's menu at the pointer;
 * - `select-and-fly` - select the object and fly the camera to it;
 * - `camera-zoom` - the controls' own double-click zoom;
 * - `nudge` - the editor nudges the selection;
 * - `camera-step` - the editor steps the camera (the lab's keys do nothing);
 * - `none` - nothing more (the drag already happened).
 */
export type GlobeRoute =
  | "camera"
  | "edit"
  | "select"
  | "deselect"
  | "menu"
  | "select-and-fly"
  | "camera-zoom"
  | "nudge"
  | "camera-step"
  | "none";

/**
 * The route of one input. A release that moved `dragPx` or more was a
 * drag: the controls (or the gizmo, for a handle) already had it, so
 * nothing more happens, except that a gizmo drag ends as an edit.
 * RangeError for a `movedPx` that is NaN or negative, or a `dragPx` that is
 * not finite and positive.
 */
export function routeGlobeInput(
  input: GlobeInput,
  dragPx: number = GLOBE_GESTURES.dragPx,
): GlobeRoute {
  if (!Number.isFinite(dragPx) || dragPx <= 0) {
    throw new RangeError(`dragPx must be finite and > 0, got ${dragPx}`);
  }
  switch (input.kind) {
    case "press":
      return input.button === "left" && input.on === "handle"
        ? "edit"
        : "camera";
    case "release": {
      if (Number.isNaN(input.movedPx) || input.movedPx < 0) {
        throw new RangeError(`movedPx must be >= 0, got ${input.movedPx}`);
      }
      if (input.button === "left" && input.on === "handle") return "edit";
      if (input.movedPx >= dragPx) return "none";
      if (input.button === "right") return "menu";
      return input.on === "object" ? "select" : "deselect";
    }
    case "double":
      if (input.on === "object") return "select-and-fly";
      return input.on === "handle" ? "none" : "camera-zoom";
    case "arrow":
      return input.selected ? "nudge" : "camera-step";
    case "fingers":
      // The controls' own two-finger gestures; a handle drag the first
      // finger started is cancelled (the page's rule for a second finger).
      return "camera";
  }
}
