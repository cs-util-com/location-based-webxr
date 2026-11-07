/**
 * The builders both 3D views (the flat view and the globe) hand the
 * stations layer to draw a station's items with: the visitor's own, so
 * the editor shows an item as the phone does. One list for both views,
 * so a builder added for one is never missing in the other.
 *
 * @see editor3d-drawings.ts.md
 */
import { TOUR_MAX_IMAGE_PIXELS } from "gps-plus-slam-app-framework/ar/tour-media";
import { decodeFrameTexture } from "gps-plus-slam-app-framework/visualization/frame-texture-decoder";

import { loadGlbModel } from "../glb-model.js";
import { mountLectern } from "../lectern-view.js";
import { createPinLabel } from "../pin-label.js";
import { mountReadingSign } from "../reading-sign.js";
import type { StationsLayerDeps } from "./editor3d-stations.js";

/** What of the stations layer's needs draws an item. */
export type EditorDrawings = Pick<
  StationsLayerDeps,
  | "makeLabel"
  | "makeLectern"
  | "makeReadingSign"
  | "loadPhotoTexture"
  | "loadContent"
  | "loadGlbModel"
>;

/** The item builders, the tour's files read through `loadContent` (a
 *  photo measured before it is decoded, as the visitor's page does). */
export function editorDrawings(
  loadContent: (entry: string) => Promise<Blob>,
): EditorDrawings {
  return {
    makeLabel: createPinLabel,
    makeLectern: mountLectern,
    makeReadingSign: mountReadingSign,
    loadPhotoTexture: async (entry) =>
      decodeFrameTexture(await loadContent(entry), 2, {
        maxPixels: TOUR_MAX_IMAGE_PIXELS,
      }),
    loadContent: (entry) => loadContent(entry),
    loadGlbModel,
  };
}
