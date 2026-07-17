/**
 * Guards that the bundled e2e fixture recording is loadable, current-era, and
 * actually carries depth samples with a projection matrix — the prerequisite for
 * the occupancy mesh (and therefore the physics collider) to reconstruct during
 * the replay-flow e2e. If a future fixture swap breaks this, the e2e's slow
 * timeout would be a mystery; this fails fast and explains why.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadActionsFromZip } from "gps-plus-slam-app-framework/storage/zip-reader";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(
  here,
  "..",
  "playwright-tests",
  "fixtures",
  "sample-recording.zip",
);

describe("e2e fixture recording", () => {
  it("parses into actions including depth samples with a projection matrix", async () => {
    const bytes = new Uint8Array(readFileSync(FIXTURE));
    const entries = await loadActionsFromZip(bytes);
    const actions = entries.map((e) => e.action);

    const depth = actions.filter(
      (a) => (a as { type?: string }).type === "recording/recordDepthSample",
    ) as Array<{
      payload?: { points?: unknown[]; projectionMatrix?: unknown };
    }>;

    // Enough total actions to be a real walk.
    expect(actions.length).toBeGreaterThan(50);
    // Depth samples exist and carry the projection matrix + points (current-era).
    expect(depth.length).toBeGreaterThan(5);
    const withProjection = depth.filter(
      (d) => d.payload?.projectionMatrix && (d.payload.points?.length ?? 0) > 0,
    );
    expect(withProjection.length).toBeGreaterThan(5);
  });
});
