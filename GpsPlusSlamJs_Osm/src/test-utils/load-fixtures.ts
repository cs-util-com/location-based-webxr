/**
 * Loads the checked-in Overpass fixtures.
 *
 * Read from disk with `readFileSync` rather than `import ... from './x.json'`
 * for the same reason `polygon-features.ts` is a module: JSON imports in an ESM
 * package need import attributes, which need `module: nodenext`. These files are
 * test-only and always run in Node, so `readFileSync` is both simpler and
 * avoids adding a compiler-option constraint for the sake of test data.
 *
 * @see ../testdata/README.md for provenance and the capture command.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { OsmFixture } from "../source/fixture-source.js";

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "testdata",
);

/**
 * The six-site corpus (W2, DEC-R4-1/R4-2), in its own directory.
 *
 * SEPARATE FROM THE FOUR everyday fixtures on purpose. They answer different
 * questions and have different contents: the four are unfiltered captures the
 * indexing and scoring tests assert exact counts against, and the six are
 * filtered (non-areal relations dropped — see `scripts/capture-fixtures.mjs`)
 * and exist to give geometry a place to be wrong other than Cologne. Mixing
 * them would silently change the counts the four are pinned to, because
 * `loadAllFixtures` enumerates its directory.
 */
const SITES_DIR = join(FIXTURE_DIR, "sites");

/** The provenance recorded alongside each captured payload. */
export interface CapturedFixture extends OsmFixture {
  readonly label: string;
  readonly centre: { readonly lat: number; readonly lng: number };
  readonly bbox: {
    readonly south: number;
    readonly west: number;
    readonly north: number;
    readonly east: number;
  };
  readonly query: string;
  readonly capturedFrom: string;
  readonly rawBytes: number;
  readonly elementCount: number;
  /** The census that gates the plan's §8 3D work. */
  readonly s3dbCensus: {
    readonly buildings: number;
    readonly parts: number;
    readonly pitchedRoofs: number;
    readonly withHeight: number;
  };
  readonly regenerateWith: string;
}

export function loadFixture(slug: string): CapturedFixture {
  const raw = readFileSync(join(FIXTURE_DIR, `${slug}.json`), "utf8");
  return JSON.parse(raw) as CapturedFixture;
}

export function loadAllFixtures(): CapturedFixture[] {
  return readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => loadFixture(name.replace(/\.json$/, "")));
}

/** Slugs, so tests can `it.each` over them without hardcoding the list. */
export const FIXTURE_SLUGS = [
  "park",
  "street-corner",
  "beach",
  "building-block",
] as const;
/**
 * A captured site extract — a fixture plus the two things the filter adds.
 *
 * Both fields are REQUIRED here and absent on the four legacy fixtures, which
 * is the type saying out loud that a site extract is a different artefact: it
 * knows the resolution it was cut at, and it knows how much it threw away.
 */
export interface CapturedSite extends CapturedFixture {
  /** H3 resolution of the captured tile; per site, see `places/sites.ts`. */
  readonly captureRes: number;
  /** Relations dropped as non-areal. See `scripts/capture-fixtures.mjs`. */
  readonly droppedNonArealRelations: number;
}

/**
 * One site extract by its `CorpusSite.id`.
 *
 * Throws — unlike `siteById`, which returns `undefined`. A missing extract is a
 * broken checkout or a site added to the table without being captured, and both
 * are developer errors that should stop a test run loudly rather than let it
 * silently assert over five sites while believing it covered six.
 */
export function loadSite(id: string): CapturedSite {
  const raw = readFileSync(join(SITES_DIR, `${id}.json`), "utf8");
  return JSON.parse(raw) as CapturedSite;
}
