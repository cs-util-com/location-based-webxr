# method-sift.ts

## Purpose

The SIFT method of the benchmark: Splat.js `sift.js` imported at run time, matched by mutual nearest neighbour on its uint8 descriptors.

## Source and licence

- `https://cdn.jsdelivr.net/gh/arrival-space/splat.js@a84620c05f210a304b2d8de1d5c9f19d3657126f/src/sfm/sift.js` (one file, no imports), from Splat.js, MIT, copyright Stratum1 GmbH.
- Loaded at run time from the pinned commit; never vendored into this repository.

## Public API

- `SIFT_URL`, `SIFT_MAX_FEATURES` (1024, the same budget as XFeat). sift.js caps its detections, then adds a keypoint for each extra dominant orientation, so it can return more than the cap; the result is cut to the budget again.
- `siftApi(mod)`: the module's `detectSift`, or `sift.js: no detectSift export`.
- `siftFeatures(result, max = Infinity)`: a detector result as `Features`, cut to the first `max` keypoints (strongest first); throws on buffers shorter than `n` says.
- `siftMethod(deps)`: the `BenchMethod`. Backend `js (main thread)`; init is the module import, download included; one download record from resource timing.

## Invariants

- Runs where it is built: `siftMethod(deps, place)` with `place` `main thread` (the synthetic run and the speed test: long frames block the page, and the measurement includes that) or `worker` (the measuring queue). The backend reads `js (main thread)` or `js (worker)`.
- Descriptors: 128 bytes per keypoint; matching by squared L2.

## Tests

`method-sift.test.ts` (a fake module).
