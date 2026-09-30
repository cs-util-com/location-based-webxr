// Which priority a gate stage's process tree runs at, and how to spawn it
// there. See stage-priority.mjs.md.
import { constants } from 'node:os';

import { isBrowserStage } from './projects.mjs';

/** `GATE_BROWSER_PRIORITY=normal` keeps browser stages at normal priority. */
export const BROWSER_PRIORITY_ENV = 'GATE_BROWSER_PRIORITY';

/**
 * Set to `1` in a stage's environment only when the stage really runs at or
 * below the lowered priority. The Playwright configs key `--in-process-gpu`
 * on it (scripts/e2e/browser-launch.mjs), so the renderer model changes only
 * when it buys something.
 */
export const LOWERED_MARKER_ENV = 'GATE_BROWSER_STAGE_LOWERED';

/**
 * The OS priority to spawn `stage` at, or `null` to inherit the parent's.
 *
 * Browser stages on Windows run at BELOW_NORMAL: a SwiftShader 3D suite
 * takes most of a small machine, and at normal priority it starves every
 * short gate running beside it. Windows gives a child created with no
 * explicit priority class its creator's class when that class is
 * BELOW_NORMAL or IDLE, so the whole tree inherits it, except Chromium's
 * GPU process, which raises itself (hence `--in-process-gpu`).
 *
 * @param {{ command: string }} stage
 * @param {{ platform: string, env: Record<string, string | undefined> }} context
 * @returns {number | null}
 */
export function stageSpawnPriority(stage, { platform, env }) {
  if (platform !== 'win32') return null;
  if (!isBrowserStage(stage)) return null;
  if (env[BROWSER_PRIORITY_ENV] === 'normal') return null;
  return constants.priority.PRIORITY_BELOW_NORMAL;
}

/**
 * Run the synchronous `spawn` while THIS process is at `priority`, then put
 * this process back where it was, so the child is created at `priority`
 * with no window in which it could start a grandchild at normal priority.
 *
 * - The parent is always restored (`run-gate` runs every stage in-process).
 * - The parent is never RAISED: when it already runs at or below `priority`
 *   (node's scale: a larger number is a lower priority), nothing is changed
 *   and the child inherits the lower class.
 * - A refused priority change never fails the spawn.
 * - `spawn` is told whether the child runs lowered, so it can set
 *   `LOWERED_MARKER_ENV` for it.
 *
 * @template T
 * @param {(context: { lowered: boolean }) => T} spawn
 * @param {number | null} priority
 * @param {{ getPriority: () => number, setPriority: (value: number) => void }} os
 * @returns {T}
 */
export function spawnAtPriority(spawn, priority, os) {
  if (priority === null) return spawn({ lowered: false });
  let previous;
  try {
    previous = os.getPriority();
  } catch {
    return spawn({ lowered: false });
  }
  if (previous >= priority) return spawn({ lowered: true });
  try {
    os.setPriority(priority);
  } catch {
    return spawn({ lowered: false });
  }
  try {
    return spawn({ lowered: true });
  } finally {
    try {
      os.setPriority(previous);
    } catch {
      // Nothing sensible to do; the next stage inherits the lower value.
    }
  }
}
