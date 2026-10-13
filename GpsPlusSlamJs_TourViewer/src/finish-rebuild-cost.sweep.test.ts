/**
 * What a Finish's zip rebuild costs, by archive size (polish round M3,
 * Q-Save: "the rebuild cost is measured, and a background save is added
 * only if it is cheap enough"; the owner's B7 asked for a save every
 * 15-30 s off the main thread if the final one is slow).
 *
 * WHAT IS MEASURED. `rebuildZipWithEntries`, the call the Finish makes
 * (`creator-finish.ts`), on a stored zip of 10 / 50 / 200 MB made of 2 MB
 * entries (photos and a recording's frames are that kind of file), adding
 * what a Finish adds: a manifest and three 1.5 MB photos. Three runs per
 * size; the median is reported. Node on the dev machine, so the PHONE is a
 * projection, not a measurement - see the verdict in the polish-round plan
 * ("Q-Save measured").
 *
 * Opt-in (`TOUR_REBUILD_COST=1`): building 200 MB of input per run is too
 * heavy for every gate. The assertion is a sanity bound only - the numbers
 * are the result.
 */
import { appendFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  packFilesAsZip,
  rebuildZipWithEntries,
} from "gps-plus-slam-app-framework/storage";

const ENABLED = process.env["TOUR_REBUILD_COST"] === "1";
/** Where the results go (the runner keeps a test's console to itself):
 *  `TOUR_REBUILD_COST_OUT=<file>`. */
const OUT = process.env["TOUR_REBUILD_COST_OUT"];
const MB = 1024 * 1024;

function bytes(size: number, seed: number): Uint8Array {
  const out = new Uint8Array(size);
  // Not compressible, like a JPEG: a cheap xorshift fill.
  let x = seed * 2654435761 || 1;
  for (let i = 0; i < size; i += 1) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x & 0xff;
  }
  return out;
}

async function archiveOf(totalMb: number): Promise<Blob> {
  const count = Math.max(1, Math.round(totalMb / 2));
  return packFilesAsZip(
    Array.from({ length: count }, (_, i) => ({
      path: `images/frame-${String(i)}.jpg`,
      data: bytes(2 * MB, i + 1),
    })),
  );
}

const ADDED = [
  { path: "tour.json", data: JSON.stringify({ version: 2, objects: [] }) },
  ...[0, 1, 2].map((i) => ({
    path: `content/photo-${String(i)}.jpg`,
    data: bytes(1.5 * MB, 100 + i),
  })),
];

describe.skipIf(!ENABLED)("the Finish's rebuild cost (Q-Save)", () => {
  for (const sizeMb of [10, 50, 200]) {
    it(`rebuilds a ${String(sizeMb)} MB tour zip`, async () => {
      const input = await archiveOf(sizeMb);
      const runs: number[] = [];
      for (let run = 0; run < 3; run += 1) {
        const t0 = performance.now();
        const out = await rebuildZipWithEntries(input, ADDED);
        runs.push(performance.now() - t0);
        expect(out.size).toBeGreaterThan(input.size);
      }
      runs.sort((a, b) => a - b);
      const median = runs[1]!;
      const line =
        `rebuild ${String(sizeMb)} MB: median ${median.toFixed(0)} ms ` +
        `(${(median / sizeMb).toFixed(1)} ms per MB; runs ${runs
          .map((r) => r.toFixed(0))
          .join(", ")})\n`;
      if (OUT !== undefined) appendFileSync(OUT, line);
    }, 300_000);
  }
});
