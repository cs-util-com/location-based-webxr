# opencv-loader.ts

**Purpose:** Lazily load opencv.js and adapt the published global to the
framework's `CvLike`, so `seams.ts` can build an `OpenCvPnpSquare` for the
production PnP pose path (Step-0 demo→PnP conversion). Main-thread load: the demo
runs `BarcodeDetector` on the main thread and `OpenCvPnpSquare.solve` is
synchronous, so a worker buys nothing.

## Public API

- `loadOpenCv(deps?): Promise<CvLike>` — single-flight (one shared in-flight/
  resolved load). `deps`: `url?`, `timeoutMs?`, `loadScript?(url)` (default DOM
  `<script>` injection), `getGlobal?()` (default `globalThis.cv`).
- `DEFAULT_OPENCV_URL` — pinned `https://docs.opencv.org/4.10.0/opencv.js`
  (tunable; the build must include `calib3d` for `solvePnP` +
  `SOLVEPNP_IPPE_SQUARE`).
- `resetOpenCvLoaderForTest()` — drop the cached load (tests only).

## Invariants & assumptions

- **DEVICE-UNVERIFIED.** The CDN URL/version and the runtime-init handshake vary by
  opencv.js build and are confirmed only on a real device/browser (like the rest
  of the demo's device seam). The handshake handles three shapes: `cv.Mat` already
  present (ready), `cv.onRuntimeInitialized` callback (Emscripten), and a thenable
  `cv` (newer builds). A `timeoutMs` cap rejects if the runtime never initializes.
- **Single-flight + retry:** concurrent/repeat callers share one load; on failure
  the cached promise is cleared so a later call retries.
- Adapter is a structural cast (`cv as unknown as CvLike`) — the real `cv` exposes
  `CV_64F`, `SOLVEPNP_IPPE_SQUARE`, `Mat`, `matFromArray`, `solvePnP`.

## Tests

`opencv-loader.test.ts` — pins the PURE orchestration with fakes (no WASM):
default URL, single-flight idempotency, the ready / `onRuntimeInitialized` /
thenable handshakes, retry-after-failure, missing-global rejection, timeout. The
real WASM load is verified on device (see the on-device follow-up doc).
