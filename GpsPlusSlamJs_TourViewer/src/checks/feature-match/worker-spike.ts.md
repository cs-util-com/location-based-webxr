# worker-spike.ts

## Purpose

The throwaway worker spike page, `feature-match-check.html?spike=worker`: do XFeat (LiteRT.js), ALIKED + LightGlue, SIFT + LightGlue and DINOv2 (onnxruntime-web) and SIFT (plain JS) load and run in a module worker, on WebGPU and WASM, with the main thread's numbers, while the camera preview stays smooth? It answers that before the background measuring queue is built, and is deleted when it is.

## Sets

- Phone (the default): SIFT, XFeat and ALIKED + LightGlue, worker only, camera on; the baseline, the cold and second-pair cells, the timed cells, the PNG check. The page text states the expected time (the desktop time of this set times 4).
- `&set=full`: every method, main thread and worker, camera on and off, plus the equality verdicts.

## Cells, in order

1. Facts: the WebGPU adapter on the main thread and in a worker, and `not isolated: 1 thread` (no threads axis: the page is not cross-origin isolated). A backend without an adapter is logged `none (no adapter)` and skipped, not failed.
2. Baseline: camera on, worker idle, 10 s of frame gaps.
3. Cold, per backend: a fresh worker, one pair, one run, no warm-up, the queue's sizes; then a second pair (another seed) in the same worker, its downloads' `cached` flags and `initMs` logged.
4. Timed, per context and backend, camera on, then (full set) camera off: 1 warm-up and 5 runs.
5. PNG: one 1280 x 720 frame encoded on the main thread (`canvas.toBlob` and `OffscreenCanvas.convertToBlob`, each timed with the longest main-thread frame gap), decoded in the worker and compared byte for byte.
6. Verdicts (full set): worker against main thread, camera off.

## Rules and their ranges

- Runs in a worker: counts equal on WASM, within 2 % on WebGPU; DINOv2 embedding cosine at least 0.9999. The log also gives each method's largest count difference read at 0, 1, 2 and 5 %.
- Camera stays smooth: p95 and p99 of the frame-callback gaps at most 1.25 x the baseline's, no gap over 250 ms; the window covers the whole cell, model download, load and WebGPU compile included. Each camera-on cell also gives the verdict at 1.1, 1.25 and 1.5 x and caps of 150, 250 and 400 ms, and the stream's own fps (presented frames).

## Invariants

- The frame gaps are between `requestVideoFrameCallback` calls on the main thread, so a stalled page shows as a long gap even when the compositor keeps presenting frames; the stream fps shows the latter.
- Copy log copies the whole log; it says when the copy failed. Results come back as a pasted log, never screenshots.

## Tests

None (throwaway): its numbers are the result.
