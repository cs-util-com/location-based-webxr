// @ts-check
/**
 * Version 4 `tour.json` stations for the e2e fixtures: stations at geo
 * poses, their pins and photos as free blocks at local poses, their
 * stories as card or stage blocks shown by steps. One place, so the
 * archive server and the specs that build tours of their own write the
 * same shape.
 *
 * Each station helper anchors the station EXACTLY where its element stands
 * and turns it like north, so the element's local pose is a zero offset and
 * its world pose reads back with the fixture's own numbers.
 */

/** A zero local pose: the block stands at its station's anchor. */
export const ZERO_POSE = Object.freeze({
  position: [0, 0, 0],
  rotation: [0, 0, 0, 1],
});

/**
 * A station anchored at `geo`, turned like north, holding `blocks` and no
 * story.
 * @param {string} id
 * @param {{ lat: number, lon: number, alt: number }} geo
 * @param {object[]} [blocks]
 */
export function stationAt(id, geo, blocks = []) {
  return {
    id,
    geo: { lat: geo.lat, lon: geo.lon, alt: geo.alt, rotation: [0, 0, 0, 1] },
    activateRadiusM: 50,
    foundRadiusM: 25,
    hint: "arrow",
    blocks,
    steps: [],
  };
}

/**
 * `object` (a pin or picture block as the world sees it, with a `geo`) as
 * the only block of a station of its own, `st-<id>`.
 * @param {{ id: string, geo: { lat: number, lon: number, alt: number } } & Record<string, unknown>} object
 */
export function inOwnStation({ geo, ...fields }) {
  return stationAt(`st-${fields.id}`, geo, [{ ...fields, pose: ZERO_POSE }]);
}

/**
 * A captured photo: a picture block in the world whose image asset carries
 * its own id, one metre wide.
 * @param {string} id
 * @param {Record<string, unknown>} [fields] more block fields (a pose, a caption)
 */
export function capturedPhoto(id, fields = {}) {
  return {
    id,
    kind: "picture",
    view: "plane",
    image: id,
    widthM: 1,
    pose: ZERO_POSE,
    ...fields,
  };
}

/**
 * The image asset of a picture: `path` in the zip, its pixel size.
 * @param {string} id
 * @param {string} path
 * @param {number} width
 * @param {number} height
 */
export function imageAsset(id, path, width, height) {
  return { id, path, width, height };
}

/**
 * A pin: a short text in the world.
 * @param {string} id
 * @param {string} caption
 * @param {Record<string, unknown>} [fields] more block fields (a pose, a date)
 */
export function pinBlock(id, caption, fields = {}) {
  return {
    id,
    kind: "shortText",
    view: "pin",
    caption,
    pose: ZERO_POSE,
    ...fields,
  };
}

/**
 * A story line: a long text shown in the card, titled `title`.
 * @param {string} id
 * @param {string} title
 * @param {string} body
 */
export function textCard(id, title, body) {
  return { id, kind: "longText", view: "card", title, body, pose: ZERO_POSE };
}

/**
 * A step that shows `block`.
 * @param {string} id
 * @param {string} block
 * @param {Record<string, unknown>} [fields] more step fields (an advance)
 */
export function showStep(id, block, fields = {}) {
  return {
    id,
    action: { kind: "show", block },
    advance: { mode: "tap" },
    ...fields,
  };
}
