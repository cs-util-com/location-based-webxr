# Location-Based WebXR

> [It was almost impossible because it was.. the dream was so big](https://www.youtube.com/watch?v=zhl-Cs1-sG4) - Giorgio Moroder 🎶

**Stable outdoor AR in the browser - no native app, no VPS, no signup, not even internet required**

Three.js + GPS + WebXR sensor fusion that keeps 3D content pinned to real-world coordinates as the user walks.

[![npm version](https://img.shields.io/npm/v/gps-plus-slam-app-framework.svg)](https://www.npmjs.com/package/gps-plus-slam-app-framework)
[![npm downloads](https://img.shields.io/npm/dm/gps-plus-slam-app-framework.svg)](https://www.npmjs.com/package/gps-plus-slam-app-framework)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522.14-brightgreen.svg)](https://nodejs.org/)

<p align="center">
  <a href="https://gps.csutil.com"><strong>Live Demos & Examples →</strong></a>
</p>

---

- Build **outdoor AR apps** like navigation, GPS-anchored scavenger hunts, location-triggered tour guides, ... in the browser -> accurate AR content without the need of an native app or VPS service or requiring the user to be online at all.

- Provides a **client-side sensor fusion** pipeline that incrementally refines a GPS-to-AR alignment matrix using outlier-rejected observations. If you want to build any kind of game or experience tied to physical locations, this gives you stable world-anchored coordinates in a web browser.

- A composable Redux-based app framework where you plug in extraReducers and a storage backend, and it handles WebXR sessions, GPS sensors, recording, and replay out of the box.

- Ship location-based AR experiences as progressive web apps - no App Store review, no native SDK dependency, nothing for the user to install, and a free community license key with zero signup.

## Zero-Install Onboarding

Because everything runs in the browser, there is no native build to ship, no store review to wait on, and nothing for the user to download or sign up for - which removes most of the friction that normally sits between "interested" and "in the experience".

The shortest path in is a single QR code: the user points their phone's camera at it and the AR scene opens **directly in the browser**. From there you have two ways to ground the content, and you can pick per experience:

- **Use the QR code as a high-precision GPS fix.** A code placed at a known, surveyed spot can do double duty as a spatial anchor. The framework detects it in the camera feed, solves its pose, and feeds that in as an extremely accurate position observation into the **same** fusion pipeline as the phone's own GPS. It doesn't replace GPS - it seeds the GPS↔AR alignment correctly **from the first second** and then keeps fusing with the ordinary, noisier GPS readings the device collects as the user walks. So you get a correct anchor immediately *and* it stays robust as people roam away from the marker.
- **Or let GPS+SLAM do the grounding.** Reusing the onboarding code as an anchor only works when it sits at a known, surveyed spot. Many experiences can't meet that - e.g. when the code lives on flyers the user carries around or you just dont want/need to run continuous detection of qr codes in your use case and this way can save some battery. So there are cases where the code is perfect for *opening* the experience but carries no reliable real-world pose, so you skip marker anchoring and rely only on the GPS+SLAM fusion the framework already provides. The GPS↔AR alignment converges over the first seconds of movement into a tight, world-anchored outdoor overlay - see [How It Works](#how-it-works-sensor-fusion--outdoor-stability) below.

## What You Can Build With It

- **Outdoor AR navigation** - arrows and waypoints anchored to real-world GPS coordinates.
- **GPS-anchored 3D content** - drop persistent 3D objects at lat/lon and have them stay put as the user walks.
- **AR tour guides and museum trails** - content keyed to location, surfaced when the user is nearby.
- **Location-based games** - geocaching, scavenger hunts, multi-player AR experiences tied to physical places.
- **Field-data capture tools** - record synchronized GPS, AR poses, camera frames, and depth as reusable datasets for 3D reconstruction (COLMAP / Gaussian splatting), alignment-quality evaluation, desktop replay, geo-anchored site documentation, and ML training.
  - The recorded zips can be opened directly in third-party reconstruction tools such as [colmapview.github.io](https://colmapview.github.io/) or [LichtFeld-Studio](https://github.com/MrNeRF/LichtFeld-Studio).

## How It Works: Sensor Fusion & Outdoor Stability

A common assumption is that markerless WebXR will drift badly or make content "jump" in large, visually uniform outdoor spaces (open parks, grass fields), because classic visual SLAM leans on camera feature points that are sparse there. It's worth being precise about which layer does what, so you can judge whether this fits your use case:

- **Visual-inertial tracking is handled by the WebXR runtime (ARCore/ARKit), not by this library.** The device's own AR stack already fuses the camera with the IMU to produce local 6-DoF odometry, which stays usable through short stretches of sparse visual features. This framework **consumes** that odometry rather than re-implementing it.
- **What this framework adds is GPS↔AR alignment.** `gps-plus-slam-js` continuously aligns the local AR odometry with GPS, refining the fit **live as the user moves** rather than re-snapping, so placed content does not teleport on every GPS update. Placement helpers (`createGpsAnchor`) can even defer small corrections until an object is off-screen, while still correcting if alignment drifts far enough that content would otherwise be left in a stale spot.
- **Accuracy is sub-meter, not centimeter - and it improves with motion.** After roughly 15 seconds of walking in representative outdoor conditions, visible drift typically drops well below raw GPS and the fusion is what keeps locally-placed content sitting on its spot as the user walks around it.

This makes the framework well-suited to large-scale outdoor AR - a walking trail with arrows pointing the way, treasure-hunt markers hidden around a field, or info labels pinned to statues and buildings - provided you treat global placement as GPS-accurate and local stability as motion-dependent rather than guaranteed. For the full rationale, caveats, and the VPS-free positioning model, see the [framework's "Why use GPS+SLAM?" section](GpsPlusSlamJs_AppFramework/README.md). The fastest way to evaluate it is to open an example URL on your phone, step outside, drop an object, and walk around it. If your use case needs accuracy from the very first frame rather than after a few seconds of walking, anchor the content to a printed QR reference instead - see [Zero-Install Onboarding](#zero-install-onboarding).

## Architecture

```
┌──────────────────────────────────────────────────┐
│  Your App                                        │
│  (UI, screen flow, app-specific reducers)        │
├──────────────────────────────────────────────────┤
│  gps-plus-slam-app-framework   ← this repo       │
│  (WebXR, Three.js, sensors, storage, replay,     │
│   composable store factory with extension hooks) │
├──────────────────────────────────────────────────┤
│  gps-plus-slam-js              (npm package)     │
│  (GPS/AR alignment, outlier rejection, GPS math) │
└──────────────────────────────────────────────────┘
```

Your app composes its own state, screen flow, and visuals on top of the framework via `createSlamAppStore({ extraReducers, extraMiddleware, storageBackend })`. The framework never imports from your app, and the closed-source core never imports from the framework.

## Packages

- [`GpsPlusSlamJs_AppFramework`](GpsPlusSlamJs_AppFramework/) — Reusable AR+GPS app framework - WebXR session management, Three.js visualization, GPS sensors, OPFS+ZIP record/replay, composable store.
- [`GpsPlusSlamJs_RecorderApp`](GpsPlusSlamJs_RecorderApp/) — Full-featured recorder app: capture AR sessions on a phone, replay on a desktop, debug alignment, and contribute test data.
- [`GpsPlusSlamJs_AnchorStarter`](GpsPlusSlamJs_AnchorStarter/) — Persistent-anchor starter (the public "Demo"). GPS-anchored placement with URL-based persistence (`?show=`) and cross-device sharing.
- [`GpsPlusSlamJs_MinimalExample`](GpsPlusSlamJs_MinimalExample/) — Smallest possible consumer of the framework. A single-file GPS + AR hit-test demo (Enable GPS AR button → reticle → tap-to-place) that contrasts an uncompensated floater cube with a drift-corrected `createGpsAnchor` marker. Use this as your starting template.

Focused demos of individual framework capabilities:

- [`GpsPlusSlamJs_QrTrackingDemo`](GpsPlusSlamJs_QrTrackingDemo/) — QR tracking end to end: detect any printed QR, measure its physical size from the depth map, and glue a pose overlay to it. The desktop stand-in for the on-device QR verification gate.
- [`GpsPlusSlamJs_PhysicsDemo`](GpsPlusSlamJs_PhysicsDemo/) — Physics balls bounce off the reconstructed occupancy mesh of a real space, live in AR or against a replayed recording on the desktop.
- [`GpsPlusSlamJs_WayfindingHudDemo`](GpsPlusSlamJs_WayfindingHudDemo/) — The wayfinding HUD: edge arrows for off-screen targets, on-screen rings, live distance labels, and an anti-flicker hysteresis deadband. Runs in AR on a phone or as a WASD walk simulator on the desktop.

[`GpsPlusSlamJs_ExampleRecordings`](GpsPlusSlamJs_ExampleRecordings/) holds real-world RecorderApp session ZIPs (data only, not a package) so you can exercise replay without going outside first.

The recorder app at a glance:

- Records WebXR AR poses, GPS positions, optional camera frames, and optional depth samples.
- Exports the session as a self-contained ZIP file you can email, version-control, or share.
- Replays the ZIP on a desktop with full 3D scene reconstruction for inspection and debugging.

## About the Core Library

The core alignment library ([`gps-plus-slam-js`](https://www.npmjs.com/package/gps-plus-slam-js)) is **closed-source** and distributed via npm under a proprietary license (EULA). It provides:

- **Sub-meter positioning** - fuses high-frequency AR odometry with noisy GPS.
- **Fully offline** - all computation runs on-device, no network requests.
- **Framework-agnostic** - pure TypeScript with a Redux-based state store. 
- **Incremental alignment** - the alignment matrix updates live as new observations arrive.

A free license key is bundled with the framework, so you can start building right away - no signup or API key request process required, see the [EULA](https://www.npmjs.com/package/gps-plus-slam-js) for further details on how it works. The key is updated every time a new framework version is released and it's valid for a year so that updating to the latest framework version automatically updates to a new license key as well. 

## Quick Start: Try the Recorder

> **Live demo:** the apps are deployed at **<https://gps.csutil.com>** - a
> landing page links to the **Demo** (persistent-anchor starter, `/starter/`)
> and the **Example app to evaluate the tracking accuracy** (the recorder,
> `/recorder/`). Open it on a WebXR-capable phone.

## Quick Start: Build Your Own App

Install the framework and core library:

```bash
pnpm add gps-plus-slam-app-framework gps-plus-slam-js
```

```ts
import { createSlamAppStore } from 'gps-plus-slam-app-framework/state';
import { initAR } from 'gps-plus-slam-app-framework/ar';
import { startGpsWatch } from 'gps-plus-slam-app-framework/sensors';
import { NullStorageBackend } from 'gps-plus-slam-app-framework/storage';

// 1. Compose the store. Use OpfsStorageBackend for durable recording.
const store = createSlamAppStore({
  storageBackend: new NullStorageBackend(),
});

// 2. Start the WebXR AR session.
await initAR(document.getElementById('app')!);

// 3. Wire GPS into the store.
startGpsWatch(
  (pos) => {
    /* dispatch into store */
  },
  (err) => {
    /* handle error */
  }
);
```

> See [`GpsPlusSlamJs_MinimalExample`](GpsPlusSlamJs_MinimalExample/) for a full, end-to-end runnable example (GPS + AR hit-test session with tap-to-place). For the full API surface and the composable extension hooks (`extraReducers`, `extraMiddleware`, `ZipExportContributor`), see the [framework README](GpsPlusSlamJs_AppFramework/README.md).

## Repository Layout

| Folder                                                      | Purpose                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------- |
| [`GpsPlusSlamJs_AppFramework/`](GpsPlusSlamJs_AppFramework/) | The reusable framework (npm package).                         |
| [`GpsPlusSlamJs_RecorderApp/`](GpsPlusSlamJs_RecorderApp/)   | The reference recorder app (Vite + Playwright).               |
| [`GpsPlusSlamJs_AnchorStarter/`](GpsPlusSlamJs_AnchorStarter/) | Persistent-anchor starter example (the public "Demo").       |
| [`GpsPlusSlamJs_MinimalExample/`](GpsPlusSlamJs_MinimalExample/) | Smallest possible framework consumer.                     |
| [`GpsPlusSlamJs_QrTrackingDemo/`](GpsPlusSlamJs_QrTrackingDemo/) | QR detection + pose overlay demo.                         |
| [`GpsPlusSlamJs_PhysicsDemo/`](GpsPlusSlamJs_PhysicsDemo/)  | Physics against the reconstructed occupancy mesh.              |
| [`GpsPlusSlamJs_WayfindingHudDemo/`](GpsPlusSlamJs_WayfindingHudDemo/) | Wayfinding HUD (AR + desktop walk simulator).        |
| [`GpsPlusSlamJs_ExampleRecordings/`](GpsPlusSlamJs_ExampleRecordings/) | Real-world session ZIPs (data only, not a package).   |
| [`GpsPlusSlamJs_Landing/`](GpsPlusSlamJs_Landing/)          | Static landing page served at the deployment root.            |
| `signatures/`                                               | License-key public signatures for the closed-source core.     |
| `tests/`                                                    | Repo-config integration tests (workspace cohesion checks).    |

## Build the Framework from Source

```bash
pnpm --filter gps-plus-slam-app-framework build
```

## Deployment (gps.csutil.com)

All public surfaces share one origin and are built into a single `dist-site/`
directory served by Cloudflare static assets:

```bash
pnpm run build:site   # framework + every app + landing, into one dist-site/
```

- `/` → landing page ([`GpsPlusSlamJs_Landing/`](GpsPlusSlamJs_Landing/))
- `/recorder/` → recorder app, built with `base=/recorder/`
- `/starter/` → anchor starter, built with `base=/starter/`
- `/minimal/` → minimal example, built with `base=/minimal/`
- `/qr-demo/` → QR-tracking demo, built with `base=/qr-demo/`
- `/physics/` → physics demo, built with `base=/physics/`
- `/wayfinding/` → wayfinding HUD demo, built with `base=/wayfinding/`

The Cloudflare Git integration runs `pnpm run build:site` and serves `./dist-site`
(see [`wrangler.toml`](wrangler.toml)). The orchestration script
([`scripts/build-site.mjs`](scripts/build-site.mjs)) asserts every built URL
resolves under its app's base so a misrouted asset fails the deploy instead of
404-ing in production.

## Run Tests

```bash
# All tests — the commit gate: repo-config + every package's full gate
# (framework, recorder incl. E2E, starter, example, qr-demo, landing,
# physics, wayfinding)
pnpm test

# Iteration only: gates of changed packages + their dependents (+ repo-config).
# Never a substitute for the full `pnpm test` before a commit.
pnpm run test:changed

# Framework tests only
pnpm run test:framework

# Recorder unit tests only
pnpm run test:recorder:unit

# Recorder E2E tests only
pnpm run test:recorder:e2e

# Anchor-starter tests only
pnpm run test:starter

# Minimal-example tests only
pnpm run test:example
```

Every full gate run rewrites the generated `docs/test-timings.md` of the
project(s) it ran (per package and at the root) with per-stage wall-clock
history — commit that churn alongside your change; never hand-edit it (see
[`scripts/test-timing/README.md`](scripts/test-timing/README.md)).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, coding standards, and the pull request process.

## License

The framework, recorder app, and minimal example are licensed under the [Apache License 2.0](LICENSE).

The `gps-plus-slam-js` library used by the framework has a proprietary license, see its [EULA](https://www.npmjs.com/package/gps-plus-slam-js) for details.
