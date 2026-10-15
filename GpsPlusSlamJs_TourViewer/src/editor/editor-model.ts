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
import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-stations";
import { codeDistanceLine, objectTitle } from "../object-describe.js";
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
  /** "Code 1" / a pin's text / a photo's caption or "Photo". Text, never
   *  markup: it comes from a zip anyone can write. */
  readonly title: string;
  /** The row's second line. */
  readonly meta: string;
  /** Where it is drawn; null for a code without a stored position. */
  readonly at: MapPoint | null;
  /** A code's number (1-based) in the phone's numbering. */
  readonly number?: number;
  /** A photo's image entry: the content path of a placed photo, the
   *  recording's frame of a recorded one. */
  readonly image?: string;
  /** A recorded photo (`captureSpots`), placed for visitors at the Finish
   *  and not editable as a note. */
  readonly recorded?: boolean;
  /** A station drawn at its code's point (it has no position of its own):
   *  the map draws it beside the code, never under it. */
  readonly onCode?: true;
}

export interface EditorModel {
  /** The tour's title, else the file's name. */
  readonly title: string;
  readonly items: readonly EditorItem[];
  readonly counts: Readonly<Record<EditorItemKind, number>>;
  /** Everything with a position, for framing the map. */
  readonly fitPoints: readonly MapPoint[];
}

/** A recorded photo's id: its frame's entry name, which is unique. */
const RECORDED_PREFIX = "recorded:";

/** A station's id in the editor: stations and objects have separate id
 *  spaces in the manifest. */
const STATION_PREFIX = "station:";

/** A station's name in the rail, the map and the editor's warnings: its
 *  title, else "Station N" by its 1-based place in the story. */
export function stationTitle(
  station: Pick<TourStation, "title">,
  number: number,
): string {
  const title = station.title?.trim() ?? "";
  return title === "" ? `Station ${String(number)}` : title;
}

function noteMeta(object: TourObject, codes: readonly QrGeoPose[]): string {
  const distance = codeDistanceLine(object, codes);
  const kind = object.kind === "pin" ? "Text note" : "Photo note";
  return distance === "" ? kind : `${kind} · ${distance}`;
}

/**
 * The editor's view of a tour. `levels` in the zip's order is the phone's
 * numbering (`creator-codes.ts` `numbering`), so a code has one name on
 * both pages.
 */
export function buildEditorModel(input: {
  readonly manifest: TourManifest;
  readonly levels: ReadonlyMap<string, QrLevel>;
  readonly fileName: string;
}): EditorModel {
  const { manifest } = input;
  const references = [...input.levels].map(([levelId, level]) => ({
    levelId,
    geo: level.qr.geo ?? null,
  }));
  const summary = buildSummaryModel({
    visits: [],
    references,
    objects: manifest.objects,
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
  const notes: EditorItem[] = manifest.objects.map((object) => {
    const mark = drawable.get(object.id);
    return {
      id: object.id,
      kind: object.kind,
      title: objectTitle(object),
      meta:
        mark === undefined
          ? `${object.kind === "pin" ? "Text note" : "Photo note"} · no position`
          : noteMeta(object, stored),
      at: mark === undefined ? null : { lat: mark.lat, lng: mark.lng },
      ...(object.kind === "photo" ? { image: object.image } : {}),
    };
  });
  const recorded: EditorItem[] = (manifest.captureSpots?.captures ?? [])
    .map((c) => ({ capture: c, at: { lat: c.geo.lat, lng: c.geo.lon } }))
    // A fix that cannot be drawn keeps its row, as a note's does (E1 review
    // #9, PR #609 review): off the map, still findable and counted.
    .map(({ capture, at }) => {
      const onMap = readablePoint(at);
      return {
        id: `${RECORDED_PREFIX}${capture.image}`,
        kind: "photo",
        title: "Recorded photo",
        meta: onMap
          ? "Photo · recorded on the walk"
          : "Photo · recorded on the walk · no position",
        at: onMap ? at : null,
        image: capture.image,
        recorded: true,
      };
    });
  // The story's stations (tour kit plan K4): where each starts, at its own
  // position or at the code it is anchored to. A story tour may carry
  // nothing else (the committed sample).
  const stations: EditorItem[] = manifest.stations.flatMap(
    (station, index): EditorItem[] => {
      const number = index + 1;
      const code =
        station.anchor.code === undefined
          ? undefined
          : codes.find((c) => c.id === station.anchor.code);
      const own =
        station.anchor.geo === undefined
          ? null
          : { lat: station.anchor.geo.lat, lng: station.anchor.geo.lon };
      const ownDrawn = own !== null && readablePoint(own);
      const at = ownDrawn ? own : (code?.at ?? null);
      return [
        {
          id: `${STATION_PREFIX}${station.id}`,
          kind: "station",
          title: stationTitle(station, number),
          meta:
            code === undefined
              ? `Station ${String(number)}`
              : `Station ${String(number)} · at ${code.title}`,
          at,
          number,
          ...(!ownDrawn && at !== null ? { onCode: true as const } : {}),
        },
      ];
    },
  );
  const items = [...codes, ...notes, ...recorded, ...stations];
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

/** Where a photo item's bytes are (E1 review #1): a placed photo's image
 *  is a content path inside the tour's folder (`TourSession
 *  .loadContentEntry`), a recorded one's the archive's own entry name
 *  (`loadEntry`, as the viewer reads it); null without a photo. */
export function photoSource(
  item: EditorItem,
): { kind: "content" | "entry"; path: string } | null {
  if (item.kind !== "photo" || item.image === undefined) return null;
  return {
    kind: item.recorded === true ? "entry" : "content",
    path: item.image,
  };
}
