# browser-launch.mjs

## Purpose

The extra Chromium launch args for the 3D smokes (`3d/playwright.config.mjs`). On Windows it adds `--in-process-gpu`, so the CPU WebGL rendering (SwiftShader) runs inside the browser process. That process inherits the below-normal priority that `scripts/test-timing/stage-priority.mjs` gives browser stages.

## Why

A 3D smoke takes most of this 4-core development laptop. Short gates running beside it (the root repo-config suite above all) failed on 5 s timeouts.

- **Lowering the browser stage's priority alone did not help.** Chromium does the rendering in a separate GPU process and raises that process to AboveNormal itself. Measured 2026-09-30, experiment C: repo-config timeouts per run were 3, 3, 1, 1, 3 below-normal against 1, 2, 4, 4, 1 at normal.
- **With `--in-process-gpu` there is no separate GPU process**, and every Chromium process ran BelowNormal. Under sustained load, two looped look-dev smokes with 85 % or more machine load before and after every counted run:
  - repo-config was green in every counted run with the flag;
  - without it, 3-18 timeouts per run (4, 6, 18, 3, 3 over 5 counted runs; every run with the flag had 0).
  - Detailed numbers are in the 2026-09-30 repo-config-under-load results (private docs repo).
- **Pixel parity:** the sun-clouds, ambient-occlusion and god-rays smokes passed 29/29 with and without the flag.
  - 53 of 58 logged readings were identical, every pixel and brightness reading among them.
  - The one differing reading was a cloud-shadow "under clear" maximum of 2 against 1 on a 0-255 scale. The other differences were timing ratios.
- **Cost:** about 8 % more wall time uncontended, and about 1.2x when short gates compete for the CPU. That is the point: they get the CPU first.
- **Rejected alternative:** a native job-object launcher (spike D). It had the same effect on repo-config, but it needs native Windows code that must be maintained.

## Public API

- `IN_PROCESS_GPU_ARG`: `"--in-process-gpu"`.
- `browserLaunchArgs({ platform, env })` returns `string[]`:
  - `[IN_PROCESS_GPU_ARG]` on `win32`;
  - `[]` elsewhere, or when `env.GATE_BROWSER_PRIORITY === "normal"`. That is the same opt-out as the stage priority, so the two cannot drift apart. Any other value keeps the flag.

## Invariants

- **No change off Windows.** Linux CI renders with Chromium's default process model, which is also what the pixel checks were tuned on.
- **The flag and the lowered priority come as a pair.** The flag only matters because it moves the rendering into a process that inherits the lower priority. With priority normal it buys nothing.

## Examples

```js
import { browserLaunchArgs } from "./browser-launch.mjs";

use: {
  launchOptions: { args: browserLaunchArgs({ platform: process.platform, env: process.env }) },
}
```

## Tests

- `browser-launch.test.mjs` (node --test, the package's `test:unit` stage) pins:
  - when the flag is on, including the win32-only rule;
  - the opt-out, and that a mistyped value keeps the flag.
- The effect is an OS and Chromium property, measured rather than unit-tested: the priority class of every chrome process during a smoke run, and the repo-config timeouts beside a sustained 3D load. Both are recorded in the 2026-09-30 results.
