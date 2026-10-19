// @ts-check
/**
 * Version 3 `tour.json` stations for the e2e fixtures (tour editor plan
 * 2026-10-17-1816, W3): stations at geo poses, pins and photos as their
 * items at local poses. One place, so the archive server and the specs
 * that build tours of their own write the same shape.
 *
 * Each helper anchors the station EXACTLY where its element stands and
 * turns it like north, so the element's local pose is a zero offset and
 * its world pose reads back with the fixture's own numbers.
 */

/**
 * A station anchored at `geo`, turned like north, holding `items`.
 * @param {string} id
 * @param {{ lat: number, lon: number, alt: number }} geo
 * @param {object[]} [items]
 */
export function stationAt(id, geo, items = []) {
  return {
    id,
    geo: { lat: geo.lat, lon: geo.lon, alt: geo.alt, rotation: [0, 0, 0, 1] },
    activateRadiusM: 50,
    foundRadiusM: 25,
    hint: "arrow",
    steps: [],
    items,
  };
}

/**
 * `object` (a pin or photo as the world sees it, with a `geo`) as the only
 * item of a station of its own, `st-<id>`.
 * @param {{ id: string, geo: { lat: number, lon: number, alt: number } } & Record<string, unknown>} object
 */
export function inOwnStation({ geo, ...fields }) {
  return stationAt(`st-${fields.id}`, geo, [
    { ...fields, pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] } },
  ]);
}
