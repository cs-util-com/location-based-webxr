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
