/**
 * THE RING SHADOW's sizes: the look-dev page shadows its whole dense city
 * with two maps. The sun keeps its sharp central map; a second
 * DirectionalLight with NO intensity carries a coarse map over the whole
 * ring, re-rendered only when the sun or the city changes.
 *
 * The shader side, which makes the sun read its central map inside that
 * map's frustum and the ring map outside it, is the framework's
 * `two-map-shadow.ts` (`withTwoMapShadow`), which the page installs once at
 * load. It is inert unless two directional shadows exist, and then it
 * assumes shadow 0 is the sun and shadow 1 the ring: three orders
 * shadow-casting lights by scene traversal, so the page adds the ring light
 * after the sun, under the same parent.
 *
 * THE CENTRAL MAP MUST HOLD THE WHOLE CITY'S CASTERS: receivers inside its
 * frustum read only it, so the page stands its camera beyond the ring
 * (`distanceM`); at the rig's default R + 30 m a low sun's long shadows from
 * the dense city had a hole across the centre.
 *
 * @see ring-shadow.js.md
 */

/** The ring map's half width (m): the dense city stops at 2350 m. */
export const RING_HALF_WIDTH_M = 2450;
/** The ring map's size: 2.4 m texels (1024 read the same far, at 4.8 m). */
export const RING_MAP_SIZE = 2048;
