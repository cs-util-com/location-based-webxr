/**
 * The tour's origin, pure: the middle of the tour that the 3D view
 * centres its frame and its first orbit on (`tourCentre`), and where a
 * point stands as metres east and north of it (`eastNorthOf`), as that
 * frame draws it: the east-north-up plane touching the WGS84 ellipsoid at
 * the origin. The inspector says a station's place in these metres, so
 * the number it shows is where the 3D view draws the station, and a
 * place typed there in metres is found back by `placeAtEastNorth`.
 *
 * @see tour-origin.ts.md
 */

/** A point of the tour as the centre reads it (degrees, ellipsoidal m). */
interface GeoPoint {
  readonly lat: number;
  readonly lon: number;
  readonly alt: number;
}

/**
 * The tour's centre for the 3D view's frame and first orbit: the mean
 * latitude, longitude and height of its stations, or of its codes when it
 * has no station; null with neither. A point with a coordinate that is not
 * finite is left out. (A tour spans a few hundred metres: the plain mean
 * of degrees is the centre to well under a metre there.)
 */
export function tourCentre(
  stations: readonly { readonly geo: GeoPoint }[],
  codes: readonly GeoPoint[],
): { lat: number; lng: number; altM: number } | null {
  const placed = (points: readonly GeoPoint[]) =>
    points.filter(
      (p) =>
        Number.isFinite(p.lat) &&
        Number.isFinite(p.lon) &&
        Number.isFinite(p.alt),
    );
  const fromStations = placed(stations.map((s) => s.geo));
  const points = fromStations.length > 0 ? fromStations : placed(codes);
  if (points.length === 0) return null;
  const mean = (pick: (p: GeoPoint) => number) =>
    points.reduce((sum, p) => sum + pick(p), 0) / points.length;
  return {
    lat: mean((p) => p.lat),
    lng: mean((p) => p.lon),
    altM: mean((p) => p.alt),
  };
}

/** WGS84: the semi-major axis (m) and the first eccentricity squared. */
const WGS84_A = 6_378_137;
const WGS84_E2 = (1 / 298.257223563) * (2 - 1 / 298.257223563);
const DEG = Math.PI / 180;

/** A place on the ellipsoid (height 0) in earth-centred metres. */
function ecef(latDeg: number, lonDeg: number): [number, number, number] {
  const phi = latDeg * DEG;
  const lambda = lonDeg * DEG;
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * Math.sin(phi) ** 2);
  return [
    n * Math.cos(phi) * Math.cos(lambda),
    n * Math.cos(phi) * Math.sin(lambda),
    n * (1 - WGS84_E2) * Math.sin(phi),
  ];
}

function isPlace(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lon);
}

/**
 * Where `point` stands, in metres east and north of `origin`, both on the
 * ellipsoid: exactly the east and north axes of the plane touching the
 * ellipsoid at the origin, which is the 3D view's frame. Null when either
 * is not a place (a coordinate not finite, a latitude past a pole).
 */
export function eastNorthOf(
  point: { readonly lat: number; readonly lon: number },
  origin: { readonly lat: number; readonly lng: number },
): { eastM: number; northM: number } | null {
  if (!isPlace(point.lat, point.lon) || !isPlace(origin.lat, origin.lng)) {
    return null;
  }
  const [px, py, pz] = ecef(point.lat, point.lon);
  const [ox, oy, oz] = ecef(origin.lat, origin.lng);
  const [dx, dy, dz] = [px - ox, py - oy, pz - oz];
  const phi = origin.lat * DEG;
  const lambda = origin.lng * DEG;
  return {
    eastM: -Math.sin(lambda) * dx + Math.cos(lambda) * dy,
    northM:
      -Math.sin(phi) * Math.cos(lambda) * dx -
      Math.sin(phi) * Math.sin(lambda) * dy +
      Math.cos(phi) * dz,
  };
}

/** Metres per degree of latitude and of longitude at `latDeg` on the
 *  ellipsoid (the meridian's and the parallel's radii of curvature). */
function metresPerDegree(latDeg: number): { lat: number; lon: number } {
  const s = Math.sin(latDeg * DEG);
  const w = Math.sqrt(1 - WGS84_E2 * s * s);
  const meridian = (WGS84_A * (1 - WGS84_E2)) / (w * w * w);
  const normal = WGS84_A / w;
  return {
    lat: meridian * DEG,
    lon: Math.max(1e-9, normal * Math.cos(latDeg * DEG) * DEG),
  };
}

/**
 * The place (degrees) that stands `at.eastM` east and `at.northM` north of
 * `origin` as `eastNorthOf` measures it: its inverse, to well under a
 * millimetre over a tour's reach (a few Newton steps on the local
 * metres per degree). Null when the metres are not finite or the origin
 * is not a place.
 */
export function placeAtEastNorth(
  at: { readonly eastM: number; readonly northM: number },
  origin: { readonly lat: number; readonly lng: number },
): { lat: number; lon: number } | null {
  if (
    !Number.isFinite(at.eastM) ||
    !Number.isFinite(at.northM) ||
    !isPlace(origin.lat, origin.lng)
  ) {
    return null;
  }
  let place = { lat: origin.lat, lon: origin.lng };
  for (let step = 0; step < 6; step += 1) {
    const now = eastNorthOf(place, origin);
    if (now === null) return null;
    const missE = at.eastM - now.eastM;
    const missN = at.northM - now.northM;
    if (Math.abs(missE) < 1e-6 && Math.abs(missN) < 1e-6) break;
    const scale = metresPerDegree(place.lat);
    place = {
      lat: place.lat + missN / scale.lat,
      lon: place.lon + missE / scale.lon,
    };
  }
  return isPlace(place.lat, place.lon) ? place : null;
}
