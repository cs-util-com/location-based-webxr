/**
 * The OpenStreetMap raster basemap: its tile URL, its attribution, its ceiling.
 *
 * ONE HOME, because these three are a CONTRACT with the tile operator rather
 * than three strings. The attribution is required by the OSM tile usage policy,
 * the zoom ceiling is the highest level tiles actually exist at, and the URL
 * decides which endpoint the load lands on. A second copy is a second chance to
 * get one of those wrong, which is not hypothetical here — see below.
 *
 * @see osm-tiles.ts.md
 */

/**
 * The raster tile template, WITHOUT subdomain sharding.
 *
 * **NOT `https://{s}.tile.openstreetmap.org/…`, and the difference is the
 * reason this module exists.** Sharding across `a/b/c` was a workaround for
 * HTTP/1.1's per-host connection limit; under HTTP/2 a single connection
 * multiplexes, so the shards buy nothing and the OSM tile usage policy
 * discourages them. Two of the repo's three copies had already moved to this
 * form and the recorder's had not, so the apps were quietly asking for tiles
 * two different ways with nothing able to notice.
 */
export const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/**
 * The credit the OSM tile usage policy requires.
 *
 * HTML rather than text because Leaflet's attribution control renders it as
 * markup, and the policy asks for a LINK to the copyright page rather than a
 * bare mention. A consumer that renders its own attribution (the OSM demo does,
 * through its own control) still owes the same credit — the obligation follows
 * the tiles, not the widget.
 */
export const OSM_TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/**
 * The highest zoom level OSM raster tiles exist at.
 *
 * Past it the server has nothing to serve, so Leaflet upscales the last real
 * level and the map goes soft rather than failing — which is why a wrong value
 * here reads as a rendering nit instead of as a bug.
 */
export const OSM_TILE_MAX_ZOOM = 19;
