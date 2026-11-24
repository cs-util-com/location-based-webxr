# method-sift-lightglue.ts

## Purpose

A bench method: SIFT keypoints from the plain-JS sift.js matched by LightGlue, COLMAP's `sift-lightglue.onnx` export run by onnxruntime-web on WebGPU or WASM. Used by the benchmark (unticked by default, `#m-siftlg`) and by the speed test.

## Public API

- `SIFT_LIGHTGLUE_PATH` (`/api/model/sift-lightglue-3.13.0.onnx`, the site worker's mirror of the COLMAP 3.13.0 release asset, 45,806,253 bytes) and `SIFT_LIGHTGLUE_SHA256`. Keypoints per frame default to 512. The option `place` (`main thread` by default, or `worker`) names where its SIFT half runs in the note (`sift.js, worker`).
- `sha256Hex(bytes)`: lower-case hex via `crypto.subtle`.
- `siftLightGlueMethod(backend, deps, { modelUrl?, sha256?, maxFeatures? })`: a `BenchMethod` with `backend` set to the one asked for. `init()` loads the ORT runtime and sift.js, downloads the model (by default from the mirror route on the page's origin), checks its sha256 before any session is created (an error names the URL and both hashes), then creates the session; the hash time is a note, not part of init. `extract` runs sift.js on the main thread and converts with `sift-lightglue-io.ts`; `match` feeds both frames and reads `matches0` (int64, -1 for none). A frame with no keypoints gives no matches without running the model.

## Invariants and assumptions

- The model is fetched only from the same origin: GitHub release downloads send no CORS headers, and Cloudflare static assets are limited to 25 MiB.
- Licences: LightGlue Apache-2.0, COLMAP BSD-3. Nothing of it is bundled; the page loads it at run time.
- Production code stays dependency-free: onnxruntime-web comes from the pinned jsDelivr URL of `method-aliked.ts`.

## Example

```ts
const m = siftLightGlueMethod("wasm", browserDeps, { maxFeatures: 1024 });
const runner = await m.init();
```

## Tests

`method-sift-lightglue.test.ts` with a fake runtime: the hash check, the ten inputs and the matches kept, a wrong sha256 refused before any session, no model run for an empty frame, and the empty-input digest.
