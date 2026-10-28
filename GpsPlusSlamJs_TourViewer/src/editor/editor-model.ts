/**
 * What the desktop editor shows of a tour (M6 E1), page-free: the rail's
 * groups (codes, pins, photos) and the map's marks, built on the summary's
 * model (`summary-model.ts` `buildSummaryModel`: positions, the codes'
 * labels in the phone's numbering, readable coordinates only) and the one
 * naming rule (`object-describe.ts`). Pure.
 *
 * @see editor-model.ts.md
 */

import type { QrLevel } from "gps-plus-slam-app-framework/ar/qr/qr-level";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import type {
  TourManifest,
  TourObject,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import { horizontalM } from "../move-with-code.js";
import { codeDistanceLine, objectTitle } from "../object-describe.js";
import { stationTitle } from "../station-run.js";
import {
  buildSummaryModel,
  readablePoint,
  type MapPoint,
} from "../summary-model.js";

export type EditorItemKind = "code" | "pin" | "photo" | "station";

/** One row in the rail and, with a position, one mark on the map. */
export interface EditorItem {
  readonly id: string;
  readonly kind: EditorItemKind;
  /** "Code 1" / an object's name (`objectTitle`). Text, never
   *  markup: it comes from a zip anyone can write. */
  readonly title: string;
  /** The row's second line. */
  readonly meta: string;
  /** Where it is drawn; null for a code without a stored position. */
  readonly at: MapPoint | null;
  /** A code's number (1-based) in the phone's numbering. */
  readonly number?: number;
  /** A photo's image: its content path inside the tour's folder. */
  readonly image?: string;
  /** A station standing at a code's point (within {@link ON_CODE_M}): the
   *  map draws it beside the code, never under it (PR #609 review). */
  readonly onCode?: true;
}

/** How near a code's measured point a station counts as standing at it:
 *  the map would draw the two over each other. A station placed at a
 *  poster stands where the phone was, a metre or so off. */
export const ON_CODE_M = 1;

export interface EditorModel {
  /** The tour's title, else the file's name. */
  readonly title: string;
  readonly items: readonly EditorItem[];
  readonly counts: Readonly<Record<EditorItemKind, number>>;
  /** Everything with a position, for framing the map. */
  readonly fitPoints: readonly MapPoint[];
}

/** A station's id in the editor: stations and objects have separate id
 *  spaces in the manifest. */
export const STATION_PREFIX = "station:";

function noteMeta(object: TourObject, codes: readonly QrGeoPose[]): string {
  const distance = codeDistanceLine(object, codes);
  const kind = object.kind === "shortText" ? "Text note" : "Photo note";
  return distance === "" ? kind : `${kind} · ${distance}`;
}

/**
 * The editor's view of a tour. `levels` in the zip's order is the phone's
 * numbering (`creator-codes.ts` `numbering`), so a code has one name on
 * both pages.
 */
export function buildEditorModel(input: {
  readonly manifest: TourManifest;
  /** The tour's pins and photos in the world, with the page's edits
   *  (the stations keep them as free blocks; `tour-content.ts`). */
  readonly objects: readonly TourObject[];
  readonly levels: ReadonlyMap<string, QrLevel>;
  readonly fileName: string;
}): EditorModel {
  const { manifest, objects } = input;
  const references = [...input.levels].map(([levelId, level]) => ({
    levelId,
    geo: level.qr.geo ?? null,
  }));
  const summary = buildSummaryModel({
    visits: [],
    references,
    objects,
  });
  const stored = references.flatMap((r) => (r.geo === null ? [] : [r.geo]));
  const codes: EditorItem[] = summary.codes.map((code, index) => ({
    id: code.levelId,
    kind: "code",
    title: code.label,
    meta:
      code.reference === null
        ? "Printed code, no position stored yet"
        : "Printed code, measured on site",
    at:
      code.reference === null
        ? null
        : { lat: code.reference.lat, lng: code.reference.lng },
    number: index + 1,
  }));
  // Every note is listed; one whose position cannot be drawn stays in the
  // list without a mark, so it can still be found (E1 review #9). The
  // summary keeps only the drawable ones.
  const drawable = new Map(summary.objects.map((s) => [s.id, s]));
  // Pins and photos only: this 2D editor lists no placed 3D model (format
  // minor 1) rather than a mislabelled note; the tour keeps it untouched.
  const notes: EditorItem[] = objects.flatMap((object): EditorItem[] => {
    if (object.kind === "model") return [];
    const mark = drawable.get(object.id);
    return [
      {
        id: object.id,
        kind: object.kind === "shortText" ? "pin" : "photo",
        title: objectTitle(object),
        meta:
          mark === undefined
            ? `${object.kind === "shortText" ? "Text note" : "Photo note"} · no position`
            : noteMeta(object, stored),
        at: mark === undefined ? null : { lat: mark.lat, lng: mark.lng },
        ...(object.kind === "picture" ? { image: object.imageAsset.path } : {}),
      },
    ];
  });
  // The walk's debug camera captures are never items: they are debug
  // data, not the tour's content (the map's debug layer draws them,
  // `debug-capture-layer.ts`).
  // The stations (tour kit plan K4; version 3: each at its own position,
  // the frame of its pins and photos, D9). A story tour may carry nothing
  // else (the committed sample).
  const stations: EditorItem[] = manifest.stations.map(
    (station, index): EditorItem => {
      const number = index + 1;
      const own = { lat: station.geo.lat, lng: station.geo.lon };
      const drawn = readablePoint(own);
      const onCode =
        drawn &&
        stored.some((code) => horizontalM(code, station.geo) <= ON_CODE_M);
      return {
        id: `${STATION_PREFIX}${station.id}`,
        kind: "station",
        title: stationTitle(station, number),
        meta: `Station ${String(number)}`,
        at: drawn ? own : null,
        number,
        ...(onCode ? { onCode: true as const } : {}),
      };
    },
  );
  const items = [...codes, ...notes, ...stations];
  const count = (kind: EditorItemKind): number =>
    items.filter((i) => i.kind === kind).length;
  const title = manifest.title?.trim() ?? "";
  return {
    title: title === "" ? input.fileName : title,
    items,
    counts: {
      code: count("code"),
      pin: count("pin"),
      photo: count("photo"),
      station: count("station"),
    },
    fitPoints: items.flatMap((i) => (i.at === null ? [] : [i.at])),
  };
}

/** The rail's rows for a search: every item whose title or second line
 *  contains `query` (case-insensitive, trimmed); all for an empty query. */
export function filterItems(
  items: readonly EditorItem[],
  query: string,
): EditorItem[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [...items];
  return items.filter(
    (i) =>
      i.title.toLowerCase().includes(q) || i.meta.toLowerCase().includes(q),
  );
}

/** Where a photo item's bytes are (E1 review #1): its image, a content
 *  path inside the tour's folder (`TourSession.loadContentEntry`); null
 *  without a photo. */
export function photoSource(item: EditorItem): string | null {
  if (item.kind !== "photo" || item.image === undefined) return null;
  return item.image;
}
