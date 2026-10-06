/**
 * The authoring picks have no odometry SEGMENTS (review R8 of D33).
 *
 * Why this test matters: `visit-alignment-picks.ts` keeps one pick per
 * object, measurement and sighting, each an odometry-to-GPS alignment, and
 * `walked-distance-tracker.ts` sums odometry steps. Both are only correct
 * while the visit's odometry is ONE continuous frame: a tracking restart or
 * a loop closure starts a new segment, after which an older pick maps the
 * new odometry wrongly and the walked distance gains a jump. Nothing in the
 * tracker models that, and it is safe today only because the Tour Viewer
 * never puts a restart or a loop closure into its store: it neither
 * dispatches the two actions nor wires the session hooks that would
 * (`onRestarted`, the framework's live loop-closure handler; the Recorder
 * does both). No type check or behavioural test sees that invariant, so
 * the source is read: the day the Tour Viewer starts handling either, this
 * fails, and the picks need a segment notion first (see the sidecar).
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = dirname(fileURLToPath(import.meta.url));

/** What would bring a new odometry segment into the Tour Viewer's store. */
const SEGMENTING = [
  "odometryTrackingRestarted",
  "arLoopClosureDetected",
  "createLoopClosureHandler",
  "onRestarted",
];

function productionFiles(): string[] {
  return readdirSync(SRC).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts"),
  );
}

describe("the Tour Viewer never starts a new odometry segment (R8 of D33)", () => {
  it("neither dispatches a tracking restart or loop closure nor wires their hooks", () => {
    const files = productionFiles();
    // A guard that reads nothing passes for nothing.
    expect(files).toContain("visit-alignment-picks.ts");
    const hits = files.flatMap((f) => {
      const source = readFileSync(join(SRC, f), "utf8");
      return SEGMENTING.filter((name) => source.includes(name)).map(
        (name) => `${f}: ${name}`,
      );
    });
    expect(hits).toEqual([]);
  });
});
