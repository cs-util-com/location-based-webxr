# worker-spike-cells.ts

## Purpose

The measuring half of the throwaway worker spike (`worker-spike.ts.md`): one cell of methods on the synthetic pair, run identically on the main thread and in the spike's worker. It calls the shipped `buildMethods` and `runBenchmark` unchanged (only the run context differs), so the spike tests the code the background queue will run, not a copy. Deleted together with the spike when the worker queue lands.

## Public API

- `SPIKE_FRAME` (1280 x 720, a camera frame) and `SPIKE_SIZES` (320, 480, 640, the page's default long edges, which the queue keeps).
- `SpikeMethod`: `"sift" | "xfeat" | "aliked" | "siftlg" | "dino"`.
- `CellRequest { backend, methods, runs, warmup, seed }`: the synthetic pair of `seed` (`syntheticPair`, so no photo is bundled), measured with `runs` timed rounds after an optional warm-up; XFeat runs its fp16 file only.
- `runCell(request, context, log, deps = spikeDeps)`: a `CellResult { methods, dino, ms }`: per method its backend, init time, the `cached` flag of each download, the download time, its notes and per size the keypoints, matches and median extract and match times, or its error.
- DINOv2 int8 (`dino` in the methods): the CLS embedding of frame A through the shipped `dino-io.ts` and `loadOrtRuntime`, forwarded `runs + 1` times (once on a cold cell), with init and median forward time; the speed test's arm reports only the A-B cosine, so the spike reads the embedding itself for the 0.9999 cosine rule.
- `contextFacts()`: the WebGPU adapter (`adapter`, or `none (...)` with the reason) and the WASM thread line (`not isolated: 1 thread` on a page without cross-origin isolation).
- `pngRoundTrip(png, rgba, width, height)`: decodes a PNG with `createImageBitmap` (no premultiply, no colour conversion) into an `OffscreenCanvas` and counts the bytes that differ from `rgba`, with the decode time.
- `spikeDeps` (module-private, the default of `runCell`): the browser's loaders (dynamic import, fetch, `performance`), valid in both contexts.

## Invariants

- DOM-free: it runs in a dedicated worker. A method error is a result, never a throw; a failed DINOv2 arm is a `DinoNumbers` with its error.
- No unit tests: throwaway code measured by its own numbers.

## Tests

None (throwaway); exercised by the headless desktop run and the phone run of the spike.
