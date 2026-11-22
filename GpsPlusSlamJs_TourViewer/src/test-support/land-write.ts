/**
 * A write landing in the tour document, as a save lands it
 * (`tour-document-save.ts`): the save begins, what it wrote lands in the
 * slice (`saved`), the page's document drops the AR placements and station
 * anchors that went with it (`saveLanded`), and the save ends. For tests that
 * need the document after a Finish without running one.
 */
import type { TourManifest } from "gps-plus-slam-app-framework/ar/tour-manifest";
import type {
  CreatorDocument,
  CreatorDocumentStore,
} from "../creator-document.js";
import { tourDocumentActions, type StationFrame } from "../tour-document.js";

export function landWrite(
  store: Pick<CreatorDocumentStore, "dispatch">,
  doc: CreatorDocument,
  save: {
    readonly written: TourManifest;
    readonly appliedDeletions: readonly string[];
    readonly stationsAtStart: readonly StationFrame[];
  },
): void {
  const { generation } = doc.state();
  store.dispatch(tourDocumentActions.saveStarted({ generation }));
  store.dispatch(tourDocumentActions.saved({ generation, ...save }));
  doc.saveLanded(save.written);
  store.dispatch(tourDocumentActions.saveEnded({ generation }));
}
