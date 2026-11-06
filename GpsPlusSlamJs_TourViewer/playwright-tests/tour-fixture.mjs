// @ts-check
/**
 * Version 5 `tour.json` stations for the e2e fixtures: stations at geo
 * poses, their pins and photos as free blocks at local poses, their
 * stories holding their own card or stage blocks. One place, so the
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
 * A station anchored at `geo`, turned like north, holding `children`
 * (free blocks and stories).
 * @param {string} id
 * @param {{ lat: number, lon: number, alt: number }} geo
 * @param {object[]} [children]
 */
export function stationAt(id, geo, children = []) {
  return {
    id,
    geo: { lat: geo.lat, lon: geo.lon, alt: geo.alt, rotation: [0, 0, 0, 1] },
    activateRadiusM: 50,
    foundRadiusM: 25,
    hint: "arrow",
    children,
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
 * `block` as a story's child: it moves on by a tap unless `fields` say
 * otherwise.
 * @param {Record<string, unknown>} block
 * @param {Record<string, unknown>} [fields] more story fields (an advance)
 */
export function told(block, fields = {}) {
  return { ...block, advance: { mode: "tap" }, ...fields };
}

/**
 * A story of `children` (its blocks, choices and quizzes, in the order a
 * visitor meets them).
 * @param {string} id
 * @param {object[]} children
 */
export function storyOf(id, children) {
  return { id, kind: "story", title: "A story", children };
}

/**
 * Every block of a station read back from a saved tour: its stories'
 * blocks and its free ones, in the order of its children.
 * @param {any} station
 * @returns {any[]}
 */
export function stationBlocks(station) {
  return station.children.flatMap((/** @type {any} */ child) =>
    child.kind === "story"
      ? child.children.filter(
          (/** @type {any} */ c) => c.kind !== "choice" && c.kind !== "quiz",
        )
      : [child],
  );
}
