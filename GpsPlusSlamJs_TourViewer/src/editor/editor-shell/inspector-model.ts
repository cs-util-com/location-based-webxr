/**
 * The 3D view's inspector, as data (pure): the selected station's, item's
 * or code's fields, read-only, as the file holds them. The DOM is
 * `shell-inspector.ts`'s.
 *
 * - A station: its name, "Station n of N", its description and card
 *   picture, its found and preload radii, and where it stands: metres east
 *   and north of the tour's centre (the 3D view's origin,
 *   `tour-origin.ts`), its height over the ellipsoid and its heading.
 * - An item (pin, photo, 3D model): its name, its kind and station, a
 *   model's size, its offset in the station's frame and its heading
 *   there.
 * - A code: its name, its line, its print size and where it stands, in
 *   the same metres.
 *
 * @see inspector-model.ts.md
 */
import type {
  TourAsset,
  TourItem,
  TourStation,
} from "gps-plus-slam-app-framework/ar/tour-manifest";

import { stationTitle } from "../../station-run.js";
import { eastNorthOf, tourCentre } from "../tour-origin.js";
import { stationImagePath } from "./tree-model.js";

/** Where something stands: as the 3D view frames it, and as the file
 *  says its height and heading. */
export interface InspectorPosition {
  /** Metres east of the tour's centre (the 3D view's origin). */
  readonly eastM: number;
  /** Metres north of the tour's centre. */
  readonly northM: number;
  /** Over the ellipsoid (m), as the file writes heights. */
  readonly altM: number;
  /** Clockwise from north; null when the file gives none. */
  readonly headingDeg: number | null;
}

interface StationInspector {
  readonly kind: "station";
  readonly title: string;
  readonly sub: string;
  readonly description: string | null;
  readonly imagePath: string | null;
  readonly foundRadiusM: number;
  readonly activateRadiusM: number;
  /** Null for a station the file does not place. */
  readonly position: InspectorPosition | null;
}

interface ItemInspector {
  readonly kind: "item";
  readonly itemKind: TourItem["kind"];
  readonly title: string;
  readonly sub: string;
  /** A model's largest side (m); null for a pin or a photo. */
  readonly sizeM: number | null;
  /** In the station's frame (m). */
  readonly offset: {
    readonly northM: number;
    readonly upM: number;
    readonly eastM: number;
  };
  /** Relative to the station; null for a rotation that is no number. */
  readonly headingDeg: number | null;
}

interface CodeInspector {
  readonly kind: "code";
  readonly title: string;
  readonly sub: string;
  readonly printSizeM: number | null;
  /** Null for a code with no stored position, or one not placed. */
  readonly position: InspectorPosition | null;
}

export type InspectorModel = StationInspector | ItemInspector | CodeInspector;

/** A code as the inspector reads it. */
export interface InspectorCode {
  readonly id: string;
  readonly title: string;
  readonly meta: string;
  readonly geo: {
    readonly lat: number;
    readonly lon: number;
    readonly alt: number;
    readonly headingDeg?: number;
    readonly rotation?: readonly [number, number, number, number];
  } | null;
  readonly printSizeM: number | null;
}

const KIND_LABEL: Readonly<Record<TourItem["kind"], string>> = {
  pin: "Pin",
  photo: "Photo",
  model: "3D model",
};

/**
 * The bearing (degrees clockwise from north, 0-360) a rotation in a
 * north-up-east frame turns the frame's north axis to; null when the
 * rotation is not finite or turns north straight up or down.
 */
export function headingOfRotation(
  rotation: readonly [number, number, number, number] | readonly number[],
): number | null {
  const [x = 0, y = 0, z = 0, w = 1] = rotation;
  if (![x, y, z, w].every(Number.isFinite)) return null;
  // The north axis (1, 0, 0) turned: its north and east parts.
  const north = 1 - 2 * (y * y + z * z);
  const east = 2 * (x * z - w * y);
  if (Math.hypot(north, east) < 1e-9) return null;
  const deg = (Math.atan2(east, north) * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

function positionOf(
  geo: NonNullable<InspectorCode["geo"]>,
  origin: { readonly lat: number; readonly lng: number } | null,
): InspectorPosition | null {
  const at = origin === null ? null : eastNorthOf(geo, origin);
  if (at === null || !Number.isFinite(geo.alt)) return null;
  const heading =
    geo.headingDeg ??
    (geo.rotation === undefined ? null : headingOfRotation(geo.rotation));
  return { ...at, altM: geo.alt, headingDeg: heading };
}

function itemTitle(item: TourItem): string {
  if (item.kind === "pin") return item.label;
  const caption = item.label?.trim() ?? "";
  return caption === "" ? KIND_LABEL[item.kind] : caption;
}

/** The inspector for `selected` (the page's selection id), or null when
 *  nothing is selected or the tour does not have it. */
export function buildInspector(input: {
  readonly selected: string | null;
  readonly stations: readonly TourStation[];
  readonly assets: readonly TourAsset[];
  readonly codes: readonly InspectorCode[];
}): InspectorModel | null {
  const { selected, stations } = input;
  if (selected === null) return null;
  // The 3D view's origin: the same centre its frame is built on.
  const origin = tourCentre(
    stations,
    input.codes.flatMap((c) => (c.geo === null ? [] : [c.geo])),
  );
  if (selected.startsWith("station:")) {
    const id = selected.slice("station:".length);
    const index = stations.findIndex((s) => s.id === id);
    const station = stations[index];
    if (station === undefined) return null;
    const description = station.description?.trim() ?? "";
    return {
      kind: "station",
      title: stationTitle(station, index + 1),
      sub: `Station ${String(index + 1)} of ${String(stations.length)}`,
      description: description === "" ? null : description,
      imagePath: stationImagePath(station, input.assets),
      foundRadiusM: station.foundRadiusM,
      activateRadiusM: station.activateRadiusM,
      position: positionOf(station.geo, origin),
    };
  }
  for (const [index, station] of stations.entries()) {
    const item = station.items.find((i) => i.id === selected);
    if (item === undefined) continue;
    const [northM, upM, eastM] = item.pose.position;
    return {
      kind: "item",
      itemKind: item.kind,
      title: itemTitle(item),
      sub: `${KIND_LABEL[item.kind]} in ${stationTitle(station, index + 1)}`,
      sizeM: item.kind === "model" ? item.sizeM : null,
      offset: { northM, upM, eastM },
      headingDeg: headingOfRotation(item.pose.rotation),
    };
  }
  const code = input.codes.find((c) => c.id === selected);
  if (code === undefined) return null;
  return {
    kind: "code",
    title: code.title,
    sub: code.meta,
    printSizeM: code.printSizeM,
    position: code.geo === null ? null : positionOf(code.geo, origin),
  };
}
