/**
 * The manifest of stored tiles, read from the tiles themselves: an R2
 * listing of the tile prefix with each tile's data timestamp and stored
 * size. Nothing writes a manifest, so nothing can fall out of step with
 * the store, and a fill pays no CPU for it.
 *
 * @see manifest.ts.md
 */

import type { TileBucket } from "./bindings";
import { parseTileCell, TILE_PREFIX } from "./tile-cell";

/** The manifest's URL path. */
export const MANIFEST_PATH = `/${TILE_PREFIX}manifest.tsv`;

const HEADER =
  "# Data (c) OpenStreetMap contributors, ODbL 1.0: https://www.openstreetmap.org/copyright\n" +
  "# cell\tosm_base\tstored_bytes\n";

/** At most this many listing pages (a thousand tiles each) per manifest. */
const MAX_PAGES = 100;

function cellOfKey(key: string): string | undefined {
  if (!key.startsWith(TILE_PREFIX) || !key.endsWith(".json.gz")) {
    return undefined;
  }
  return parseTileCell(key.slice(TILE_PREFIX.length, -".json.gz".length));
}

/** The manifest: two `#` lines, then `cell<TAB>osmBase<TAB>storedBytes` per tile. */
export async function manifestText(bucket: TileBucket): Promise<string> {
  const lines: string[] = [HEADER];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const listing = await bucket.list({
      prefix: TILE_PREFIX,
      include: ["customMetadata"],
      ...(cursor === undefined ? {} : { cursor }),
    });
    for (const object of listing.objects) {
      const cell = cellOfKey(object.key);
      if (cell === undefined) continue;
      const osmBase = object.customMetadata?.["osmBase"] ?? "";
      lines.push(`${cell}\t${osmBase}\t${object.size}\n`);
    }
    if (!listing.truncated || listing.cursor === undefined) break;
    cursor = listing.cursor;
  }
  return lines.join("");
}
