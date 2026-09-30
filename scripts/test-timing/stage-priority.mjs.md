# stage-priority.mjs

## Purpose

Decides the OS priority a gate stage's process tree runs at, and spawns it there. Browser stages (Playwright) on Windows run at BELOW_NORMAL, so short gates running beside a 3D suite get the CPU first.

## Why

A headless-Chromium 3D suite renders WebGL on the CPU (SwiftShader) and by itself takes about 85 % of the 4-core development laptop. At normal priority it starves every short gate beside it. Starting a process then took 0.4-3.6 s instead of about 0.1 s, and the root repo-config guards failed on vitest's 5 s timeout. That happened before and after the suite's own cost was halved: 2-26 timeouts per run at 86-96 % load on 2026-09-30.

This module is recommendation 1 of the 2026-09-28 machine-load findings, decided by the owner on 2026-09-30. The measurements are in the 2026-09-30 repo-config-under-load results (private docs repo).

## Public API

- `BROWSER_PRIORITY_ENV`: the name of the opt-out env var, `GATE_BROWSER_PRIORITY`. Setting it to exactly `normal` keeps browser stages at normal priority, for example as the control arm of a measurement. Any other value keeps the default, so a typo cannot silently switch the lowering off.
- `stageSpawnPriority(stage, { platform, env })` returns a `number | null`:
  - `os.constants.priority.PRIORITY_BELOW_NORMAL` for a browser stage (`isBrowserStage` from `projects.mjs`, matched on the command) when `platform === 'win32'` and there is no opt-out;
  - otherwise `null`, meaning inherit.
- `spawnAtPriority(spawn, priority, os)` returns whatever `spawn()` returns:
  - it lowers THIS process to `priority`, calls the synchronous `spawn`, and restores this process in a `finally`;
  - `priority === null` calls `spawn()` untouched;
  - a refused `setPriority` (EACCES/EPERM) is swallowed, so the spawn still happens at the inherited priority.

## Invariants

- **The child is created at the lowered priority, with no race.** The priority is lowered around the synchronous `spawn` itself, not set on the child after it started. Setting it afterwards leaves a window in which the shell could start Playwright at normal priority.
- **The tree inherits it, EXCEPT Chromium's GPU process.** On Windows, a child created with no explicit priority class gets its creator's class when that class is BELOW_NORMAL or IDLE (CreateProcess documentation). libuv passes no priority class. Measured 2026-09-30 during a look-dev smoke run:
  - the shell, the three node processes, and Chromium's main, utility and renderer processes were BelowNormal;
  - **the GPU process was AboveNormal in both arms**, because Chromium raises it itself. That process runs SwiftShader and is the one that takes most of the CPU.
  - So this module ALONE does not take the 3D suite's main cost out of the way (experiment C: repo-config timeouts per run 3, 3, 1, 1, 3 below-normal against 1, 2, 4, 4, 1 normal; and the 3D suite got 1.4-4x slower).
  - **Paired with `GpsPlusSlamJs_DesignSystem/3d/browser-launch.mjs`**, which launches the 3D smokes with `--in-process-gpu`, there is no separate GPU process left, and every process of the stage runs BelowNormal. Under sustained load, repo-config was green in every counted run with the pair, against 3-18 timeouts per run without it (5 counted runs each, at 85 % or more machine load before and after every run).
  - A Windows job object with a BELOW_NORMAL priority-class limit had the same effect (spike D). It was rejected because it needs a native launcher to maintain.
- **The parent is always restored.** `run-gate.mjs` runs every stage of a gate in one process. A leaked lowering would slow every later stage.
- **Only Windows.** Linux CI runs one job per machine. Lowering the nice value there would only slow the e2e job itself.

## Examples

```js
import os from 'node:os';
import { spawn } from 'node:child_process';
import { spawnAtPriority, stageSpawnPriority } from './stage-priority.mjs';

const priority = stageSpawnPriority(stage, { platform: process.platform, env });
const child = spawnAtPriority(() => spawn(command, { shell: true }), priority, os);
```

```bash
# control arm: browser stages at normal priority
GATE_BROWSER_PRIORITY=normal pnpm run test:e2e
```

## Tests

- `stage-priority.test.mjs` (root repo-config suite, 10 tests including a fast-check property):
  - which stages are lowered;
  - the win32-only rule;
  - the opt-out, and the typo case;
  - that the parent is lowered during the spawn and restored afterwards, including when the spawn throws;
  - that a refused lowering still spawns.
- The inheritance itself is an OS and Chromium property. It is covered by measurement, not by a unit test: the priority class of every chrome-headless-shell process during a real browser stage, recorded in the 2026-09-30 results. It showed the GPU-process exception above.
