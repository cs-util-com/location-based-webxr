// Chromium launch args for the 3D smokes. See browser-launch.mjs.md.

/** Runs Chromium's GPU (here: SwiftShader) work inside the browser process. */
export const IN_PROCESS_GPU_ARG = "--in-process-gpu";

/**
 * The extra Chromium args for a 3D smoke run.
 *
 * On Windows the browser stage runs at below-normal priority
 * (scripts/test-timing/stage-priority.mjs), but Chromium raises its separate
 * GPU process to AboveNormal, and that process does the CPU rendering. With
 * `--in-process-gpu` the rendering runs in the browser process, which
 * inherits the lowered priority. `GATE_BROWSER_PRIORITY=normal` switches both
 * off together.
 *
 * @param {{ platform: string, env: Record<string, string | undefined> }} context
 * @returns {string[]}
 */
export function browserLaunchArgs({ platform, env }) {
  if (platform !== "win32") return [];
  if (env.GATE_BROWSER_PRIORITY === "normal") return [];
  return [IN_PROCESS_GPU_ARG];
}
