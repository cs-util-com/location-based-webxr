/**
 * Test-only relocation of a tour's stations to the phone's position (owner
 * decision S-D9, 2026-10-05): the sample tour sits at a public place, and
 * `?relocate=here` moves every station with a geo pose so that the first one
 * stands a few metres north of the phone's first GPS fix, keeping the
 * stations' layout (distances, relative heights, headings). Stations
 * anchored only to a printed code stay where the code is.
 *
 * Nothing about the phone's position is stored or sent: the move happens in
 * memory, for the open tour only.
 */
import type { TourStation } from "gps-plus-slam-app-framework/ar/tour-stations";

/** How far north of the phone the first moved station stands, metres. */
export const RELOCATE_LEAD_NORTH_M = 15;

/** Metres per degree of latitude (and of longitude at the equator). */
const M_PER_DEG = 111_320;

/** A geographic point with an absolute altitude in metres. */
export interface RelocationTarget {
  readonly lat: number;
  readonly lon: number;
  readonly alt: number;
}

/** Whether the page was opened with the test switch `?relocate=here`. */
export function relocationRequested(search: string): boolean {
  return new URLSearchParams(search).get("relocate") === "here";
}

/**
 * The stations moved so the first station with a geo pose stands
 * {@link RELOCATE_LEAD_NORTH_M} north of `target`, at the target's altitude;
 * every other geo station keeps its north/east/up offset from that first
 * one. Code-only stations are returned as they are. Offsets are taken on a
 * local flat earth at the first station, which holds to about 1 % over the
 * few hundred metres a tour spans.
 */
export function relocateStations(
  stations: readonly TourStation[],
  target: RelocationTarget,
): TourStation[] {
  const origin = stations.find((s) => s.anchor.geo !== undefined)?.anchor.geo;
  if (origin === undefined) return [...stations];
  const cosOrigin = Math.cos(origin.lat * (Math.PI / 180));
  const firstLat = target.lat + RELOCATE_LEAD_NORTH_M / M_PER_DEG;
  const cosFirst = Math.cos(firstLat * (Math.PI / 180));
  return stations.map((station) => {
    const geo = station.anchor.geo;
    if (geo === undefined) return station;
    const northM = (geo.lat - origin.lat) * M_PER_DEG;
    const eastM = (geo.lon - origin.lon) * M_PER_DEG * cosOrigin;
    const upM = geo.alt - origin.alt;
    return {
      ...station,
      anchor: {
        ...station.anchor,
        geo: {
          ...geo,
          lat: firstLat + northM / M_PER_DEG,
          lon: target.lon + eastM / (M_PER_DEG * cosFirst),
          // A fix without an altitude keeps the stations' own heights.
          alt: Number.isFinite(target.alt) ? target.alt + upM : geo.alt,
        },
      },
    };
  });
}

/**
 * Applies {@link relocateStations} for an open page: off, the stations pass
 * through unchanged; on, they are held back (`null`) until the first fix,
 * which is then kept as the target, so a later fix never drags the tour
 * along with the visitor. `onRelocated` is told once, with that fix. The
 * same stations list gives back the same moved list, since the guide reads
 * the tour every frame.
 */
export function createStationRelocator(
  enabled: boolean,
  onRelocated?: (target: RelocationTarget) => void,
): (
  stations: readonly TourStation[],
  fix: RelocationTarget | null,
) => readonly TourStation[] | null {
  let target: RelocationTarget | null = null;
  let lastInput: readonly TourStation[] | null = null;
  let lastOutput: readonly TourStation[] = [];
  return (stations, fix) => {
    if (!enabled) return stations;
    if (target === null) {
      if (fix === null) return null;
      target = { lat: fix.lat, lon: fix.lon, alt: fix.alt };
      onRelocated?.(target);
    }
    if (stations !== lastInput) {
      lastInput = stations;
      lastOutput = relocateStations(stations, target);
    }
    return lastOutput;
  };
}
