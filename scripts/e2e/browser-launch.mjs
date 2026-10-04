// Chromium launch args shared by every Playwright config. See browser-launch.mjs.md.
import { LOWERED_MARKER_ENV } from '../test-timing/stage-priority.mjs';

/** Runs Chromium's GPU (here: SwiftShader) work inside the browser process. */
export const IN_PROCESS_GPU_ARG = '--in-process-gpu';

/**
 * The extra Chromium args for an e2e run: `--in-process-gpu` when run-stage
 * started this browser stage at a lowered priority (it sets
 * `LOWERED_MARKER_ENV` only then), otherwise none.
 *
 * Why: Chromium raises its separate GPU process, which does the CPU WebGL
 * rendering, to AboveNormal itself, so a lowered stage would still let that
 * process starve short gates. In-process, the rendering inherits the lowered
 * priority.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
export function browserLaunchArgs(env) {
  return env[LOWERED_MARKER_ENV] === '1' ? [IN_PROCESS_GPU_ARG] : [];
}
