# GPS-Plus-SLAM — Persistent Anchor Starter

> **Live:** deployed at **<https://gps.csutil.com/starter/>** (the "Demo" linked
> from the landing page).

A **meaningful minimal** example for the
[`gps-plus-slam-app-framework`](../GpsPlusSlamJs_AppFramework/README.md): the
smallest readable app that demonstrates the framework's actual value
proposition — a **GPS-anchored object that is visibly stable and persists
across a page reload**.

It is the middle rung of the example ladder:

- **trivial:** [`GpsPlusSlamJs_MinimalExample`](../GpsPlusSlamJs_MinimalExample/README.md)
  — resolve-and-run proof (no AR, no GPS, no persistence).
- **starter (this app):** one persistent GPS anchor, AR + GPS + onboarding
  coaching + **URL-encoded** persistence (the anchor lives in the `?show=`
  query param, so the link is _shareable_).
- **full:** [`GpsPlusSlamJs_RecorderApp`](../GpsPlusSlamJs_RecorderApp/README.md)
  — the complete product (routing, scenarios, ref-points, replay, recording).

## User story

1. Go outside with an AR-capable phone. The app coaches you to **move around**
   until alignment is good enough (a "N% ready" meter).
2. Place a **GPS anchor** (a marker) in the real world: point your phone at the
   ground until a reticle ring appears on the surface (the "AR cursor"), then
   tap **Place** to drop the anchor there — not at your own feet. Its
   coordinates are encoded into the page **URL** (the `?show=` query param) — the
   address bar updates in place and the link becomes shareable.
3. **Reload the page** _or_ **share the link** to another person / second
   device. Move around again to re-localise; the saved marker reappears at the
   exact same physical spot — proving cross-session _and_ cross-device
   persistence.

## Run it

```bash
cd GpsPlusSlamJs_AnchorStarter
pnpm install
pnpm dev          # Vite dev server on http://localhost:5181
```

Open the URL on an **AR-capable phone** (e.g. Chrome on Android with ARCore),
outdoors. On a device without WebXR/GPS the app shows an honest
capability-gated message instead of crashing (decision E1).

```bash
pnpm test         # full gate: static checks + unit tests + Playwright e2e
pnpm run test:core  # static checks + unit tests only (no browser)
pnpm run test:e2e   # Playwright Tier 0 + Tier 1 e2e suite
```

The e2e suite lives in [`playwright-tests/`](playwright-tests/README.md) and
boots the app in headless Chromium. **Tier 0** (`smoke.spec.js`) needs no
mocking and asserts the start screen, the hidden guidance/placement panels, and
the E1 capability gate (real Chromium genuinely lacks WebXR). **Tier 1**
(`placement-flow.spec.js` + `share-link.spec.js`) drives the full application
flow over a DEV-only test seam (`window.__anchorStarterSeams`, installed by
[`fakes.js`](playwright-tests/fakes.js.md) and statically stripped from
production): boot → onboarding guidance → soft-gated placement → the `?show=`
URL round-trip (place, reload, restore) → copy-link success/failure. `test:e2e`
rebuilds the consumed framework `dist/` first so Vite never serves a stale
bundle.

## How it is structured

The app deliberately separates **framework wiring (don't touch)** from **your
content (replace)**:

- **Pure, unit-tested logic** (copyable building blocks):
  - [`setup-state-machine.ts`](src/setup-state-machine.ts.md) — the
    pedagogical core: an explicit FSM for the sequential setup
    (cache-miss → place/save; cache-hit → relocalise/show).
  - [`url-anchor-state.ts`](src/url-anchor-state.ts.md) — inline `?show=`
    URL-state codec: encodes/decodes a minimal, **multi-anchor-ready**
    `{ a: [ { lat, lon, alt, n?, ui?, s?, r? } ] }` envelope (round-trip +
    validate-and-clamp; bad/empty/out-of-range param → "no anchor", never
    throws). The single source of truth for the placed anchor.
  - [`guidance-view.ts`](src/guidance-view.ts.md) /
    [`placement-view.ts`](src/placement-view.ts.md) — pure view-models that
    map the framework metric + FSM to render-ready strings (the async-UX
    in-progress → final contract is tested here).
  - The E1 capability decision + message come from the framework's
    [`ar/capability-checker`](../GpsPlusSlamJs_AppFramework/src/ar/capability-checker.ts.md)
    (promoted from this app; `main.ts` supplies the app-specific
    `contextLabel`).
  - [`placement-decision.ts`](src/placement-decision.ts.md) — the pure
    surface/alignment gate for the Place press (places only when a reticle
    surface AND a GPS alignment are present, else returns an actionable hint).
- **Glue:** [`main.ts`](src/main.ts.md) — composes the seams with `initAR`,
  `createGpsPositionHandler`, `createGpsAnchor`, GPS/orientation watches, and
  the framework's shared hit-test reticle driver
  ([`ar/hit-test-reticle-driver`](../GpsPlusSlamJs_AppFramework/src/ar/hit-test-reticle-driver.ts.md),
  promoted from this app's former local copy). Same placement
  model as the MinimalExample (place under the AR cursor), plus URL persistence.
- **Your content here:** [`marker.ts`](src/marker.ts.md) — the **single**
  place to edit. Swap `createAnchorMarker()` for your own `THREE.Object3D`
  and the persistence + anchoring keep working unchanged.

## Design decisions

- **D2 — URL-encoded persistence (supersedes the original `localStorage`
  decision):** the anchor state lives in the page URL (`?show=` param), making
  it _shareable_ across devices/people. The codec is inline in this app (not a
  framework helper), kept maximally copyable. The envelope is multi-anchor-ready
  (`{ a: [ … ] }`) and each anchor carries an optional visualization style
  (`ui`), scale (`s`) and north-relative rotation (`r`).
- **D3 — reusable guidance seam:** the coaching metric uses the framework's
  `computeOnboardingGuidance`, so wording/thresholds stay consistent with the
  recorder HUD.
- **D4 — soft gate:** "Place anchor" is always enabled; the guidance meter and
  banner copy nudge waiting for good tracking. The press itself is gated on a
  reticle surface + GPS alignment (`placement-decision.ts`): with no surface /
  alignment it surfaces an actionable hint instead of placing (it never
  hard-disables the button), mirroring the MinimalExample's tap gate.
- **D5 — E1 capability gate:** a clear "open on an AR phone outdoors" message
  on unsupported devices; no simulation fallback (yet).
