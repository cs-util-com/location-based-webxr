/**
 * The heights the globe's city stands on: the relief's own source at the
 * relief's zoom (globe city plan 2026-10-05-0040 §12.4 R13), so the city and
 * the relief read the same numbers. Since G1 (tour editor plan
 * 2026-10-17-1816 §13, step 1d) the source is the relief's, passed in the
 * load message, rather than a template fixed in the worker: with the
 * Mapterhorn relief the city still stood on AWS heights, up to 12 m apart
 * in towns (the G0 spikes).
 *
 * Pure, no imports: the lab's city worker loads it through the worker view
 * (`/w/globe/`), and `globe-city.ts` checks a template with it. Moved out of
 * the globe lab as a pure refactor (editor-on-the-full-globe plan, the
 * city slice).
 *
 * @see globe-city-heights.ts.md
 */

/** The zooms a city's heights may be read at (the Osm library's reader). */
export const CITY_HEIGHTS_ZOOM = Object.freeze({ min: 1, max: 15 });

/** The Osm library's heights spec for `cityDataPlan`. */
export interface CityHeightsSpec {
  urlTemplates: string[];
  zoom: number;
}

/**
 * The library's heights spec for a city: `{ urlTemplates: [url], zoom }`.
 * RangeError for a zoom that is not an integer 1-15 or a url that is not
 * a `{z}`/`{x}`/`{y}` template.
 */
export function cityHeights(zoom: number, url: string): CityHeightsSpec {
  if (!(
    Number.isInteger(zoom) &&
    zoom >= CITY_HEIGHTS_ZOOM.min &&
    zoom <= CITY_HEIGHTS_ZOOM.max
  )) {
    throw new RangeError(`a city needs the relief's zoom (1-15), got ${zoom}`);
  }
  if (
    typeof url !== "string" ||
    !url.includes("{z}") ||
    !url.includes("{x}") ||
    !url.includes("{y}")
  ) {
    throw new RangeError(
      `a city needs the relief's {z}/{x}/{y} height template, got ${String(url)}`,
    );
  }
  return { urlTemplates: [url], zoom };
}
