/**
 * The visitor's pin sheet (station blocks plan B2b step 5; the design's
 * tap floor, §2.5): a short text stands in the world as its caption (a
 * `pin`), and a tap on it in AR opens a sheet on the screen with its whole
 * text - the caption and the description. Only a pin with a description
 * opens one (the caption alone is already in the world). A tap on nothing
 * closes the sheet.
 *
 * The tap is the session's `select` (`seams.startXrSelect`); what it hit
 * is `seams.pickObjectInView` over the pins drawn now - each a station's
 * content child carrying its block id (`content-placement.ts`).
 *
 * @see pin-sheet.ts.md
 */

import type { Object3D } from "three";
import type { SelectTargetRay } from "gps-plus-slam-app-framework/ar";
import type {
  TourBlock,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";

/** What the visitor's overlay keeps from becoming an XR select (its
 *  `beforexrselect` is cancelled): a tap on a control or on a sheet or
 *  card. A tap on the overlay's open view stays a select - a pin's tap. */
const OVERLAY_TAPS =
  "button, a, input, select, textarea, summary, .sheet, #scene-panel";

/** Whether a tap on `target` (a `beforexrselect`'s) is the overlay's,
 *  not the world's. */
export function cancelsXrSelect(
  target: { closest(selector: string): unknown } | null,
): boolean {
  return target !== null && target.closest(OVERLAY_TAPS) !== null;
}

/** Every station's blocks by id (block ids are unique tour-wide). */
export function tourBlocksById(
  manifest: {
    readonly stations: readonly Pick<TourStation, "blocks">[];
  } | null,
): Map<string, TourBlock> {
  return new Map(
    (manifest?.stations ?? []).flatMap((s) =>
      s.blocks.map((b) => [b.id, b] as const),
    ),
  );
}

/** The sheet's elements. */
export interface PinSheetDom {
  readonly sheet: Pick<HTMLElement, "hidden">;
  readonly title: Pick<HTMLElement, "textContent">;
  readonly text: Pick<HTMLElement, "textContent">;
}

/** Whether `object` and every ancestor is visible. */
function shown(object: Object3D): boolean {
  for (let o: Object3D | null = object; o !== null; o = o.parent) {
    if (!o.visible) return false;
  }
  return true;
}

/** A pin block's whole text, or null for any other block, or a pin
 *  without a description. */
function sheetOf(
  block: TourBlock | undefined,
): { readonly caption: string; readonly description: string } | null {
  if (block?.kind !== "shortText" || block.view !== "pin") return null;
  const { description } = block;
  return description === undefined || description === ""
    ? null
    : { caption: block.caption, description };
}

/**
 * The pins a tap may open now: every shown object under a station's
 * content group (`station-content:<id>`) whose `userData.objectId` names a
 * pin with a description in `blocks`, by that id.
 */
export function tappablePins(
  scene: Object3D,
  blocks: ReadonlyMap<string, TourBlock>,
): Map<string, Object3D> {
  const pins = new Map<string, Object3D>();
  for (const group of scene.children) {
    if (!group.name.startsWith("station-content:")) continue;
    group.traverse((object) => {
      const id: unknown = object.userData["objectId"];
      if (typeof id !== "string" || pins.has(id)) return;
      if (sheetOf(blocks.get(id)) === null || !shown(object)) return;
      pins.set(id, object);
    });
  }
  return pins;
}

export interface PinSheetDeps {
  readonly dom: PinSheetDom;
  /** The scene the stations' content hangs under, or null outside AR. */
  scene(): Object3D | null;
  /** The open tour's blocks by id (every station's). */
  blocks(): ReadonlyMap<string, TourBlock>;
  /** The id of the object under the tap (`seams.pickObjectInView`). */
  pick(
    targets: ReadonlyMap<string, Object3D>,
    tap: SelectTargetRay | null,
  ): string | null;
}

export interface PinSheet {
  /** A tap in AR: opens the tapped pin's sheet, or closes the sheet when
   *  the tap hit no pin. */
  tapped(tap: SelectTargetRay | null): void;
  /** Close the sheet (its close button, the session's end). */
  close(): void;
  /** The pin whose sheet is open, or null. */
  openId(): string | null;
}

export function createPinSheet(deps: PinSheetDeps): PinSheet {
  const { dom } = deps;
  let open: string | null = null;
  const close = (): void => {
    open = null;
    dom.sheet.hidden = true;
    dom.title.textContent = "";
    dom.text.textContent = "";
  };
  return {
    tapped(tap) {
      const scene = deps.scene();
      const blocks = deps.blocks();
      const hit =
        scene === null ? null : deps.pick(tappablePins(scene, blocks), tap);
      const sheet = hit === null ? null : sheetOf(blocks.get(hit));
      if (hit === null || sheet === null) {
        close();
        return;
      }
      open = hit;
      dom.title.textContent = sheet.caption;
      dom.text.textContent = sheet.description;
      dom.sheet.hidden = false;
    },
    close,
    openId: () => open,
  };
}
