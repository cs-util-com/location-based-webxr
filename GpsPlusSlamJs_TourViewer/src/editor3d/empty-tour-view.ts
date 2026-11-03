/**
 * Where the editor on the globe opens a tour that has nothing with a
 * position yet (a new tour, or one of notes alone): the whole Earth,
 * looking straight down over the creator's own part of the world. The
 * browser's time zone is the one hint a page has without asking for the
 * location: its standard offset gives the longitude, and its name (an IANA
 * zone such as "Europe/Oslo") the latitude, by the zone's region. Without
 * a name that names a region the latitude is 10 degrees north: low enough
 * that the far south (Sydney, Auckland, Buenos Aires) lies inside the start
 * height's horizon as the far north (Oslo) does. From there the creator
 * flies down and places the first station on the ground.
 *
 * Pure, but for `browserZoneHint`'s defaults (the engine's clock and
 * `Intl`): no globe, no three.
 *
 * @see empty-tour-view.ts.md
 */

import type { GlobeViewPose } from "gps-plus-slam-globe/view";

/** The empty tour's view: its latitude without a zone's region and how far
 *  from straight down it looks (deg; straight down has no heading to keep). */
export const EMPTY_TOUR_VIEW = Object.freeze({
  lat: 10,
  pitchDeg: -89,
});

/**
 * A rough latitude (deg) per zone region, the first part of an IANA name:
 * where most of the region's people live, not its middle. A zone spans
 * about 15 degrees of longitude; this only needs to put the creator's home
 * inside the first view (the start height sees about 47 degrees of arc
 * either way on a landscape screen), not near its centre.
 */
const REGION_LAT: Readonly<Record<string, number>> = Object.freeze({
  Europe: 50,
  Asia: 30,
  Africa: 5,
  America: 40,
  Australia: -28,
  Pacific: 15,
  Atlantic: 40,
  Indian: -12,
  Antarctica: -75,
  Arctic: 78,
});

/** The southern places of regions that straddle the equator, by the rest
 *  of their names (the older aliases a browser may still report too). */
const SOUTH: Readonly<Record<string, { lat: number; names: Set<string> }>> =
  Object.freeze({
    America: {
      lat: -20,
      names: new Set([
        "Araguaina",
        "Argentina",
        "Asuncion",
        "Bahia",
        "Belem",
        "Boa_Vista",
        "Bogota",
        "Buenos_Aires",
        "Campo_Grande",
        "Caracas",
        "Catamarca",
        "Cayenne",
        "Cordoba",
        "Cuiaba",
        "Eirunepe",
        "Fortaleza",
        "Guayaquil",
        "Guyana",
        "Jujuy",
        "La_Paz",
        "Lima",
        "Maceio",
        "Manaus",
        "Mendoza",
        "Montevideo",
        "Noronha",
        "Paramaribo",
        "Porto_Velho",
        "Punta_Arenas",
        "Recife",
        "Rio_Branco",
        "Rosario",
        "Santarem",
        "Santiago",
        "Sao_Paulo",
      ]),
    },
    Africa: {
      lat: -22,
      names: new Set([
        "Blantyre",
        "Gaborone",
        "Harare",
        "Johannesburg",
        "Lubumbashi",
        "Lusaka",
        "Maputo",
        "Maseru",
        "Mbabane",
        "Windhoek",
      ]),
    },
    Pacific: {
      lat: -25,
      names: new Set([
        "Apia",
        "Auckland",
        "Chatham",
        "Easter",
        "Efate",
        "Fakaofo",
        "Fiji",
        "Funafuti",
        "Gambier",
        "Guadalcanal",
        "Marquesas",
        "Niue",
        "Norfolk",
        "Noumea",
        "Pago_Pago",
        "Pitcairn",
        "Rarotonga",
        "Tahiti",
        "Tongatapu",
        "Wallis",
      ]),
    },
    Atlantic: {
      lat: -40,
      names: new Set(["South_Georgia", "St_Helena", "Stanley"]),
    },
  });

