/**
 * What the 3D editor shows, by two pure rules that run every frame:
 *
 * - the morph: pins and photos lie flat as the camera looks down and stand
 *   up as it tilts toward the horizon, by the camera's angle from straight
 *   down over a band of degrees (8-42);
 * - near-K: a station shows its items only when it is selected or one of
 *   the K (5) stations nearest to the camera's centre; every other station
 *   shows its billboard only, so a tour of a thousand stations stays cheap.
 *
 * @see editor3d-visibility.ts.md
 */
/**
 * The GLSL smooth step: 0 at `edge0` and below, 1 at `edge1` and above,
 * 3t^2 - 2t^3 between. The package's one copy (a one-liner may exist once
 * per package): the framework's `utils/smoothstep.ts` is no deep-import
 * entry of its build, and making it one would put every dependent of the
 * framework behind this package's change.
 */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** A band of camera tilt (degrees from straight down). */
export interface MorphBand {
  readonly fromDeg: number;
  readonly toDeg: number;
}

/** Flat at 8 degrees of tilt and below, upright at 42 and above. */
export const MORPH_BAND: MorphBand = Object.freeze({ fromDeg: 8, toDeg: 42 });

/** How many stations nearest to the camera's centre show their items. */
export const NEAR_STATIONS = 5;

/**
 * How upright pins and photos stand at a camera tilt of `tiltDeg` degrees
 * from straight down: 0 flat at `band.fromDeg` and below, 1 upright at
 * `band.toDeg` and above, a smooth step between (non-decreasing in the
 * tilt). RangeError for a tilt that is not finite or a band whose ends are
 * not finite with `fromDeg` < `toDeg`.
 */
export function morphStanding(
  tiltDeg: number,
  band: MorphBand = MORPH_BAND,
): number {
  const { fromDeg, toDeg } = band;
  if (!(
    Number.isFinite(fromDeg) &&
    Number.isFinite(toDeg) &&
    fromDeg < toDeg
  )) {
    throw new RangeError(
      `a morph band runs from a smaller to a larger finite angle, got ${fromDeg}-${toDeg}`,
    );
  }
  if (!Number.isFinite(tiltDeg)) {
    throw new RangeError(`the camera's tilt must be finite, got ${tiltDeg}`);
  }
  return smoothstep(fromDeg, toDeg, tiltDeg);
}

/** A station as the rule reads it: its id and where it stands (m, local). */
export interface StationSpot {
  readonly id: string;
  readonly east: number;
  readonly north: number;
}

/**
 * The ids of the stations that show their items: the `k` nearest to
 * `centre` (horizontal distance; a tie goes to the smaller id, so the set
 * does not depend on the list's order), plus `selected` when it is one of
 * `stations`. Nearest first, the selection last when it is not among them.
 * RangeError for a `k` that is not a whole number >= 0 or a centre that is
 * not finite.
 */
export function nearStations(
  stations: readonly StationSpot[],
  centre: { readonly east: number; readonly north: number },
  k: number = NEAR_STATIONS,
  selected: string | null = null,
): Set<string> {
  if (!(Number.isInteger(k) && k >= 0)) {
    throw new RangeError(
      `the station count must be a whole number >= 0, got ${k}`,
    );
  }
  if (!(Number.isFinite(centre.east) && Number.isFinite(centre.north))) {
    throw new RangeError(
      `the camera's centre must be finite, got ${centre.east}, ${centre.north}`,
    );
  }
  const ranked = stations
    .map((s) => {
      const d2 = (s.east - centre.east) ** 2 + (s.north - centre.north) ** 2;
      // A station that cannot be placed ranks last, never first.
      return { id: s.id, d2: Number.isFinite(d2) ? d2 : Infinity };
    })
    .sort((a, b) => a.d2 - b.d2 || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const shown = new Set(ranked.slice(0, k).map((s) => s.id));
  if (selected !== null && stations.some((s) => s.id === selected)) {
    shown.add(selected);
  }
  return shown;
}

/** A station's id in the desktop editor's selection (`editor-model.ts`). */
const STATION_SELECTION = "station:";

/**
 * The station the near-K rule must draw for the page's selection: the
 * selected station (`station:<id>`), or the station holding the selected
 * item; null for a code, an id the tour does not have, or no selection.
 */
export function selectedStationOf(
  selected: string | null,
  manifest: {
    readonly stations: readonly {
      readonly id: string;
      readonly items: readonly { readonly id: string }[];
    }[];
  } | null,
): string | null {
  if (selected === null || manifest === null) return null;
  if (selected.startsWith(STATION_SELECTION)) {
    const id = selected.slice(STATION_SELECTION.length);
    return manifest.stations.some((s) => s.id === id) ? id : null;
  }
  return (
    manifest.stations.find((s) => s.items.some((i) => i.id === selected))?.id ??
    null
  );
}
