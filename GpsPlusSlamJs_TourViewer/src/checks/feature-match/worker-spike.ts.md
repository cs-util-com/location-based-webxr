# worker-spike.ts

## Purpose

The worker spike page, `/tour/feature-match-check.html?spike=worker`. It answers two questions on the phone that opens it:

1. Does the camera preview stay smooth while the photo test's measuring worker measures photo pairs in the background?
2. Can XFeat (LiteRT.js) start in a module worker?

It runs the shipped worker through its client (`measure-client.ts`, `feature-match-measure.worker.ts`), not a copy, and probes XFeat with `xfeat-probe.worker.ts`, the same worker wiring with XFeat as the only method.

## Public API

- `startWorkerSpike(doc = document)`: replaces the page body with the spike and starts the camera. `feature-match-check.html` calls it when the URL has `?spike=worker`.

## What it measures, and its parameters

1. **At rest** (`baselineMs`, default 10 s): the gaps between camera frames (`requestVideoFrameCallback`) with nothing else running.
2. **Photos** (2 x `pairs`, default 6 pairs, `photoGapMs` 500 ms apart): frames captured at most 1280 px on the long side (`CAPTURE_MAX`) and encoded as PNG; each encode time is logged.
3. **Pairs**: each pair measured by the measuring worker with SIFT and ALIKED + LightGlue (SIFT + LightGlue off), sizes 320, 480 and 640, one run, no warm-up, WebGPU else WASM (the worker's own settings), while the frame gaps are recorded. A live verdict every second feeds the status line.
4. **XFeat**: the probe worker on the first pair, with a 300 s limit (its download included); no answer in that time reads as "not known", not as "could not start".

The camera is smooth when the gaps' p95 and p99 during the pairs are at most 1.25 x those at rest and no gap is over 250 ms; the log adds the verdict at factors 1.1/1.25/1.5 and caps 150/250/400 ms. `?baseline=` (seconds) and `?pairs=` shorten a test run.

## Layout and behaviour

- **Before:** a short explanation (what it measures, about how long, what to point at, hold still), the camera preview, one big Start button (enabled once the camera shows frames).
- **While it runs:** step x of y with a bar and the time left, one plain status line, "keep this page open", the preview. The log stays out of sight. The screen is kept on (`guardRun`), and a hidden page is noted on the result.
- **At the end:** a result card (camera smooth yes or no with the worst gap, XFeat started or not with a short reason, the time per method), a large Copy log button ("Copying...", "Copied", or "Copy failed" with the log opened and selected, through `copyWithFeedback`), and Try again when something went wrong. The full log sits under "Show the full log".
- **Errors:** a plain sentence and what to do (`plainError`); the stack goes to the log only. Window errors and rejected promises are logged too.
- Uses the guided view's tokens and components (`guided-view.css`, under `data-ui="guided"`) plus `worker-spike.css`.

## Invariants and defensive measures

- Each worker URL is written inside `new Worker(new URL(..., import.meta.url))`: only that form makes the build bundle the worker; a URL built apart ships the raw source and fails on the phone while the dev server works.

- The run status lives in the store (`worker-spike-slice.ts`); the frame gaps, the camera, the workers and the photos stay in this module's run, never in module variables.
- The view redraws on every store change and once a second while running, so the time left moves even while one pair takes long.
- Every worker is closed when the run ends, in success or failure; the XFeat probe never holds the page longer than its limit.
- A worker crash, models that never load or a hidden page end in a result card with a notice, not a frozen screen.

## Tests

- `playwright-tests/feature-match-check.spec.js`: Start to result with a faked camera, SIFT stubbed and the other models refused (the card with its camera and XFeat answers and one line per method, Copy log turning to "Copied", the log closed until opened, the copied log holding the verdict with its sweep and agreeing with the card), and a refused camera (the plain error, no stack on screen).
- `tests/repo-config/worker-url-inside-new-worker.test.js`: both worker URLs are written inside `new Worker(...)`, the only form the build bundles.
- The rules are unit-tested in `worker-spike-model.test.ts`, the status in `worker-spike-slice.test.ts`.
