/**
 * The shared sample recording (the PhysicsDemo e2e fixture), for unit
 * tests that need a REAL walk: era 5, GPS that solves, six recorded
 * photos (`images/frame-00000N.jpg`), the Recorder's `sparse/` and
 * `refPoints/` folders. Test-only.
 */
import { existsSync, readFileSync } from "node:fs";

const SAMPLE_RECORDING = new URL(
  "../../../GpsPlusSlamJs_PhysicsDemo/playwright-tests/fixtures/sample-recording.zip",
  import.meta.url,
);

/** The sample recording's bytes; a moved fixture fails in words. */
export function sampleRecordingBytes(): Uint8Array<ArrayBuffer> {
  if (!existsSync(SAMPLE_RECORDING)) {
    throw new Error(
      "the shared sample-recording.zip moved - update test-support/sample-recording.ts",
    );
  }
  return new Uint8Array(readFileSync(SAMPLE_RECORDING));
}

/** The sample's camera captures, by entry name. */
export const SAMPLE_PHOTOS: readonly string[] = [1, 2, 3, 4, 5, 6].map(
  (n) => `images/frame-00000${String(n)}.jpg`,
);
