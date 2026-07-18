# `main.ts` — application entry (glue)

- **Purpose:** The "framework wiring — don't touch" layer. Composes the tested
  seams into the persistent-anchor flow: capability gate → AR boot on a user
  gesture → GPS/orientation wiring → onboarding coaching → soft-gated
  placement (cache-miss) or seed-and-re-converge (cache-hit).
- **Public API:** none (side-effecting entry). Editable seam is
  `createAnchorMarker()` in [marker.ts](marker.ts), imported under the clearly
  marked `--- your content here ---` banner.
- **Test seam:** every framework call site (`initAR`, `getArWorldGroup`,
  `getCamera`, `startGpsWatch`, `startOrientationWatch`,
  `requestDeviceOrientationPermission`, `endARSession`, `createGpsAnchor`,
  `enableArWorldGroupAlignment`, `selectTrackingQuality`,
  `selectAlignmentMatrix`, `startReticleHitTest`,
  `checkWebXRSupport`, `checkGeolocationPermission`, `createAnchorMarker`) is
  resolved through `getSeams()` from [seams.ts](seams.ts.md) instead of being
  called directly. In production `getSeams()` returns the real imports; the
  DEV-only `window.__anchorStarterSeams` override lets the Tier 1 Playwright e2e
  suite drive the real placement → `?show=` → copy-link glue without WebXR. See
  the prod-inert guarantee in [seams.ts.md](seams.ts.md).
- **Key flow:**
  - `main()` probes `checkWebXRSupport` + `checkGeolocationPermission`; if not
    fully supported, shows `capabilityMessage` (E1, from the framework's
    [ar/capability-checker](../../GpsPlusSlamJs_AppFramework/src/ar/capability-checker.ts.md)
    with `contextLabel: "the persistent-anchor flow"`) and disables Start.
  - `startAr()` (user gesture): `createSlamAppStore({ NullStorageBackend })` →
    `initAR` (with the camera/depth crash-surface flags
    `enableCameraAccess` / `enableDepthSensingFeature` /
    `enableCameraTextureAcquisition` set to `false`, `requestHitTest: true`
    in the session-features arg so the cache-miss reticle works, and the
    **`callbacks.tracking` group** — store + `onRestarted` arrive TOGETHER
    since the framework's setter fold. Without the group the framework's
    per-frame `updateTrackingState()` dispatches no `poseReceived`/`poseLost`,
    leaving `tracking.phase` stuck at `initializing`, which pins the
    tracking-quality report and the onboarding guidance to "AR tracking lost"
    forever; the `onRestarted` callback dispatches
    `odometryTrackingRestarted(payload)` so alignment survives origin resets.
    `initAR` goes through the seam so the Tier 1 e2e suite can assert the
    wiring actually happens — `placement-flow.spec.js` checks the group rode
    into the boot `initAR` call. This example places 3D anchors under a
    screen-centre hit-test reticle and never reads the camera image;
    `dom-overlay` / CSS3D stay on for the overlay UI) →
    `startSession` (so the GPS coordinator
    feeds alignment) → `enableArWorldGroupAlignment({ store, arWorldGroup })`
    (lerps the alignment onto `arWorldGroup` so the camera + anchor ride it
    together — GPS-registers the view, without which the camera is pure-VIO) →
    `createGpsPositionHandler` + `startGpsWatch` →
    `requestDeviceOrientationPermission` + `startOrientationWatch` →
    wire `placeButton` + `copyLinkButton` clicks →
    `readCachedAnchor()` → on a **cache-miss** start the reticle loop
    (the `startReticleHitTest` seam — the framework's shared
    `startHitTestReticle({ arWorldGroup })` driver, no `onSelect`: placement is
    button-driven); on a **cache-hit** spawn the
    saved anchor (`skipBootstrap` + `hideUntilAligned`) → `dispatchSetup(BOOTED)`.
  - `placeAnchor()` (cache-miss): gated by `decideAnchorPlacement` — a press
    only commits when a surface is under the reticle AND a GPS alignment exists,
    else it surfaces a hint via `PLACE_BLOCKED` (stays placeable, no `saving`).
    On a valid press: `PLACE_REQUESTED` (saving) →
    `spawnAnchor(gps, false, {}, { worldPosition, onBootstrapComplete })` places
    the marker at the reticle world pose and starts the bootstrap. `?show=` is
    **not** written here — it is persisted from the committed bootstrap median
    via `onBootstrapComplete`, which also disposes the reticle and dispatches
    `PLACE_SUCCEEDED`. So `saving` holds until the median lands and `saved`
    reflects the durable URL write (per the repo async-UX rule). A throw during
    spawn → `PLACE_FAILED` (revert + error line) and `dispose()`s any partially
    created `anchor` so a retry can never accumulate overlapping markers.
  - `spawnAnchor()` builds `createGpsAnchor` with `getAlignmentMatrix` /
    `getGpsZeroRef` bound to the live store; the bootstrap GPS source is the
    framework anchor's **built-in object-pose sampler** (quality-review G-6 —
    the hand-built `getCurrentGpsPoint`/`worldNueToGps` closure this app used
    to carry is now the anchor default), sampling the marker's own
    **GPS-world (NUE) world pose**. Its
    optional `{ worldPosition }` places the marker at the reticle hit point
    (world→`arWorldGroup`-local); `{ onBootstrapComplete }` is forwarded to the
    anchor so the cache-miss path can persist the committed median into `?show=`.
    It adds the marker to the AR world group _before_ `createGpsAnchor`; if
    creation throws it removes the marker again, and it wraps the returned
    `dispose()` so disposing the anchor also detaches its marker (the
    framework `dispose()` only unregisters the frame-loop tick — see
    [gps-anchor](../../GpsPlusSlamJs_AppFramework/src/visualization/gps-anchor.ts.md)).
    This makes `anchor.dispose()` a complete teardown for every caller
    (placement retry, `failStart` boot rollback, `beforeunload`).
  - `spawnAnchor()` also starts the **F2 wayfinding HUD**
    (`seams.createWayfindingHud`, deadband `HUD_DISTANCE_MIN_M`/`_MAX_M` =
    1.5/3.0 m) for the spawned marker on both branches (cache-miss placement
    and `?show=` cache-hit). The target feed is the pure
    [hud-targets](hud-targets.ts.md) helper, which yields the marker's world
    position only while `marker.visible` — so the hidden pre-alignment
    cache-hit marker never produces a target at the AR origin. HUD creation
    is wrapped in try/catch (auxiliary feature: a HUD failure must never
    break the anchor flow), and the anchor `dispose()` wrapper also disposes
    the HUD.
  - `failStart()` (async): unwinds a failed AR boot — calls
    `endARSession()` (via seam) to flush the framework session
    (`renderer`/`xrSession`/session-disposer registry) so `initAR()` can
    succeed on a retry, then stops sensor watches, drops partially created
    anchors/reticle, and restores the start screen. Without the
    `endARSession()` call, the `initAR()` re-entry guard permanently wedges
    the app after a post-`initAR` failure. Its optional
    `{ hideUntilAligned }` flag (used by the `?show=` cache-hit) keeps the marker
    hidden until the first non-null alignment arrives, then reveals it at its
    computed pose — so a `skipBootstrap` reload never flashes the marker at the
    AR origin before it jumps to its real spot (Q4). The reveal subscription is
    torn down on first reveal and on `dispose()`.