/**
 * The rough latitude (deg) of an IANA time zone's region, or `undefined`
 * for a name that names none ("UTC", "Etc/GMT+5", an unknown or empty
 * string, `undefined`). Every part after the region is checked against
 * the region's southern places, so "America/Argentina/Buenos_Aires" (the
 * folder names the country) and the older "America/Buenos_Aires" both read
 * as South America.
 */
export function zoneLatitude(timeZone: string | undefined): number | undefined {
  if (typeof timeZone !== "string") return undefined;
  const [region = "", ...rest] = timeZone.split("/");
  if (!Object.hasOwn(REGION_LAT, region) || rest.length === 0) {
    return undefined;
  }
  const south = Object.hasOwn(SOUTH, region) ? SOUTH[region] : undefined;
  if (south !== undefined && rest.some((part) => south.names.has(part))) {
    return south.lat;
  }
  return REGION_LAT[region];
}

/** A longitude (deg) brought into -180..180 (180 itself reads as -180). */
function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/**
 * The empty tour's centre from the browser's time-zone offset
 * (`Date.prototype.getTimezoneOffset()`: minutes, positive WEST of
 * Greenwich; best the standard one, `browserZoneHint`) and its zone's
 * name: 15 degrees of longitude an hour, wrapped into -180..180, at the
 * zone's region's latitude (`zoneLatitude`, else `EMPTY_TOUR_VIEW.lat`),
 * on the ellipsoid. An offset that is not a finite number reads as
 * Greenwich.
 */
export function emptyTourCentre(
  timezoneOffsetMin: number,
  timeZone?: string,
): {
  lat: number;
  lng: number;
  altM: number;
} {
  const lng = Number.isFinite(timezoneOffsetMin)
    ? wrapLng(-timezoneOffsetMin / 4)
    : 0;
  const lat = zoneLatitude(timeZone) ?? EMPTY_TOUR_VIEW.lat;
  // `+ 0` turns a -0 (offset 0) into 0.
  return { lat, lng: lng + 0, altM: 0 };
}

/** Where `browserZoneHint` reads the engine's zone (injected in tests). */
export interface ZoneSource {
  /** `getTimezoneOffset()` on the 1st of `month` (0-11) this year. */
  offsetInMonth(month: number): number;
  /** The zone's IANA name (may throw, or be empty). */
  timeZone(): string;
}

const ENGINE_ZONE: ZoneSource = {
  offsetInMonth: (month) =>
    new Date(new Date().getFullYear(), month, 1).getTimezoneOffset(),
  timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
};

/**
 * The browser's time zone as `emptyTourCentre` takes it: the STANDARD
 * offset (the larger of January's and July's: summer time is the smaller,
 * in either hemisphere, and would move the view 15 degrees east for half
 * the year) and the zone's name, `undefined` where the engine cannot say
 * it (an empty name, or `Intl` throwing).
 */
export function browserZoneHint(source: ZoneSource = ENGINE_ZONE): {
  offsetMin: number;
  timeZone: string | undefined;
} {
  const offsetMin = Math.max(source.offsetInMonth(0), source.offsetInMonth(6));
  let timeZone: string | undefined;
  try {
    const name = source.timeZone();
    timeZone = typeof name === "string" && name !== "" ? name : undefined;
  } catch {
    timeZone = undefined;
  }
  return { offsetMin, timeZone };
}

/**
 * The view down at `centre` from `altitudeKm` (the editor's approach
 * start height: the whole Earth in its lens). Throws a RangeError for a
 * place that is not finite or a height that is not a positive finite
 * number.
 */
export function emptyTourView(
  centre: { readonly lat: number; readonly lng: number },
  altitudeKm: number,
): GlobeViewPose {
  const { lat, lng } = centre;
  if (![lat, lng, altitudeKm].every(Number.isFinite) || !(altitudeKm > 0)) {
    throw new RangeError(
      `an empty tour's view needs a finite place and a positive height, got ${String(lat)},${String(lng)},${String(altitudeKm)}`,
    );
  }
  return {
    lat,
    lng,
    altitudeKm,
    headingDeg: 0,
    pitchDeg: EMPTY_TOUR_VIEW.pitchDeg,
  };
}
