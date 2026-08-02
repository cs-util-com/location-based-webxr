# GpsPlusSlamJs_QrTrackingDemo

A standalone QR-tracking **debug/demo** app consuming
`gps-plus-slam-app-framework`. It is the realization of **Note 4** of the
[QR-tracking follow-up plan](../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-15-1219-qr-tracking-generalization-overlay-and-north-followup.md)
and the desktop stand-in for the mandatory, manual **§5 on-device verification
gate** ("green axis-overlay glued to a printed code").

## What it does

- Detects **any** printed QR (native `BarcodeDetector`).
- **Measures the QR's physical size from the depth map** — no hand-authored
  `qr.physicalSizeM`. Each detection samples depth at the 4 corners + the
  centroid, unprojects to 3D, and feeds a robust running median
  (`estimateQrSizeFromDepth` + `createQrSizeAccumulator` from the framework).
- Fits a rigid pose to the depth-unprojected corners (no `solvePnP`) and glues a
  **3D axis** + a **semi-transparent cube** sized to the QR under `arWorldGroup`,
  so you can walk around and confirm they stay locked to the code.
- Shows the running median (cm), sample count, spread (mm), and lifecycle stage
  in a HUD — measure a freshly printed QR, then check it against a tape measure.

It is **GPS-free** and **level-file-free**: it casts no GPS vote and only
observes the framework's `qrDetected` slice (Note 3). Depth sensing is required
for the auto-size path; without it the app degrades to a manual size.

## Architecture

- **Tested pure logic** (`src/*.ts` + colocated `*.test.ts`): `capability`,
  `hud-view`, `demo-store`, `demo-controller`, `seams`.
- **Shared debug overlay** — the axis+cube view is the framework's
  `gps-plus-slam-app-framework/ar/qr/qr-debug-view` (the same one the Recorder
  renders), imported by `main.ts`. It is NOT a local module, so the demo and
  Recorder cannot drift apart in how a detected QR is visualized.
- **`main.ts`** — glue only (capability gate → boot → per-frame
  `offerFrame` → HUD). Verified via the faked Playwright e2e and manually on a
  device (`pnpm dev`).
- **`seams.ts`** — the device boundary; the PROD frame/depth source uses the
  framework's public image/depth capture callbacks and is the on-device-verified
  layer, while the e2e swaps a deterministic fake in via `window.__qrDemoSeams`.

## Develop / test

```bash
cd c:\gps\location-based-webxr\GpsPlusSlamJs_QrTrackingDemo
pnpm test            # full gate: format + lint + checks + typecheck + unit + e2e
pnpm run test:unit   # vitest unit tests only
pnpm run test:e2e    # Playwright e2e only
pnpm dev             # run on a device (port 5185) for the §5 manual gate
```

Never call `vitest` or `playwright` directly — use the pnpm scripts.
