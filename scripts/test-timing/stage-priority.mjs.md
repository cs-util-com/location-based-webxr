# stage-priority.mjs

## Purpose

Decides the OS priority a gate stage's process tree runs at, and spawns it there. Browser stages (Playwright) on Windows run at BELOW_NORMAL, so short gates running beside a 3D suite get the CPU first.

## Why

A headless-Chromium 3D suite renders WebGL on the CPU (SwiftShader) and can take most of a small development machine by itself. At normal priority it starves every short gate beside it: starting a process took 0.4-3.6 s instead of about 0.1 s, and the root repo-config guards failed on vitest's 5 s timeout. That happened before and after the suite's own cost was halved: 2-26 timeouts per run at 86-96 % load on 2026-09-30.

## Public API

- `BROWSER_PRIORITY_ENV`: the name of the opt-in env var, `GATE_BROWSER_PRIORITY`.
  - Set to exactly `below`, it lowers browser stages (and, through the marker, turns on `--in-process-gpu`). Off by default since 2026-09-30: lowered, the design system's timing-sensitive 3D specs (the globe dive, the god-rays cost) went red in 2 of 3 runs and ran about 15 % slower, against 2 of 2 green at normal priority.
  - Any other value is off, so a typo cannot silently slow the 3D suites.
- `LOWERED_MARKER_ENV`: `GATE_BROWSER_STAGE_LOWERED`. run-stage sets it to `1` in a stage's environment only when the stage really runs at or below the lowered priority, and clears it otherwise. The Playwright configs key `--in-process-gpu` on it (`scripts/e2e/browser-launch.mjs`).
- `stageSpawnPriority(stage, { platform, env })` returns a `number | null`:
  - `os.constants.priority.PRIORITY_BELOW_NORMAL` for a browser stage (`isBrowserStage` from `projects.mjs`, matched on the command) when `platform === 'win32'` and `GATE_BROWSER_PRIORITY=below`;
  - otherwise `null`, meaning inherit.
- `spawnAtPriority(spawn, priority, os)` returns whatever `spawn` returns. `spawn` is called with `{ lowered }`:
  - **`priority === null`:** `spawn({ lowered: false })`, and the priority is left untouched.
  - **This process already at or below `priority`:** on node's scale a larger number is a lower priority. Nothing is changed, and it calls `spawn({ lowered: true })`; the child inherits the lower class. **The parent is never raised.**
  - **Otherwise:** it lowers THIS process to `priority`, calls `spawn({ lowered: true })`, and restores this process in a `finally`.
  - **A refused `getPriority`/`setPriority` (EACCES/EPERM):** it is swallowed, and it calls `spawn({ lowered: false })` at the inherited priority.

## Invariants

- **The child is created at the lowered priority, with no race.** The priority is lowered around the synchronous `spawn` itself, not set on the child after it started. Setting it afterwards leaves a window in which the shell could start Playwright at normal priority.
- **The tree inherits it, except Chromium's GPU process, which the paired flag handles.** On Windows, a child created with no explicit priority class gets its creator's class when that class is BELOW_NORMAL or IDLE (CreateProcess documentation). libuv passes no priority class. Measured 2026-09-30:
  - The shell, the node processes, and Chromium's main, utility and renderer processes were BelowNormal. Chromium's separate GPU process was AboveNormal, because it raises itself, and it is the process that runs SwiftShader.
  - **Alone**, this module does not take the 3D suite's main cost out of the way. Repo-config timeouts per run were 3, 3, 1, 1, 3 below-normal against 1, 2, 4, 4, 1 normal, and the 3D suite got 1.4-4x slower.
  - **Paired with `scripts/e2e/browser-launch.mjs`** (`--in-process-gpu`), no separate GPU process is left and every process runs BelowNormal. Under sustained load, repo-config was green in all 5 counted runs, against 3-18 timeouts per run without the pair (85 % or more machine load before and after every counted run).
  - Rejected: a Windows job object with a BELOW_NORMAL priority-class limit had the same effect, but it needs a native launcher to maintain.
- **The parent is always restored and never raised.** `run-gate.mjs` runs every stage of a gate in one process: a leaked lowering would slow every later stage. A parent already at IDLE must not be pushed up to below-normal.
- **Only Windows.** Linux CI runs one job per machine. Lowering the nice value there would only slow the e2e job itself.

## Examples

```js
import os from 'node:os';
import { spawn } from 'node:child_process';
import { LOWERED_MARKER_ENV, spawnAtPriority, stageSpawnPriority } from './stage-priority.mjs';

const priority = stageSpawnPriority(stage, { platform: process.platform, env });
const child = spawnAtPriority(
  ({ lowered }) =>
    spawn(command, { shell: true, env: { ...env, [LOWERED_MARKER_ENV]: lowered ? '1' : undefined } }),
  priority,
  os
);
```

```bash
# opt in: browser stages below normal, with the in-process GPU
GATE_BROWSER_PRIORITY=below pnpm run test:e2e
```

## Tests

- `stage-priority.test.mjs` (root repo-config suite, 12 tests including a fast-check property):
  - which stages are lowered;
  - the win32-only rule;
  - the opt-in, off by default, and the typo case;
  - that the parent is lowered during the spawn and restored afterwards, including when the spawn throws;
  - that a parent already running lower is never raised, and its child still counts as lowered;
  - that a refused lowering still spawns and does not claim to be lowered;
  - the marker's name.
- The inheritance itself is an OS and Chromium property. It is covered by measurement, not by a unit test: the priority class of every chrome-headless-shell process during real browser stages (2026-09-30).
