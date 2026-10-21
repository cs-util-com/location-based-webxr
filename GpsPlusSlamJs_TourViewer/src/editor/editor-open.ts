/**
 * Opening a tour file in the desktop editor (M6 E1): the viewer's own
 * `openTourFile` (its caps and integrity checks), then the manifest and
 * the codes, or the reason it cannot be edited, in the page's words
 * (`open-errors.ts`). A zip that carries neither a tour manifest nor a
 * code - a Recorder or scan zip - is refused as "not a tour file" rather
 * than shown as an empty map (M6 E1 plan review #8).
 *
 * @see editor-open.ts.md
 */

import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import {
  createEmptyTourManifest,
  type TourManifest,
  type TourManifestDrop,
  type TourStationImageDrop,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import type {
  TourDetailsDrop,
  TourDetailsField,
} from "gps-plus-slam-app-framework/ar/tour-details";
import type { TourIntegrityError } from "gps-plus-slam-app-framework/ar/tour-signed-manifest";
import { describeOpenError } from "../open-errors.js";
import { openTourFile, type TourSession } from "../tour-session.js";

export type EditorOpen =
  | {
      readonly kind: "opened";
      readonly session: TourSession;
      /** The tour as the file has it, an empty one for a zip that
       *  carries codes and no tour.json. The walk's debug camera
       *  captures start no station. */
      readonly manifest: TourManifest;
      readonly levels: ReadonlyMap<string, QrLevel>;
      readonly fileName: string;
      /** The details and station card images the reader left out (a
       *  hand-edited file, a card image whose picture is gone): the next
       *  save writes the tour without them (`droppedDetailsLine`,
       *  `droppedStationImagesLine`). */
      readonly dropped: readonly TourManifestDrop[];
    }
  | { readonly kind: "refused"; readonly reason: string };

/** Said for a zip that is not a tour. */
export const NOT_A_TOUR =
  "This file is not a tour: it carries no tour.json and no printed codes. Choose the .zip your phone's Finish saved.";

/** Said for a file that is not a zip at all. */
export const NOT_A_ZIP = "This file is not a .zip file.";

/** Each detail as the page names it (`edit.html`'s "Tour details"). */
const DETAIL_WORDS: Readonly<Record<TourDetailsField, string>> = {
  description: "description",
  cover: "cover",
  contact: "contact",
};

/**
 * Said once a tour opened with details its reader dropped (M4a review #6):
 * which ones, and that the next save writes the tour without them - never
 * a silent loss. Null when none was dropped.
 */
export function droppedDetailsLine(
  dropped: readonly TourManifestDrop[],
): string | null {
  const names = [
    ...new Set(
      dropped
        .filter((d): d is TourDetailsDrop => d.field !== "image")
        .map((d) => DETAIL_WORDS[d.field]),
    ),
  ];
  if (names.length === 0) return null;
  const it = names.length === 1 ? "it" : "them";
  return `This tour's ${listed(names)} could not be read, so the editor left ${it} out: the next save writes the tour without ${it}. Set ${it} again in the tour's details.`;
}

/**
 * Said once a tour opened with station card images its reader dropped
 * (format minor 2: the photo or image asset a card named is gone; G2
 * build plan 2026-10-21-2247, Q14): which stations, by id, and that the
 * next save writes them without - never a silent loss. Apart from the
 * details' line, since a card image is no tour detail. Null when none was
 * dropped.
 */
export function droppedStationImagesLine(
  dropped: readonly TourManifestDrop[],
): string | null {
  const stations = [
    ...new Set(
      dropped
        .filter((d): d is TourStationImageDrop => d.field === "image")
        .map((d) => `"${d.station}"`),
    ),
  ];
  if (stations.length === 0) return null;
  if (stations.length === 1) {
    return `The card image of station ${String(stations[0])} names a picture this tour no longer has, so the editor left it out: the next save writes the station without it.`;
  }
  return `The card images of ${String(stations.length)} stations (${listed(stations)}) name pictures this tour no longer has, so the editor left them out: the next save writes those stations without them.`;
}

/** `words` as a sentence lists them: "a", "a and b", "a, b and c". */
function listed(words: readonly string[]): string {
  return words.length === 1
    ? String(words[0])
    : `${words.slice(0, -1).join(", ")} and ${String(words.at(-1))}`;
}

export async function openTourForEditing(
  file: File,
  options: {
    /** A late integrity failure (an entry read or the background whole-file
     *  check): the page tears the tour down (tour-session.ts). */
    readonly onIntegrityFailure?: (
      err: TourIntegrityError,
      session: TourSession,
    ) => void;
    /** The opener, replaceable in tests. */
    readonly open?: typeof openTourFile;
  } = {},
): Promise<EditorOpen> {
  if (!/\.zip$/i.test(file.name) && file.type !== "application/zip") {
    return { kind: "refused", reason: NOT_A_ZIP };
  }
  let session: TourSession;
  try {
    session = await (options.open ?? openTourFile)(
      file,
      options.onIntegrityFailure === undefined
        ? {}
        : { onIntegrityFailure: options.onIntegrityFailure },
    );
  } catch (err) {
    return { kind: "refused", reason: describeOpenError(err) };
  }
  try {
    const dropped: TourManifestDrop[] = [];
    const [manifest, levels] = await Promise.all([
      session.loadTourManifest({
        onDropped: (drop) => {
          dropped.push(drop);
        },
      }),
      session.loadQrLevels(),
    ]);
    if (manifest === null && levels.size === 0) {
      await session.close();
      return { kind: "refused", reason: NOT_A_TOUR };
    }
    return {
      kind: "opened",
      session,
      manifest: manifest ?? createEmptyTourManifest(),
      levels,
      fileName: file.name,
      dropped,
    };
  } catch (err) {
    // A broken tour.json or level file rejects after the open succeeded.
    await session.close().catch(() => undefined);
    return {
      kind: "refused",
      reason: `This tour cannot be read: ${describeOpenError(err)}`,
    };
  }
}
