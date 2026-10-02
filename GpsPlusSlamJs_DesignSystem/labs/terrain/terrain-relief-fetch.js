/**
 * The relief region's height tiles, fetched on the page's thread (terrain
 * plan 2026-09-27-0605 §9 finding 4: a worker's requests are outside the
 * smokes' routing). One implementation for the terrain lab and the globe
 * lab's detail region (DEC-H3).
 *
 * @see terrain-relief-fetch.js.md
 */

/** A tile request that never answers must not stall a page forever. */
export const TILE_TIMEOUT_MS = 30_000;

/**
 * Fetches every tile (`{ z, x, y }`) from `urlTemplate` (`{z}`, `{x}`,
 * `{y}`), each bounded by `TILE_TIMEOUT_MS`; a failure is a gap
 * (`bytes: null`), never a thrown batch. `onProgress(done)` after each.
 *
 * @param {{ z: number, x: number, y: number }[]} tiles
 * @param {string} urlTemplate
 * @param {(done: number) => void} [onProgress]
 * @returns {Promise<{ z: number, x: number, y: number, url: string,
 *   bytes: ArrayBuffer | null }[]>}
 */
export async function fetchTerrariumTiles(
  tiles,
  urlTemplate,
  onProgress = () => {},
) {
  let done = 0;
  return Promise.all(
    tiles.map(async (t) => {
      const url = urlTemplate
        .replace("{z}", String(t.z))
        .replace("{x}", String(t.x))
        .replace("{y}", String(t.y));
      let bytes = null;
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(TILE_TIMEOUT_MS),
        });
        if (response.ok) bytes = await response.arrayBuffer();
      } catch {
        bytes = null;
      }
      done += 1;
      onProgress(done);
      return { ...t, url, bytes };
    }),
  );
}
