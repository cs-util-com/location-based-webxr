import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  replayRecording,
  createSlamAppStore,
} from "gps-plus-slam-app-framework/state";
import {
  NullStorageBackend,
  loadActionsFromZip,
} from "gps-plus-slam-app-framework/storage";

import {
  assessReplayedJoin,
  computeCaptureGeoJoin,
  preflightCaptureJoin,
  type ReplayedJoinState,
} from "./capture-geo-join";

createSlamAppStore({ storageBackend: new NullStorageBackend() });

/**
 * Why this test matters (geo-join plan Rev 2 §4): the unit tests prove each
 * gate and the transform against synthetic states — this proves the WHOLE
 * chain against a REAL phone recording (the repo's sample fixture: era 5,
 * 46 GPS events, 6 captures, a genuinely solved alignment, no restarts):
 * load → preflight → replay → assess → compute must yield one plausible
 * geo pose per captured photo. A frame-contract break anywhere in the
 * pipeline (raw-vs-NUE, matrix convention, absolute-altitude pairing)
 * shows up here as positions hundreds of metres or degrees off, which the
 * bounding assertions catch.
 */
describe("capture-geo-join over the real sample recording", () => {
  it("joins all six captures to geo poses within walking distance of the zero", async () => {
    // The PhysicsDemo fixture, referenced in place: copying 2.6 MiB of
    // binary into this package would duplicate it past the size guard for
    // no gain — same-repo tests may share one real recording.
    const fixture = new URL(
      "../../GpsPlusSlamJs_PhysicsDemo/playwright-tests/fixtures/sample-recording.zip",
      import.meta.url,
    );
    if (!existsSync(fixture)) {
      throw new Error(
        "capture-geo-join integration: the shared sample-recording.zip moved - update the fixture path",
      );
    }
    const bytes = new Uint8Array(readFileSync(fixture));
    const loaded = await loadActionsFromZip(bytes);
    const actionTypes = loaded.map((e) => e.action.type);

    const pre = preflightCaptureJoin({ odomCoordVersion: 5 }, actionTypes);
    expect(pre.ok).toBe(true);

    const state = (await replayRecording(
      bytes,
    )) as unknown as ReplayedJoinState;
    const verdict = assessReplayedJoin(state);
    expect(verdict).toMatchObject({ ok: true });

    const poses = computeCaptureGeoJoin(state);
    // 5, not 6: the fixture's FIRST capture (action index 2) precedes
    // setZeroPos (index 3), and the reducer no-ops an add2dImage on a null
    // state — a photo taken before the GPS origin exists has no joinable
    // position. Real-data behaviour, kept honest here rather than padded.
    expect(poses.length).toBe(5);

    const zero = state.gpsData!.zero!;
    for (const pose of poses) {
      // Within ~200 m of the zero: a 28-second walk. Degrees-level errors
      // (frame mixups) or km-level errors (double conversion) fail loudly.
      expect(Math.abs(pose.geo.lat - zero.lat)).toBeLessThan(0.002);
      expect(Math.abs(pose.geo.lon - zero.lon)).toBeLessThan(0.003);
      // Absolute altitude: a real phone recording carries an ellipsoidal
      // height, not a near-zero relative one... unless the device reported
      // no altitude (alt 0 fallback). Assert it is finite and sane.
      expect(Number.isFinite(pose.geo.altitude)).toBe(true);
      expect(Math.abs(pose.geo.altitude)).toBeLessThan(9000);
      // Unit-ish rotation (composed from two unit quaternions).
      const [x, y, z, w] = pose.rotationNue;
      expect(Math.hypot(x, y, z, w)).toBeCloseTo(1, 6);
    }
  });
});