- **Invariants & assumptions:**
  - Selectors are run via the `sel()` helper which casts the store state per
    selector (only the read slices exist at runtime — same pattern as the
    MinimalExample).
  - `createGpsAnchor` self-registers its frame update, so the anchor ticks on
    the AR render loop automatically.
  - `lastGps` always carries a finite altitude (defaults to `0`) so the anchor
    seed is a well-formed `LatLongAlt`.
  - **Cache-miss bootstrap source is the marker's own world pose** (the
    framework anchor's built-in object-pose sampler, quality-review G-6),
    matching the MinimalExample — the marker is positioned at the reticle hit
    point, so the anchor commits to the point the user aimed at, not the device.
    This works only because `enableArWorldGroupAlignment` makes the marker's
    world position GPS-world NUE. The persisted `?show=` is the **committed
    bootstrap median** (via `onBootstrapComplete`), so the shared link equals
    the anchor's committed reference by construction and stays correct across
    re-bootstraps. (Cache-hit uses `skipBootstrap`, so the bootstrap sampler
    never runs and the URL GPS is the decoded one.)
- **Tests:** glue is verified manually via `pnpm dev` on an AR device. The
  decision logic it composes is unit-tested in the sibling modules
  ([setup-state-machine](setup-state-machine.ts.md),
  [placement-decision](placement-decision.ts.md),
  [hud-targets](hud-targets.ts.md),
  [url-anchor-state](url-anchor-state.ts.md),
  [guidance-view](guidance-view.ts.md), [placement-view](placement-view.ts.md),
  [marker](marker.ts.md)) and in the framework
  ([ar/capability-checker](../../GpsPlusSlamJs_AppFramework/src/ar/capability-checker.ts.md),
  which replaced the app-local `capability.ts`, and
  [ar/hit-test-reticle-driver](../../GpsPlusSlamJs_AppFramework/src/ar/hit-test-reticle-driver.ts.md),
  which replaced the app-local `reticle-hit-test.ts` in the 2026-07-18
  promotion). The
  placement glue — including the reticle gate (place when a surface is present,
  hint when not) and the failure cleanup that prevents leaked / overlapping
  markers — is covered end-to-end by the Tier 1 Playwright suite
  (`playwright-tests/placement-flow.spec.js`).
