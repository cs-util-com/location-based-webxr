# bench-run.ts

## Purpose

The benchmark loop: loads each method, runs it per input size with a warm-up and N timed runs, and collects the numbers.

## Public API

- `CORRECT_TOL_PX = 3`.
- `Features { count, descriptorBytes, x, y, payload }` (keypoints in frame pixels; `payload` is the method's own descriptor data).
- `MethodRunner { backend, downloads, initMs, notes, extract(frame), match(a, b), dispose() }`; `BenchMethod { id, label, init() }`.
- `BenchInput { a, b, warp | null }`; `MethodResult` (with one `SizeResult` per size); `BenchHooks { now, yieldToUi, log, onSize? }`.
- `Points { x, y }` and `SizeSample { a, b, pairs }`: the keypoints of both frames and the match pairs (`pairs[2k]` an index into `a`, `pairs[2k+1]` into `b`) of the last timed round, in the pixels of the size computed (`SizeResult.width x height`). `SizeResult.sample` is that sample, or null when the size failed.
- `onSize(method { id, label }, size)`: called as each size finishes (also a failed one), so the page can draw it while the next one runs. It must not throw: a throw ends `runBenchmark` (the method is still disposed). The page catches its own errors inside the hook.
- `runBenchmark(methods, input, { sizes, runs }, hooks)`: per method `init()`, then per size both frames resized to that long edge, one warm-up (extract A, extract B, match), then `runs` timed rounds. Extraction is timed per frame, matching per pair. Keypoints, descriptor bytes, matches and correct matches are the lower median over all timed rounds (keypoints and bytes over both frames). A size that cannot be computed or resized is kept as that size's error, like a failed extraction.

## Invariants

- A method that fails to load is recorded as `init: <error>` and the loop goes on with the next; a size that fails is recorded with its error and the next size runs.
- Every loaded method is disposed, also after a failure.
- A sample owns its arrays: the points and the pairs are copied out of what the method returned, since a method may reuse its buffers on the next call.
- `yieldToUi` runs between steps so the page can paint and log.
- On a synthetic pair, `correct` counts matches within `CORRECT_TOL_PX` of the known warp; on camera input it is null.

## Tests

`bench-run.test.ts` (fake methods, fake clock).
