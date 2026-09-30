/**
 * Chromium launch args for the 3D smokes (2026-09-30 machine-load decision).
 *
 * Why this test matters: the 3D smokes render WebGL on the CPU (SwiftShader).
 * By default Chromium does that work in a separate GPU process that it
 * raises to AboveNormal itself, so running the browser stage at below-normal
 * priority (scripts/test-timing/stage-priority.mjs) never reached it, and the
 * short gates beside a 3D suite kept failing on timeouts. With
 * `--in-process-gpu` the work runs in the browser process, which inherits
 * the below-normal priority. Measured under sustained load: repo-config
 * green in all 5 counted runs with the flag, 3-18 timeouts per run without.
 * These tests pin WHEN the flag is on, and that it follows the same opt-out
 * as the stage priority, so the two cannot drift apart.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { browserLaunchArgs, IN_PROCESS_GPU_ARG } from "./browser-launch.mjs";

describe("browserLaunchArgs", () => {
  it("renders in the browser process on Windows", () => {
    assert.deepEqual(browserLaunchArgs({ platform: "win32", env: {} }), [
      IN_PROCESS_GPU_ARG,
    ]);
    assert.equal(IN_PROCESS_GPU_ARG, "--in-process-gpu");
  });

  it("changes nothing off Windows", () => {
    // CI runs one job per Linux machine: nothing competes, and Chromium's
    // default process model there is what the pixel references were taken on.
    for (const platform of ["linux", "darwin"]) {
      assert.deepEqual(browserLaunchArgs({ platform, env: {} }), []);
    }
  });

  it("follows the stage-priority opt-out, GATE_BROWSER_PRIORITY=normal", () => {
    // With the priority at normal the flag buys nothing, and the opt-out is
    // how a measurement's control arm gets the old behaviour back.
    assert.deepEqual(
      browserLaunchArgs({
        platform: "win32",
        env: { GATE_BROWSER_PRIORITY: "normal" },
      }),
      [],
    );
  });

  it("keeps the flag for any other value, as the stage priority does", () => {
    assert.deepEqual(
      browserLaunchArgs({
        platform: "win32",
        env: { GATE_BROWSER_PRIORITY: "Normal " },
      }),
      [IN_PROCESS_GPU_ARG],
    );
  });
});
