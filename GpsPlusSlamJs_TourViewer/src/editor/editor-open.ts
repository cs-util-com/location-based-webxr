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
  TourManifestOlderFormatError,
  type TourManifest,
  type TourManifestDrop,
  type TourStationDrop,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import type {
  TourDetailsDrop,
  TourDetailsField,
} from "gps-plus-slam-app-framework/ar/tour-details";
import type { TourIntegrityError } from "gps-plus-slam-app-framework/ar/tour-signed-manifest";
import { describeOpenError, olderFormatRefusal } from "../open-errors.js";
import { stationTitle } from "../station-run.js";
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
      /** The details, station descriptions and card images the reader
       *  left out (a hand-edited file, a card image whose picture is
       *  gone): the next save writes the tour without them
       *  (`droppedDetailsLine`, `droppedStationFieldsLine`). */
      readonly dropped: readonly TourManifestDrop[];
    }
  | {
      readonly kind: "refused";
      readonly reason: string;
      /** A tour of a format this app no longer opens: its file's key
       *  (the draft's, `editorDraftKey`) and the refusal, so the page
       *  can delete the draft it kept for it and say so. */
      readonly olderFormat?: {
        readonly fileKey: string;
        readonly error: TourManifestOlderFormatError;
      };
    };

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
        // Only a station's drop names its station.
        .filter((d): d is TourDetailsDrop => !("station" in d))
        .map((d) => DETAIL_WORDS[d.field]),
    ),
  ];
  if (names.length === 0) return null;
  const it = names.length === 1 ? "it" : "them";
  return `This tour's ${listed(names)} could not be read, so the editor left ${it} out: the next save writes the tour without ${it}. Set ${it} again in the tour's details.`;
}

/**
 * Said once a tour opened with station descriptions or card images its
 * reader dropped (format minor 2; G2 build plan 2026-10-21-2247, Q14): a
 * card image whose photo or image asset is gone, or a value a hand edit
 * broke. Which stations, by the names the rail shows (`stationTitle`
 * against `manifest`, never the random id), and that the next save writes
 * them without - never a silent loss. Apart from the details' line, since
 * neither is a tour detail. Null when none was dropped.
 */
export function droppedStationFieldsLine(
  dropped: readonly TourManifestDrop[],
  manifest: Pick<TourManifest, "stations">,
): string | null {
  const drops = dropped.filter((d): d is TourStationDrop => "station" in d);
  if (drops.length === 0) return null;
  const name = (id: string): string => {
    const index = manifest.stations.findIndex((s) => s.id === id);
    const station = manifest.stations[index];
    // Every dropped station is one the reader kept; the id is a fallback.
    return `"${station === undefined ? id : stationTitle(station, index + 1)}"`;
  };
  const gone = drops.filter((d) => d.cause === "station-image-gone");
  const broken = drops.filter((d) => d.cause === undefined);
  const sentences: string[] = [];
  if (gone.length > 0) {
    const [noun, verb] =
      gone.length === 1
        ? ["image", "names a picture"]
        : ["images", "name pictures"];
    sentences.push(
      `The card ${noun} of ${listed(gone.map((d) => name(d.station)))} ${verb} this tour no longer has.`,
    );
  }
  if (broken.length > 0) {
    const what = broken.map(
      (d) =>
        `${d.field === "image" ? "the card image" : "the description"} of ${name(d.station)}`,
    );
    const first = listed(what);
    sentences.push(
      `${first.charAt(0).toUpperCase()}${first.slice(1)} could not be read.`,
    );
  }
  const it = drops.length === 1 ? "it" : "them";
  const where =
    new Set(drops.map((d) => d.station)).size === 1
      ? "the station"
      : "those stations";
  sentences.push(
    `The editor left ${it} out: the next save writes ${where} without ${it}.`,
  );
  return sentences.join(" ");
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
    if (err instanceof TourManifestOlderFormatError) {
      return {
        kind: "refused",
        reason: olderFormatRefusal(err, false),
        olderFormat: { fileKey: session.archive.url, error: err },
      };
    }
    return {
      kind: "refused",
      reason: `This tour cannot be read: ${describeOpenError(err)}`,
    };
  }
}
