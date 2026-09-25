# qr-frontend.ts

**Purpose:** The detect+decode front-end behind a single `QrFrontEnd` —
Phase 2 / §3 of the
[QR-code detection & tracking plan](../../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-15-0806-qr-code-detection-tracking-plan.md).
Native `BarcodeDetector` only; the OpenCV `QRCodeDetector` fallback was removed
(the framework is now OpenCV-free).

## Public API

- `QrFrontEnd` — `{ kind: 'barcode-detector', detect(image: RgbaImage): Promise<QrDetection | null>, dispose?() }`.
  `QrDetection = { corners: [Point2×4], text, orderSource?, orderAudit? }`
  (`orderSource`: where the corner order came from - `finder`, `memory` or
  `native`, plan §39 F0a; `orderAudit`: on a finder frame that follows a
  chained one, what the chain would have picked - `agree`, `disagree` or `reject`, plan §42 S4); `RgbaImage = { data, width, height }`.
- `BarcodeDetectorFrontEnd` — `new (detector: BarcodeDetectorLike, toSource?, orderCorners?)`; `orderCorners` (a `CornerOrderer`, returning `{ corners, source, audit? }`) defaults to the finder-pattern canonicalizer.
  Wraps native `BarcodeDetector`; `toSource` converts `RgbaImage` →
  `ImageBitmapSource` (injectable for tests). The default wraps the frame in `ImageData` **without copying** when the array is plain-`ArrayBuffer`-backed (what `captureToRgba` returns, an owned copy already) and copies only otherwise, e.g. shared memory (QR perf plan 2026-09-23, M3: the second ~3 MB copy per decode bought nothing). The rule itself lives once, in `../rgba-image-data.ts` (DEC-H3), shared with the JPEG encoder.
- `createBarcodeDetectorFrontEnd(ctor?, toSource?)` — feature-detect factory (`toSource` overrides the default conversion, e.g. the QR demo's timed, copying pre-fix baseline); `null` when no
  `BarcodeDetector` constructor exists. There is **no OpenCV fallback** — the
  caller must handle the unsupported-browser case (see the follow-up below).
- Supporting types: `DetectedBarcodeLike`, `BarcodeDetectorLike`,
  `ToImageBitmapSource`, `CornerOrderer`.

## Invariants & assumptions

- **Symbol-ordered corners** (QR near-frontal pose plan 2026-09-23-2314,
  M1c): corners are emitted in pixel coordinates (top-left origin) in SYMBOL
  order (TL, TR, BR, BL of the printed code) whenever the finder patterns
  decide it (`qr-corner-order.ts`). The native detector on the owner's phone
  reports IMAGE order (QR summary §4b runs 3-6), which turned the solved pose
  in 90-degree steps ("Cause A"); `validateQuad` cannot catch that. When the
  image cannot tell, the code's chained order is used (plan §42: at most
  500 ms between detections, a small roll, no jump of the centre), else the
  detector's. The `orderCorners` constructor argument replaces the
  default (one finder-pattern canonicalizer per front end).
- **Dependencies injected:** the native detector and the `RgbaImage`→source
  conversion are injected, so this module + tests need no DOM.
- **Malformed output rejected:** non-4 corner counts, non-finite coordinates, and
  empty decoded text yield `null`.
- **Interim posture is BarcodeDetector-only** (covers the Android-Chrome test
  devices). A pure-JS decoder fallback (zxing-wasm / jsQR / none) is its own
  dependency decision — see
  [2026-06-17-0020-qr-decoder-fallback-followup.md](../../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-17-0020-qr-decoder-fallback-followup.md).

## Tests

- `qr-frontend.test.ts` — BarcodeDetector: first valid QR returned, nothing
  detected → null, malformed results (wrong corner count / empty text) skipped;
  factory null (no ctor) and constructed-with-`qr_code`-format cases; a
  rendered code whose corners the fake detector reports in IMAGE order comes
  out in symbol order (M1c).
- The ordering rule itself: [qr-corner-order.ts.md](qr-corner-order.ts.md).

## Related

- Emits corners consumed by [qr-pose.ts.md](qr-pose.ts.md) (`solveQrPose`).
- The PnP backend is the pure-JS [planar-pnp.ts.md](planar-pnp.ts.md).
- Driven at a throttled cadence by [detection-scheduler.ts.md](detection-scheduler.ts.md).
