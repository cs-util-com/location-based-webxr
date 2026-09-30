// Which priority a gate stage's process tree runs at, and how to spawn it
// there. See stage-priority.mjs.md.
import { constants } from 'node:os';

import { isBrowserStage } from './projects.mjs';

/** `GATE_BROWSER_PRIORITY=normal` keeps browser stages at normal priority. */
export const BROWSER_PRIORITY_ENV = 'GATE_BROWSER_PRIORITY';

/**
 * The OS priority to spawn `stage` at, or `null` to inherit the parent's.
 *
 * Browser stages on Windows run at BELOW_NORMAL: a SwiftShader 3D suite
 * takes most of this machine, and at normal priority it starves every short
 * gate running beside it. Windows gives a child created with no explicit
 * priority class its creator's class when that class is BELOW_NORMAL or
 * IDLE, so the whole tree (shell, Playwright runner, Chromium) inherits it.
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
 * The parent is always restored (`run-gate` runs every stage in-process), and
 * a refused priority change never fails the spawn.
 *
 * @template T
 * @param {() => T} spawn
 * @param {number | null} priority
 * @param {{ getPriority: () => number, setPriority: (value: number) => void }} os
 * @returns {T}
 */
export function spawnAtPriority(spawn, priority, os) {
  if (priority === null) return spawn();
  let previous;
  try {
    previous = os.getPriority();
    os.setPriority(priority);
  } catch {
    previous = undefined;
  }
  try {
    return spawn();
  } finally {
    if (previous !== undefined) {
      try {
        os.setPriority(previous);
      } catch {
        // Nothing sensible to do; the next stage inherits the lower value.
      }
    }
  }
}
