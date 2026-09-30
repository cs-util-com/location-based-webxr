# browser-launch.mjs

## Purpose

The extra Chromium launch args every Playwright config in this repo passes to `launchOptions.args`. When run-stage started the browser stage at a lowered priority, it adds `--in-process-gpu`. The CPU WebGL rendering (SwiftShader) then runs inside the browser process, which inherits that priority.

## Why

Headless Chromium renders WebGL on the CPU. By default it does that in a separate GPU process, and it raises that process to AboveNormal itself. So lowering a browser stage (`scripts/test-timing/stage-priority.mjs`) lowered every process except the one doing most of the work, and short gates beside a 3D suite kept failing on 5 s timeouts. Measured 2026-09-30:

- **Priority alone:** no effect on the short gates. Repo-config timeouts per run were 3, 3, 1, 1, 3 against 1, 2, 4, 4, 1. The 3D suite got 1.4-4x slower.
- **Priority plus this flag:**
  - no separate GPU process remained, and every process ran BelowNormal;
  - under sustained load (two looping 3D suites, 85 % or more machine load before and after every counted run), repo-config was green in all 5 counted runs, against 3-18 timeouts per run without it.
- **Pixel parity** (design-system sun-clouds, ambient-occlusion and god-rays smokes):
  - 29 of 29 tests passed both ways;
  - 53 of 58 logged readings were identical;
  - the rest were timing ratios, plus one cloud-shadow maximum of 2 against 1 on a 0-255 scale.
- **Cost to the 3D suite:** about 8 % alone, about 1.2x while short gates compete. That is the intent: short gates get the CPU first.
- **Rejected:** a Windows job object with a priority-class limit. It had the same effect, but it needs a native launcher to maintain.

## Public API

- `IN_PROCESS_GPU_ARG`: `'--in-process-gpu'`.
- `browserLaunchArgs(env)` returns `string[]`:
  - `[IN_PROCESS_GPU_ARG]` when `env.GATE_BROWSER_STAGE_LOWERED === '1'`;
  - otherwise `[]`.

## Invariants

- **Keyed on run-stage's marker (`LOWERED_MARKER_ENV` in `stage-priority.mjs`), never on the platform alone.** run-stage sets the marker only when the stage really runs at or below BELOW_NORMAL. So nothing changes in any of these cases:
  - on Linux CI;
  - with `GATE_BROWSER_PRIORITY=normal`;
  - when the OS refuses the lowering;
  - when a spec is run with `playwright test` directly.
- **Every Playwright config uses it.** `browser-launch.test.mjs` enumerates the tracked configs and fails for any that does not pass `browserLaunchArgs(process.env)`. Every app here renders WebGL; the landing page has a globe.

## Examples

```js
import { browserLaunchArgs } from "../../scripts/e2e/browser-launch.mjs";

use: {
  launchOptions: { args: browserLaunchArgs(process.env) },
}
```

## Tests

- `browser-launch.test.mjs` (root repo-config suite):
  - the marker rule;
  - that every tracked Playwright config wires the helper.
- The effect is an OS and Chromium property, measured rather than unit-tested: the priority class of every chrome process during a run, and short-gate timeouts beside a sustained 3D load.
